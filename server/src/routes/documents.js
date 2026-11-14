import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { Document } from "../models/Document.js";
import { User } from "../models/User.js";
import {
  encryptBuffer,
  decryptBuffer,
  hashPin,
  verifyPin as verifyPinDigest,
  signWalletToken,
  verifyWalletToken,
} from "../utils/crypto.js";
import { wrapKey, unwrapKey } from "../utils/docKeys.js";
import { validateDocumentFile } from "../utils/fileValidation.js";
import { authenticate, requireWorker, audit } from "../middleware/auth.js";
import { config } from "../config.js";

const router = Router();
// Memory storage: invalid uploads never touch disk at all.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

const MAX_BYTES = config.maxUploadMb * 1024 * 1024;

// Characters not allowed in a storage key: path separators, traversal, etc.
const STORAGE_KEY_RE = /^[A-Za-z0-9_.-]+$/;

function makeStorageKey(userId) {
  return `${userId}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

function safeStorageKey(key) {
  if (!STORAGE_KEY_RE.test(key)) {
    throw new Error("Invalid storage key");
  }
  return key;
}

/**
 * RFC 5987/6266 Content-Disposition with an ASCII fallback:
 *   attachment; filename="fallback.pdf"; filename*=UTF-8''<percent-encoded>
 * Browsers prefer filename* (full Unicode); the plain filename covers
 * clients that don't understand it.
 */
export function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ── Document-wallet PIN ────────────────────────────────────────────────
// The PIN lives on the user row, not in the browser: it follows the account
// across devices, the attempt counter cannot be reset by clearing site data,
// and the digest is never readable by whoever is holding the phone.
//
// A successful check mints a 10-minute wallet token. Once a PIN exists, every
// download needs one — otherwise the lock would only gate pixels while the
// API kept handing out Aadhaar cards to any script holding the session.

const PIN_RE = /^\d{4,8}$/;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;
const WALLET_TOKEN_TTL_SECONDS = 10 * 60;
const WALLET_FIELDS = "wallet_pin_hash wallet_pin_attempts wallet_pin_locked_until";

function lockoutResponse(res, lockedUntil) {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  res.setHeader("Retry-After", String(retryAfter));
  return res.status(423).json({
    detail: `Too many failed attempts. Locked out for ${Math.ceil(retryAfter / 60)} minutes.`,
    retry_after: retryAfter,
  });
}

function unlockBody(userId) {
  return {
    is_set: true,
    unlock_token: signWalletToken(userId, WALLET_TOKEN_TTL_SECONDS),
    expires_in: WALLET_TOKEN_TTL_SECONDS,
  };
}

/**
 * Charge one failed attempt, atomically, and lock the wallet at the cap.
 * The counter is $inc'd in the database rather than read-modify-written, so
 * parallel guesses cannot share a single slot.
 */
async function chargeFailedAttempt(userId) {
  const after = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { wallet_pin_attempts: 1 } },
    { new: true, projection: { wallet_pin_attempts: 1 } }
  );
  const attempts = after?.wallet_pin_attempts ?? 1;
  if (attempts >= PIN_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS);
    await User.updateOne(
      { _id: userId },
      { $set: { wallet_pin_attempts: 0, wallet_pin_locked_until: lockedUntil } }
    );
    return { lockedUntil, attemptsRemaining: 0 };
  }
  return { lockedUntil: null, attemptsRemaining: PIN_MAX_ATTEMPTS - attempts };
}

/** GET /api/v1/documents/pin/status → is a PIN set, and is the wallet locked? */
router.get("/pin/status", authenticate, requireWorker, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select(WALLET_FIELDS);
    if (!user) return res.status(404).json({ detail: "User not found." });
    const lockedUntil = user.wallet_pin_locked_until;
    const locked = Boolean(lockedUntil && lockedUntil.getTime() > Date.now());
    res.json({
      is_set: Boolean(user.wallet_pin_hash),
      locked,
      locked_until: locked ? lockedUntil.toISOString() : null,
      attempts_remaining: locked
        ? 0
        : Math.max(0, PIN_MAX_ATTEMPTS - (user.wallet_pin_attempts || 0)),
    });
  } catch (err) {
    console.error("[documents/pin/status]", err);
    res.status(500).json({ detail: "Could not read PIN status." });
  }
});

/** POST /api/v1/documents/pin/set → create or change the PIN, wallet unlocked */
router.post("/pin/set", authenticate, requireWorker, async (req, res) => {
  try {
    const pin = String(req.body?.pin ?? "");
    if (!PIN_RE.test(pin)) return res.status(422).json({ detail: "PIN must be 4-8 digits" });

    const user = await User.findById(req.userId).select(WALLET_FIELDS);
    if (!user) return res.status(404).json({ detail: "User not found." });

    if (user.wallet_pin_locked_until && user.wallet_pin_locked_until.getTime() > Date.now()) {
      return lockoutResponse(res, user.wallet_pin_locked_until);
    }

    // Changing an existing PIN requires proving the old one: possession of a
    // session must not be enough to re-key the wallet.
    if (user.wallet_pin_hash) {
      const currentPin = String(req.body?.current_pin ?? "");
      if (!PIN_RE.test(currentPin)) {
        return res.status(422).json({ detail: "Current PIN is required to change the PIN" });
      }
      const ok = await verifyPinDigest(currentPin, user.wallet_pin_hash);
      if (!ok) {
        const { lockedUntil, attemptsRemaining } = await chargeFailedAttempt(req.userId);
        if (lockedUntil) {
          await audit({ actorRole: "worker", actorIdentifier: req.userId, action: "document.pin_lockout", resourceType: "user", resourceId: req.userId, ip: req.ip, success: false });
          return lockoutResponse(res, lockedUntil);
        }
        return res.status(401).json({ detail: "Current PIN is incorrect", attempts_remaining: attemptsRemaining });
      }
    }

    await User.updateOne(
      { _id: req.userId },
      {
        $set: {
          wallet_pin_hash: await hashPin(pin),
          wallet_pin_attempts: 0,
          wallet_pin_locked_until: null,
        },
      }
    );
    await audit({ actorRole: "worker", actorIdentifier: req.userId, action: "document.pin_set", resourceType: "user", resourceId: req.userId, ip: req.ip, success: true });
    res.json(unlockBody(req.userId));
  } catch (err) {
    console.error("[documents/pin/set]", err);
    res.status(500).json({ detail: "Could not save PIN." });
  }
});

/** POST /api/v1/documents/pin/verify → 10-minute wallet token */
router.post("/pin/verify", authenticate, requireWorker, async (req, res) => {
  try {
    const pin = String(req.body?.pin ?? "");
    if (!PIN_RE.test(pin)) return res.status(422).json({ detail: "PIN must be 4-8 digits" });

    const user = await User.findById(req.userId).select(WALLET_FIELDS);
    if (!user) return res.status(404).json({ detail: "User not found." });
    if (!user.wallet_pin_hash) return res.status(409).json({ detail: "No PIN is set." });

    if (user.wallet_pin_locked_until && user.wallet_pin_locked_until.getTime() > Date.now()) {
      return lockoutResponse(res, user.wallet_pin_locked_until);
    }

    const ok = await verifyPinDigest(pin, user.wallet_pin_hash);
    if (!ok) {
      const { lockedUntil, attemptsRemaining } = await chargeFailedAttempt(req.userId);
      if (lockedUntil) {
        await audit({ actorRole: "worker", actorIdentifier: req.userId, action: "document.pin_lockout", resourceType: "user", resourceId: req.userId, ip: req.ip, success: false });
        return lockoutResponse(res, lockedUntil);
      }
      return res.status(401).json({ detail: "Incorrect PIN", attempts_remaining: attemptsRemaining });
    }

    await User.updateOne(
      { _id: req.userId },
      { $set: { wallet_pin_attempts: 0, wallet_pin_locked_until: null } }
    );
    res.json(unlockBody(req.userId));
  } catch (err) {
    console.error("[documents/pin/verify]", err);
    res.status(500).json({ detail: "Could not verify PIN." });
  }
});

/**
 * Downloads need an unexpired wallet token once a PIN is set. A worker with no
 * PIN keeps the old behaviour, so this ships without a migration.
 */
async function walletGate(req, res) {
  const user = await User.findById(req.userId).select("wallet_pin_hash");
  if (!user || !user.wallet_pin_hash) return true;
  const payload = verifyWalletToken(req.get("x-wallet-token") || "");
  if (payload && String(payload.sub) === String(req.userId)) return true;
  res.status(403).json({
    detail: "Wallet is locked. Enter your PIN to open your documents.",
    code: "wallet_locked",
  });
  return false;
}

// GET /api/v1/documents → my documents
router.get("/", authenticate, requireWorker, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const docs = await Document.find({ owner_id: req.userId }).sort({ createdAt: -1 }).limit(limit);
    res.json(docs.map((d) => d.toJSON()));
  } catch (err) {
    console.error("[documents/list]", err);
    res.status(500).json({ detail: "Could not load documents." });
  }
});

// POST /api/v1/documents (multipart) → encrypted store
router.post("/", authenticate, requireWorker, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(422).json({ detail: "file is required" });

    // Content-based validation (magic bytes), not the client MIME type.
    const verdict = validateDocumentFile(req.file.buffer, req.file.originalname, req.file.size, MAX_BYTES);
    if (!verdict.ok) return res.status(422).json({ detail: verdict.reason });

    // Per-file key, immediately wrapped under DOC_MASTER_KEY — the plaintext
    // key is never persisted (see utils/docKeys.js).
    const { key, payload } = encryptBuffer(req.file.buffer);
    const wrapped = wrapKey(Buffer.from(key, "base64"));

    const storageKey = makeStorageKey(req.userId);
    await fs.promises.mkdir(config.uploadDir, { recursive: true });
    const dest = path.join(config.uploadDir, safeStorageKey(storageKey));
    await fs.promises.writeFile(dest, payload);
    let doc;
    try {
      doc = await Document.create({
        owner_id: req.userId,
        display_name: req.body.display_name || req.file.originalname,
        original_filename: req.file.originalname,
        content_type: req.file.mimetype,
        size_bytes: req.file.size,
        storage_key: storageKey,
        encryption_key: wrapped,
      });
    } catch (err) {
      // Never orphan the ciphertext file if the DB write fails.
      await fs.promises.unlink(dest).catch(() => {});
      throw err;
    }
    await audit({ actorRole: "worker", actorIdentifier: req.userId, action: "document.upload", resourceType: "document", resourceId: String(doc._id), ip: req.ip, success: true });
    res.status(201).json(doc.toJSON());
  } catch (err) {
    console.error("[documents/upload]", err);
    res.status(500).json({ detail: "Upload failed. Please try again." });
  }
});

// GET /api/v1/documents/:id/download → decrypted stream
router.get("/:id/download", authenticate, requireWorker, async (req, res) => {
  try {
    if (!(await walletGate(req, res))) return;
    const doc = await Document.findOne({ _id: req.params.id, owner_id: req.userId });
    if (!doc) return res.status(404).json({ detail: "Document not found." });
    const payload = await fs.promises.readFile(path.join(config.uploadDir, safeStorageKey(doc.storage_key)));
    const perFileKey = unwrapKey(doc.encryption_key);
    const raw = decryptBuffer(payload, perFileKey.toString("base64"));
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", contentDisposition(doc.display_name || doc.original_filename));
    res.send(raw);
  } catch (err) {
    console.error("[documents/download]", err);
    res.status(500).json({ detail: "Download failed." });
  }
});

// PATCH /api/v1/documents/:id → rename
router.patch("/:id", authenticate, requireWorker, async (req, res) => {
  try {
    const name = String(req.body?.display_name || "").trim();
    if (!name) return res.status(422).json({ detail: "display_name is required" });
    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, owner_id: req.userId },
      { display_name: name },
      { new: true }
    );
    if (!doc) return res.status(404).json({ detail: "Document not found." });
    res.json(doc.toJSON());
  } catch (err) {
    console.error("[documents/rename]", err);
    res.status(500).json({ detail: "Rename failed." });
  }
});

// DELETE /api/v1/documents/:id
router.delete("/:id", authenticate, requireWorker, async (req, res) => {
  try {
    const doc = await Document.findOneAndDelete({ _id: req.params.id, owner_id: req.userId });
    if (!doc) return res.status(404).json({ detail: "Document not found." });
    await fs.promises.unlink(path.join(config.uploadDir, safeStorageKey(doc.storage_key))).catch(() => {});
    res.json({ detail: "Document deleted" });
  } catch (err) {
    console.error("[documents/delete]", err);
    res.status(500).json({ detail: "Delete failed." });
  }
});

export default router;
