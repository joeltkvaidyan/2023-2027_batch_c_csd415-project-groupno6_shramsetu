import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { Document } from "../models/Document.js";
import { encryptBuffer, decryptBuffer } from "../utils/crypto.js";
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
