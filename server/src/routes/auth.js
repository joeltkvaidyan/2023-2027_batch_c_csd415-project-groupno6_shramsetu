import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { OtpCode } from "../models/Document.js";
import { hashPassword, verifyPassword, sha256, hashOtp, randomOtp } from "../utils/crypto.js";
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  csrfValid,
  readCookie,
  revokeSession,
  rotateSession,
  startSession,
} from "../utils/session.js";
import { validateDocumentFile } from "../utils/fileValidation.js";
import { config } from "../config.js";
import { send } from "../services/smsAdapter.js";
import { authenticate, requireWorker, requireGovernment, requireEmployer, requireCitizen, audit } from "../middleware/auth.js";
import {
  otpRequestLimiter,
  otpVerifyLimiter,
  workerLoginLimiter,
  governmentLoginLimiter,
  registerLimiter,
} from "../middleware/rateLimit.js";

const router = Router();
// Memory storage: an invalid photo is rejected before anything touches disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

const MOBILE_RE = /^[6-9]\d{9}$/;

// ── OTP delivery: via SMS adapter (terminal by default, real gateway in prod) ──
async function sendOtp(mobile, code) {
  await send(mobile, code);
}

/**
 * The SMS gateway refused the message. Callers answer 502 (an upstream
 * failure), not 500 ("we are broken") and not 200 ("code sent") — the worker
 * must know that no code is coming and that the request was not their fault.
 */
class OtpDeliveryError extends Error {
  constructor(cause) {
    super("Could not send OTP");
    this.name = "OtpDeliveryError";
    this.cause = cause;
  }
}

/** Answers 502 and returns true when `err` was an OTP delivery failure. */
function otpSendFailed(res, err) {
  if (!(err instanceof OtpDeliveryError)) return false;
  res.status(502).json({ detail: "Could not send OTP" });
  return true;
}

async function issueOtp(mobile, purpose) {
  const now = new Date();
  const cooldown = new Date(now.getTime() - config.otp.resendCooldownSeconds * 1000);

  const recent = await OtpCode.findOne({
    mobile_number: mobile,
    purpose,
    last_sent_at: { $gt: cooldown },
  }).sort({ createdAt: -1 });
  if (recent) {
    const wait = Math.ceil((recent.last_sent_at.getTime() + config.otp.resendCooldownSeconds * 1000 - now.getTime()) / 1000);
    return { wait };
  }

  const code = randomOtp();
  // invalidate previous unconsumed codes for this mobile+purpose
  await OtpCode.updateMany({ mobile_number: mobile, purpose, consumed_at: null }, { consumed_at: now });
  const row = await OtpCode.create({
    mobile_number: mobile,
    code_hash: hashOtp(code),
    purpose,
    expires_at: new Date(now.getTime() + config.otp.expireSeconds * 1000),
    last_sent_at: now,
  });
  try {
    await sendOtp(mobile, code);
  } catch (err) {
    // Nothing was delivered, so the row must not survive: leaving it behind
    // would start the resend cooldown on a code nobody can ever receive, and
    // the worker would be locked out for a minute after a gateway hiccup.
    await OtpCode.deleteOne({ _id: row._id }).catch(() => {});
    throw new OtpDeliveryError(err);
  }
  return { wait: 0, code };
}

/**
 * Verify and burn an OTP in one atomic step.
 *
 * The read-then-write version this replaces could be raced: two requests both
 * read `consumed_at: null`, both matched the same code, and both were told
 * "ok" — so the same intercepted code could open two sessions. Here the check
 * and the burn are a single findOneAndUpdate, so exactly one caller can win.
 * A wrong code charges exactly one attempt, also atomically, which is what makes
 * the attempt cap actually hold under parallel guessing.
 */
async function consumeOtp(mobile, code, purpose) {
  const now = new Date();
  const live = {
    mobile_number: mobile,
    purpose,
    consumed_at: null,
    expires_at: { $gt: now },
    attempts: { $lt: config.otp.maxAttempts },
  };

  const claimed = await OtpCode.findOneAndUpdate(
    { ...live, code_hash: hashOtp(code) },
    { $set: { consumed_at: now } },
    { sort: { createdAt: -1 }, new: true }
  );
  if (claimed) return { ok: true };

  const charged = await OtpCode.findOneAndUpdate(
    live,
    { $inc: { attempts: 1 } },
    { sort: { createdAt: -1 }, new: true }
  );
  if (!charged) {
    // No live row left. If one is still within its lifetime but has used up
    // every attempt, say so — "expired or not requested" would send the worker
    // hunting for a problem that is actually just the attempt cap.
    const exhausted = await OtpCode.findOne({
      mobile_number: mobile,
      purpose,
      attempts: { $gte: config.otp.maxAttempts },
      expires_at: { $gt: now },
    }).sort({ createdAt: -1 });
    if (exhausted) return { ok: false, reason: "Too many attempts. Request a new code." };
    return { ok: false, reason: "OTP expired or not requested. Request a new code." };
  }
  if (charged.attempts >= config.otp.maxAttempts) {
    // Last allowed guess was wrong: retire the code now so the cap is final.
    await OtpCode.updateOne({ _id: charged._id }, { $set: { consumed_at: now } });
    return { ok: false, reason: "Too many attempts. Request a new code." };
  }
  return { ok: false, reason: "Incorrect OTP." };
}

// ── Account recovery key (shown ONCE, stored only as a sha-256 hash) ───
// Deliberately excludes look-alike characters so a worker can copy it by
// hand onto paper — the realistic “backup” for a lost phone + password.
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateRecoveryKey() {
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join("")
  );
  return `SRK-${groups.join("-")}`;
}

// Next worker code (SS-XXXXXX), monotonic across deletions.
//
// Two schemes that look sufficient are not:
//  - total count: deleting ANY worker makes the count re-issue a code that a
//    SURVIVING account already holds — recovery keyed on that code would
//    then target the wrong person;
//  - highest surviving code + 1: safe against collisions, but the code of a
//    deleted highest-holder is re-used — and old codes live on printed ID
//    cards, QR codes, audit trails and workers' paper recovery slips.
//
// So the code comes from an atomic counter, lazily initialised to the
// highest code already present in the users collection ($max makes
// concurrent initialisation safe). The unique partial index on worker_id is
// the final backstop; the register route retries past any duplicate-key race.
async function nextWorkerId() {
  const counters = mongoose.connection.collection("counters");
  // The floor is computed ONCE, when the counter document is first created —
  // for a fresh database that is the starting point, and after restoring a
  // dump it is the highest code already handed out, so no printed ID card is
  // ever re-issued. Once the document exists the atomic $inc below is the
  // whole allocation path; re-sorting the users collection on every
  // registration only added a query to each signup.
  const existing = await counters.findOne({ _id: "worker_id" });
  if (!existing) {
    const last = await User.findOne({ role: "worker", worker_id: /^SS-\d{6}$/ })
      .sort({ worker_id: -1 })
      .select("worker_id")
      .lean();
    const floor = last ? Number.parseInt(last.worker_id.slice(3), 10) : 100000;
    await counters.updateOne({ _id: "worker_id" }, { $max: { seq: floor } }, { upsert: true });
  }
  const updated = await counters.findOneAndUpdate(
    { _id: "worker_id" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  // Driver 6 returns the document directly; older shapes wrap it in `value`.
  const seq = Number(updated?.seq ?? updated?.value?.seq);
  // `updated` can only be empty if another process dropped the counter between
  // the upsert and this call; the register route's duplicate-key retry handles
  // that rare case, so never fall back to a value that might collide.
  if (!Number.isInteger(seq) || seq < 100001) throw new Error("worker_id counter unavailable");
  return `SS-${String(seq).padStart(6, "0")}`;
}// ── Worker: register (multipart form) ────────────────────────────────
router.post("/worker/register", registerLimiter, upload.single("profile_photo"), async (req, res) => {
  try {
    const b = req.body;
    const mobile = String(b.mobile_number || "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobile)) {
      return res.status(422).json({ detail: [{ loc: ["body", "mobile_number"], msg: "Enter a valid 10-digit Indian mobile number" }] });
    }
    if (!b.full_name || String(b.full_name).trim().length < 2) {
      return res.status(422).json({ detail: [{ loc: ["body", "full_name"], msg: "Full name is required" }] });
    }
    if (!b.password || String(b.password).length < 6) {
      return res.status(422).json({ detail: [{ loc: ["body", "password"], msg: "Password must be at least 6 characters" }] });
    }
    // Optional profile photo: validated by CONTENT (must be a real image).
    let photoBuffer = null;
    if (req.file) {
      const verdict = validateDocumentFile(req.file.buffer, req.file.originalname, req.file.size, config.maxUploadMb * 1024 * 1024);
      if (!verdict.ok) return res.status(422).json({ detail: [{ loc: ["body", "profile_photo"], msg: verdict.reason }] });
      if (verdict.kind === "pdf") {
        return res.status(422).json({ detail: [{ loc: ["body", "profile_photo"], msg: "Profile photo must be an image (JPEG, PNG or WEBP)." }] });
      }
      photoBuffer = req.file.buffer;
    }

    const existing = await User.findOne({ role: "worker", mobile_number: mobile });
    if (existing && existing.is_phone_verified) {
      // A verified account can never be re-registered (hijack defense).
      return res.status(409).json({ detail: "A worker with this mobile number already exists. Please log in." });
    }
    if (existing && !existing.is_phone_verified) {
      // Unverified account: do NOT create a duplicate or overwrite the
      // password — just re-send the OTP so the same person can finish
      // verifying, while an attacker who knows the number gets nothing more
      // than a new code delivered to the REAL owner's phone/terminal.
      const { wait } = await issueOtp(mobile, "register");
      if (wait) return res.status(429).json({ detail: `Please wait ${wait}s before requesting another OTP.` });
      return res.status(200).json({ worker_id: existing.worker_id, mobile_number: mobile, resent: true });
    }

    // Every new registration awaits government acceptance. The recovery key
    // is generated here, returned exactly once, and only its hash is stored.
    const recoveryKey = generateRecoveryKey();

    const doc = {
      role: "worker",
      full_name: String(b.full_name).trim(),
      mobile_number: mobile,
      email: b.email || null,
      password_hash: await hashPassword(String(b.password)),
      recovery_key_hash: sha256(recoveryKey),
      gov_approve_status: "pending",
      gender: b.gender || null,
      date_of_birth: b.date_of_birth || null,
      aadhaar_last4: b.aadhaar_number ? String(b.aadhaar_number).replace(/\D/g, "").slice(-4) : null,
      occupation: b.occupation || null,
      years_of_experience: b.years_of_experience ? parseInt(b.years_of_experience, 10) : null,
      preferred_language: b.preferred_language || "en",
      current_address_line: b.current_address_line || null,
      current_village_or_city: b.current_village_or_city || null,
      current_district: b.current_district || null,
      current_state: b.current_state || null,
      current_pincode: b.current_pincode || null,
      native_state: b.native_state || null,
      native_district: b.native_district || null,
      emergency_contact_name: b.emergency_contact_name || null,
      emergency_contact_relation: b.emergency_contact_relation || null,
      emergency_contact_number: b.emergency_contact_number || null,
      is_phone_verified: false,
      consent_ai_processing: true, // privacy notice accepted (checkbox required by the frontend)
    };
    // Mint the code inside a retry loop: the unique partial index on
    // worker_id is the backstop, so a concurrent registration (or a stray
    // pre-existing code) just advances to the next one instead of creating
    // two workers that share an identity.
    let worker = null;
    for (let attempt = 0; attempt < 5 && !worker; attempt += 1) {
      try {
        worker = await User.create({ worker_id: await nextWorkerId(), ...doc });
      } catch (err) {
        if (err?.code !== 11000 || !err?.keyPattern?.worker_id) throw err;
      }
    }
    if (!worker) {
      return res.status(500).json({ detail: "Could not allocate a worker ID. Please try again." });
    }
    const workerId = worker.worker_id;

    if (photoBuffer) {
      const dest = path.join(config.uploadDir, `${worker._id}-profile`);
      await fs.promises.mkdir(config.uploadDir, { recursive: true });
      await fs.promises.writeFile(dest, photoBuffer);
      worker.profile_photo_path = `${worker._id}-profile`;
      await worker.save();
    }

    const { wait } = await issueOtp(mobile, "register");
    if (wait) {
      return res.status(429).json({ detail: `Please wait ${wait}s before requesting another OTP.` });
    }

    await audit({
      actorRole: "worker", actorIdentifier: mobile, action: "worker.register",
      resourceType: "user", resourceId: String(worker._id), ip: req.ip, success: true,
    });
    res.status(201).json({ worker_id: workerId, mobile_number: mobile, recovery_key: recoveryKey });
  } catch (err) {
    console.error("[auth/register]", err);
    if (otpSendFailed(res, err)) return;
    res.status(500).json({ detail: "Registration failed. Please try again." });
  }
});

// ── Worker: verify registration OTP → account activated ──────────────
router.post("/worker/otp/verify", otpVerifyLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const code = String(req.body.otp || "").replace(/\D/g, "");
    const result = await consumeOtp(mobile, code, "register");
    if (!result.ok) return res.status(400).json({ detail: result.reason });

    const worker = await User.findOne({ role: "worker", mobile_number: mobile });
    if (!worker) return res.status(404).json({ detail: "Registration not found." });

    worker.is_phone_verified = true;
    await worker.save();
    res.json({ access_token: await startSession(req, res, worker), token_type: "bearer", worker: worker.toWorkerJSON() });
  } catch (err) {
    console.error("[auth/otp/verify]", err);
    res.status(500).json({ detail: "Verification failed. Please try again." });
  }
});

// ── Worker: OTP login — step 1 request ───────────────────────────────
router.post("/worker/login/otp/request", otpRequestLimiter, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile_number || "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobile)) {
      return res.status(422).json({ detail: [{ loc: ["body", "mobile_number"], msg: "Enter a valid 10-digit Indian mobile number" }] });
    }
    // Never reveal whether the number is registered (enumeration defense).
    // The OTP itself is delivered via the backend terminal (dev/demo mode).
    const { wait } = await issueOtp(mobile, "login");
    await audit({
      actorRole: "worker", actorIdentifier: mobile, action: "worker.otp.request",
      resourceType: "user", resourceId: null, ip: req.ip, success: true,
    });
    res.json({ detail: "OTP sent" });
  } catch (err) {
    console.error("[auth/otp/request]", err);
    if (otpSendFailed(res, err)) return;
    res.status(500).json({ detail: "Could not send OTP. Please try again." });
  }
});

// ── Worker: OTP login — step 2 verify ────────────────────────────────
router.post("/worker/login/otp", otpVerifyLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const code = String(req.body.otp || "").replace(/\D/g, "");
    const result = await consumeOtp(mobile, code, "login");
    if (!result.ok) return res.status(400).json({ detail: result.reason });
    const worker = await User.findOne({ role: "worker", mobile_number: mobile });
    if (!worker) return res.status(404).json({ detail: "No account for this number." });
    if (!worker.is_phone_verified) {
      worker.is_phone_verified = true;
      await worker.save();
    }
    if (!worker.is_active) return res.status(403).json({ detail: "Account disabled." });
    res.json({ access_token: await startSession(req, res, worker), token_type: "bearer", worker: worker.toWorkerJSON() });
  } catch (err) {
    console.error("[auth/otp/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
  }
});

// ── Worker: password login ───────────────────────────────────────────
router.post("/worker/login", workerLoginLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const worker = await User.findOne({ role: "worker", mobile_number: mobile });
    const ok = worker?.password_hash ? await verifyPassword(String(req.body.password || ""), worker.password_hash) : false;
    if (!worker || !ok) {
      await audit({
        actorRole: "worker", actorIdentifier: mobile, action: "worker.login.password",
        resourceType: "user", resourceId: null, ip: req.ip, success: false, failureReason: "invalid credentials",
      });
      return res.status(401).json({ detail: "Invalid mobile number or password." });
    }
    if (!worker.is_active) return res.status(403).json({ detail: "Account disabled." });
    // An unverified account has no password login: it must complete OTP
    // verification first (register flow re-sends the code).
    if (!worker.is_phone_verified) {
      return res.status(403).json({ detail: "Account not verified. Please complete registration with the OTP sent to your mobile." });
    }
    res.json({ access_token: await startSession(req, res, worker), token_type: "bearer", worker: worker.toWorkerJSON() });
  } catch (err) {
    console.error("[auth/worker/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
  }
});

// ── Worker: me / logout ──────────────────────────────────────────────
router.get("/worker/me", authenticate, requireWorker, async (req, res) => {
  const worker = await User.findById(req.userId);
  if (!worker || !worker.is_active) return res.status(401).json({ detail: "Not authenticated" });
  res.json(worker.toWorkerJSON());
});

// ── Worker: rotate my recovery key (password known, key lost/regenerated) ─
router.post("/worker/recovery-key/rotate", workerLoginLimiter, authenticate, requireWorker, async (req, res) => {
  try {
    const worker = await User.findById(req.userId);
    if (!worker) return res.status(401).json({ detail: "Not authenticated" });
    const ok = worker.password_hash ? await verifyPassword(String(req.body?.password || ""), worker.password_hash) : false;
    if (!ok) return res.status(401).json({ detail: "Password does not match this account." });

    const recoveryKey = generateRecoveryKey();
    worker.recovery_key_hash = sha256(recoveryKey);
    await worker.save();

    await audit({
      actorRole: "worker", actorIdentifier: worker.worker_id, action: "worker.recovery_key.rotate",
      resourceType: "user", resourceId: String(worker._id), ip: req.ip, success: true,
    });
    res.json({ recovery_key: recoveryKey });
  } catch (err) {
    console.error("[auth/recovery-key/rotate]", err);
    res.status(500).json({ detail: "Could not regenerate the recovery key." });
  }
});

// Signing out must end the session on the server, not just forget a token on
// one device. /auth/logout is the cookie-aware endpoint; this one is kept for
// clients that were calling it and does the same revocation.
router.post("/worker/logout", authenticate, async (req, res) => {
  await revokeSession(readCookie(req.headers.cookie, REFRESH_COOKIE));
  clearSessionCookies(res);
  res.json({ detail: "Logged out" });
});

// ── Worker recovery: lost password → reset with recovery key ──────────
// The recovery key alone proves identity (it was printed once at
// registration); no OTP is possible because the phone is the thing lost.
router.post("/worker/recover/password", workerLoginLimiter, async (req, res) => {
  try {
    const workerId = String(req.body?.worker_id || "").trim().toUpperCase();
    const key = String(req.body?.recovery_key || "").trim().toUpperCase();
    const newPassword = String(req.body?.new_password || "");
    if (newPassword.length < 6) {
      return res.status(422).json({ detail: "New password must be at least 6 characters" });
    }
    const worker = await User.findOne({ role: "worker", worker_id: workerId, is_active: true });
    const keyOk = worker?.recovery_key_hash && key ? worker.recovery_key_hash === sha256(key) : false;
    if (!worker || !keyOk) {
      await audit({
        actorRole: "worker", actorIdentifier: workerId, action: "worker.recover.password",
        resourceType: "user", resourceId: null, ip: req.ip, success: false, failureReason: "invalid recovery key",
      });
      return res.status(401).json({ detail: "Invalid worker ID or recovery key." });
    }
    worker.password_hash = await hashPassword(newPassword);
    await worker.save();
    await audit({
      actorRole: "worker", actorIdentifier: workerId, action: "worker.recover.password",
      resourceType: "user", resourceId: String(worker._id), ip: req.ip, success: true,
    });
    res.json({ detail: "Password updated. You can now log in with your new password." });
  } catch (err) {
    console.error("[auth/recover/password]", err);
    res.status(500).json({ detail: "Recovery failed. Please try again." });
  }
});

// ── Worker recovery: lost phone → move account to a NEW mobile ─────────
// Step 1: recovery key proves identity; an OTP proves ownership of the NEW
// number. The code goes to the new phone via the dev terminal delivery.
router.post("/worker/recover/mobile", otpRequestLimiter, async (req, res) => {
  try {
    const workerId = String(req.body?.worker_id || "").trim().toUpperCase();
    const key = String(req.body?.recovery_key || "").trim().toUpperCase();
    const newMobile = String(req.body?.new_mobile_number || "").replace(/\D/g, "");
    if (!MOBILE_RE.test(newMobile)) {
      return res.status(422).json({ detail: "Enter a valid 10-digit Indian mobile number" });
    }
    const worker = await User.findOne({ role: "worker", worker_id: workerId, is_active: true });
    const keyOk = worker?.recovery_key_hash && key ? worker.recovery_key_hash === sha256(key) : false;
    if (!worker || !keyOk) {
      await audit({
        actorRole: "worker", actorIdentifier: workerId, action: "worker.recover.mobile",
        resourceType: "user", resourceId: null, ip: req.ip, success: false, failureReason: "invalid recovery key",
      });
      return res.status(401).json({ detail: "Invalid worker ID or recovery key." });
    }
    const existing = await User.findOne({ mobile_number: newMobile });
    if (existing && String(existing._id) !== String(worker._id)) {
      return res.status(409).json({ detail: "This mobile number is already registered. Use a different number." });
    }
    const { wait } = await issueOtp(newMobile, "recovery");
    if (wait) return res.status(429).json({ detail: `Please wait ${wait}s before requesting another OTP.` });
    res.json({ detail: "OTP sent to the new mobile number." });
  } catch (err) {
    console.error("[auth/recover/mobile]", err);
    if (otpSendFailed(res, err)) return;
    res.status(500).json({ detail: "Recovery failed. Please try again." });
  }
});

// ── Worker recovery: lost phone → step 2 confirm + claim the account ────
router.post("/worker/recover/mobile/confirm", otpVerifyLimiter, async (req, res) => {
  try {
    const workerId = String(req.body?.worker_id || "").trim().toUpperCase();
    const key = String(req.body?.recovery_key || "").trim().toUpperCase();
    const newMobile = String(req.body?.new_mobile_number || "").replace(/\D/g, "");
    const code = String(req.body?.otp || "").replace(/\D/g, "");

    const worker = await User.findOne({ role: "worker", worker_id: workerId, is_active: true });
    const keyOk = worker?.recovery_key_hash && key ? worker.recovery_key_hash === sha256(key) : false;
    if (!worker || !keyOk) return res.status(401).json({ detail: "Invalid worker ID or recovery key." });

    const result = await consumeOtp(newMobile, code, "recovery");
    if (!result.ok) return res.status(400).json({ detail: result.reason });

    // The new number is now verified by definition (its owner typed the OTP).
    worker.mobile_number = newMobile;
    worker.is_phone_verified = true;
    await worker.save();
    await audit({
      actorRole: "worker", actorIdentifier: workerId, action: "worker.recover.mobile",
      resourceType: "user", resourceId: String(worker._id), ip: req.ip, success: true,
    });
    res.json({ access_token: await startSession(req, res, worker), token_type: "bearer", worker: worker.toWorkerJSON() });
  } catch (err) {
    console.error("[auth/recover/mobile/confirm]", err);
    res.status(500).json({ detail: "Recovery failed. Please try again." });
  }
});

// ── Employer: register (mobile + password, OTP via dev terminal) ────────
router.post("/employer/register", registerLimiter, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile_number || "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobile)) {
      return res.status(422).json({ detail: [{ loc: ["body", "mobile_number"], msg: "Enter a valid 10-digit Indian mobile number" }] });
    }
    const fullName = String(req.body?.full_name || "").trim();
    if (fullName.length < 2) {
      return res.status(422).json({ detail: [{ loc: ["body", "full_name"], msg: "Full name is required" }] });
    }
    const password = String(req.body?.password || "");
    if (password.length < 6) {
      return res.status(422).json({ detail: [{ loc: ["body", "password"], msg: "Password must be at least 6 characters" }] });
    }

    const existing = await User.findOne({ mobile_number: mobile });
    if (existing && existing.is_phone_verified) {
      return res.status(409).json({ detail: "This mobile number is already registered. Please log in." });
    }
    if (existing && !existing.is_phone_verified) {
      const { wait } = await issueOtp(mobile, "register");
      if (wait) return res.status(429).json({ detail: `Please wait ${wait}s before requesting another OTP.` });
      return res.status(200).json({ resent: true });
    }

    const recoveryKey = generateRecoveryKey();
    // Location + business name are optional but strongly encouraged: the
    // labour office that must ACCEPT this employer scopes its review queue by
    // state/district, so an employer without location is only reviewable by a
    // superadmin or a state official.
    const cleanLoc = (v) => {
      const s = String(v || "").trim();
      return s.length ? s.slice(0, 80) : null;
    };
    await User.create({
      role: "employer",
      full_name: fullName,
      business_name: cleanLoc(req.body?.business_name),
      current_state: cleanLoc(req.body?.business_state ?? req.body?.current_state),
      current_district: cleanLoc(req.body?.business_district ?? req.body?.current_district),
      current_village_or_city: cleanLoc(req.body?.current_village_or_city),
      mobile_number: mobile,
      password_hash: await hashPassword(password),
      recovery_key_hash: sha256(recoveryKey),
      preferred_language: req.body?.preferred_language || "en",
      is_phone_verified: false,
      // NEW: employer accounts now go through the same labour-office
      // acceptance gate as workers (posting jobs / rating workers stays
      // locked until a jurisdiction official accepts the account).
      gov_approve_status: "pending",
    });
    const { wait } = await issueOtp(mobile, "register");
    if (wait) return res.status(429).json({ detail: `Please wait ${wait}s before requesting another OTP.` });
    res.status(201).json({
      mobile_number: mobile,
      recovery_key: recoveryKey,
      gov_approve_status: "pending",
      detail: "Registration received. A labour office must accept this account before it can post jobs or rate workers.",
    });
  } catch (err) {
    console.error("[auth/employer/register]", err);
    if (otpSendFailed(res, err)) return;
    res.status(500).json({ detail: "Registration failed. Please try again." });
  }
});

// ── Employer: current profile (fresh approval state after login) ────────
router.get("/employer/me", authenticate, requireEmployer, async (req, res) => {
  try {
    const employer = await User.findById(req.userId);
    if (!employer) return res.status(404).json({ detail: "Employer not found" });
    res.json(employer.toEmployerJSON());
  } catch (err) {
    console.error("[auth/employer/me]", err);
    res.status(500).json({ detail: "Could not load profile." });
  }
});

// ── Employer: verify registration OTP ───────────────────────────────────
router.post("/employer/otp/verify", otpVerifyLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const code = String(req.body.otp || "").replace(/\D/g, "");
    const result = await consumeOtp(mobile, code, "register");
    if (!result.ok) return res.status(400).json({ detail: result.reason });
    const employer = await User.findOne({ role: "employer", mobile_number: mobile });
    if (!employer) return res.status(404).json({ detail: "Registration not found." });
    employer.is_phone_verified = true;
    await employer.save();
    res.json({ access_token: await startSession(req, res, employer), token_type: "bearer", employer: employer.toEmployerJSON() });
  } catch (err) {
    console.error("[auth/employer/otp/verify]", err);
    res.status(500).json({ detail: "Verification failed. Please try again." });
  }
});

// ── Employer: OTP login (request + verify) ─────────────────────────────
router.post("/employer/login/otp/request", otpRequestLimiter, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile_number || "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobile)) {
      return res.status(422).json({ detail: "Enter a valid 10-digit Indian mobile number" });
    }
    // Enumeration defense: same 200 either way, OTP goes to the real owner.
    await issueOtp(mobile, "login");
    res.json({ detail: "OTP sent" });
  } catch (err) {
    console.error("[auth/employer/otp/request]", err);
    if (otpSendFailed(res, err)) return;
    res.status(500).json({ detail: "Could not send OTP. Please try again." });
  }
});

router.post("/employer/login/otp", otpVerifyLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const code = String(req.body.otp || "").replace(/\D/g, "");
    const result = await consumeOtp(mobile, code, "login");
    if (!result.ok) return res.status(400).json({ detail: result.reason });
    const employer = await User.findOne({ role: "employer", mobile_number: mobile });
    if (!employer) return res.status(404).json({ detail: "No employer account for this number." });
    if (!employer.is_active) return res.status(403).json({ detail: "Account disabled." });
    if (!employer.is_phone_verified) {
      employer.is_phone_verified = true;
      await employer.save();
    }
    res.json({ access_token: await startSession(req, res, employer), token_type: "bearer", employer: employer.toEmployerJSON() });
  } catch (err) {
    console.error("[auth/employer/otp/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
  }
});

// ── Employer: password login / OTP share ────────────────────────────────
router.post("/employer/login", workerLoginLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const employer = await User.findOne({ role: "employer", mobile_number: mobile });
    const ok = employer?.password_hash ? await verifyPassword(String(req.body.password || ""), employer.password_hash) : false;
    if (!employer || !ok) {
      await audit({
        actorRole: "employer", actorIdentifier: mobile, action: "employer.login.password",
        resourceType: "user", resourceId: null, ip: req.ip, success: false, failureReason: "invalid credentials",
      });
      return res.status(401).json({ detail: "Invalid mobile number or password." });
    }
    if (!employer.is_active) return res.status(403).json({ detail: "Account disabled." });
    if (!employer.is_phone_verified) {
      return res.status(403).json({ detail: "Account not verified. Complete registration with the OTP sent to your mobile." });
    }
    res.json({ access_token: await startSession(req, res, employer), token_type: "bearer", employer: employer.toEmployerJSON() });
  } catch (err) {
    console.error("[auth/employer/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
  }
});

// ── Citizen: register (household / general public access) ───────────────
// A citizen is NOT a worker and needs no labour-office gate for their own
// account: they use the public directory and can post help requests near
// their area. Workers' contact details stay private — a citizen only ever
// reaches a worker when that worker ACCEPTS the citizen's request (both
// sides then see each other's number).
router.post("/citizen/register", registerLimiter, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile_number || "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobile)) {
      return res.status(422).json({ detail: [{ loc: ["body", "mobile_number"], msg: "Enter a valid 10-digit Indian mobile number" }] });
    }
    const fullName = String(req.body?.full_name || "").trim();
    if (fullName.length < 2) {
      return res.status(422).json({ detail: [{ loc: ["body", "full_name"], msg: "Full name is required" }] });
    }
    const password = String(req.body?.password || "");
    if (password.length < 6) {
      return res.status(422).json({ detail: [{ loc: ["body", "password"], msg: "Password must be at least 6 characters" }] });
    }

    const existing = await User.findOne({ mobile_number: mobile });
    if (existing && existing.is_phone_verified) {
      return res.status(409).json({ detail: "This mobile number is already registered. Please log in." });
    }
    if (existing && !existing.is_phone_verified) {
      const { wait } = await issueOtp(mobile, "register");
      if (wait) return res.status(429).json({ detail: `Please wait ${wait}s before requesting another OTP.` });
      return res.status(200).json({ resent: true });
    }

    const recoveryKey = generateRecoveryKey();
    const cleanLoc = (v) => {
      const s = String(v || "").trim();
      return s.length ? s.slice(0, 80) : null;
    };
    await User.create({
      role: "citizen",
      full_name: fullName,
      current_village_or_city: cleanLoc(req.body?.current_village_or_city),
      current_district: cleanLoc(req.body?.current_district),
      current_state: cleanLoc(req.body?.current_state),
      mobile_number: mobile,
      password_hash: await hashPassword(password),
      recovery_key_hash: sha256(recoveryKey),
      preferred_language: req.body?.preferred_language || "en",
      is_phone_verified: false,
    });
    const { wait } = await issueOtp(mobile, "register");
    if (wait) return res.status(429).json({ detail: `Please wait ${wait}s before requesting another OTP.` });
    res.status(201).json({ mobile_number: mobile, recovery_key: recoveryKey });
  } catch (err) {
    console.error("[auth/citizen/register]", err);
    if (otpSendFailed(res, err)) return;
    res.status(500).json({ detail: "Registration failed. Please try again." });
  }
});

router.post("/citizen/otp/verify", otpVerifyLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const code = String(req.body.otp || "").replace(/\D/g, "");
    const result = await consumeOtp(mobile, code, "register");
    if (!result.ok) return res.status(400).json({ detail: result.reason });
    const citizen = await User.findOne({ role: "citizen", mobile_number: mobile });
    if (!citizen) return res.status(404).json({ detail: "Registration not found." });
    citizen.is_phone_verified = true;
    await citizen.save();
    res.json({ access_token: await startSession(req, res, citizen), token_type: "bearer", citizen: citizen.toCitizenJSON() });
  } catch (err) {
    console.error("[auth/citizen/otp/verify]", err);
    res.status(500).json({ detail: "Verification failed. Please try again." });
  }
});

router.post("/citizen/login/otp/request", otpRequestLimiter, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile_number || "").replace(/\D/g, "");
    if (!MOBILE_RE.test(mobile)) {
      return res.status(422).json({ detail: "Enter a valid 10-digit Indian mobile number" });
    }
    await issueOtp(mobile, "login");
    res.json({ detail: "OTP sent" });
  } catch (err) {
    console.error("[auth/citizen/otp/request]", err);
    if (otpSendFailed(res, err)) return;
    res.status(500).json({ detail: "Could not send OTP. Please try again." });
  }
});

router.post("/citizen/login/otp", otpVerifyLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const code = String(req.body.otp || "").replace(/\D/g, "");
    const result = await consumeOtp(mobile, code, "login");
    if (!result.ok) return res.status(400).json({ detail: result.reason });
    const citizen = await User.findOne({ role: "citizen", mobile_number: mobile });
    if (!citizen) return res.status(404).json({ detail: "No citizen account for this number." });
    if (!citizen.is_active) return res.status(403).json({ detail: "Account disabled." });
    if (!citizen.is_phone_verified) {
      citizen.is_phone_verified = true;
      await citizen.save();
    }
    res.json({ access_token: await startSession(req, res, citizen), token_type: "bearer", citizen: citizen.toCitizenJSON() });
  } catch (err) {
    console.error("[auth/citizen/otp/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
  }
});

router.post("/citizen/login", workerLoginLimiter, async (req, res) => {
  try {
    const mobile = String(req.body.mobile_number || "").replace(/\D/g, "");
    const citizen = await User.findOne({ role: "citizen", mobile_number: mobile });
    const ok = citizen?.password_hash ? await verifyPassword(String(req.body.password || ""), citizen.password_hash) : false;
    if (!citizen || !ok) {
      await audit({
        actorRole: "citizen", actorIdentifier: mobile, action: "citizen.login.password",
        resourceType: "user", resourceId: null, ip: req.ip, success: false, failureReason: "invalid credentials",
      });
      return res.status(401).json({ detail: "Invalid mobile number or password." });
    }
    if (!citizen.is_active) return res.status(403).json({ detail: "Account disabled." });
    if (!citizen.is_phone_verified) {
      return res.status(403).json({ detail: "Account not verified. Complete registration with the OTP sent to your mobile." });
    }
    res.json({ access_token: await startSession(req, res, citizen), token_type: "bearer", citizen: citizen.toCitizenJSON() });
  } catch (err) {
    console.error("[auth/citizen/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
  }
});

router.get("/citizen/me", authenticate, requireCitizen, async (req, res) => {
  try {
    const citizen = await User.findById(req.userId);
    if (!citizen) return res.status(404).json({ detail: "Citizen not found" });
    res.json(citizen.toCitizenJSON());
  } catch (err) {
    console.error("[auth/citizen/me]", err);
    res.status(500).json({ detail: "Could not load profile." });
  }
});

// ── Government login ─────────────────────────────────────────────────
router.post("/government/login", governmentLoginLimiter, async (req, res) => {
  try {
    const employeeId = String(req.body.employee_id || "").trim();
    const password = String(req.body.password || "");
    const official = await User.findOne({ role: "government", employee_id: employeeId });
    const ok = official?.password_hash ? await verifyPassword(password, official.password_hash) : false;
    if (!official || !ok) {
      await audit({
        actorRole: "government", actorIdentifier: employeeId, action: "government.login",
        resourceType: "user", resourceId: null, ip: req.ip, success: false, failureReason: "invalid credentials",
      });
      return res.status(401).json({ detail: "Invalid employee ID or password." });
    }
    if (!official.is_active) return res.status(403).json({ detail: "Account disabled." });
    await audit({
      actorRole: "government", actorIdentifier: employeeId, action: "government.login",
      resourceType: "user", resourceId: String(official._id), ip: req.ip, success: true,
    });
    res.json({ access_token: await startSession(req, res, official), token_type: "bearer", government: official.toGovernmentJSON() });
  } catch (err) {
    console.error("[auth/gov/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
  }
});

// ── Who is this? ─────────────────────────────────────────────────────
// One endpoint that answers a route guard's only question: which role is the
// cookie/bearer session? Before this, a page load could fire three different
// "am I allowed here" requests (one per token store) and they could disagree.
// The role comes from the verified token, never from the client.
//
// A worker session also carries the profile. The SPA boots its worker context
// from this one answer and renders nothing until `worker` is present, so a
// response with the role alone looked exactly like a signed-out visitor: every
// hard refresh or deep link bounced a signed-in worker back to the login page,
// while in-app navigation (which already has the login payload) kept working and
// hid the fault.
router.get("/session", authenticate, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.userRole !== "worker") {
    return res.json({ role: req.userRole });
  }
  const worker = await User.findById(req.userId);
  if (!worker || !worker.is_active) {
    return res.status(401).json({ detail: "Not authenticated", code: "no_token" });
  }
  res.json({ role: "worker", worker: worker.toWorkerJSON() });
});

// ── Session refresh ──────────────────────────────────────────────────
// The access cookie lives 15 minutes, so the SPA silently trades its refresh
// cookie for a new pair. Rotation makes a copied refresh token detectable: the
// second use of a rotated token revokes the whole chain instead of minting a
// second live session.
router.post("/refresh", async (req, res) => {
  const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
  // Double-submit: this endpoint sets cookies, so a cross-site caller must not
  // be able to drive it. Browsers send the CSRF cookie automatically too, so
  // the header is the part an attacker cannot supply.
  if (!csrfValid(req)) {
    return res.status(403).json({ detail: "CSRF token missing or invalid", code: "csrf_failed" });
  }
  try {
    const result = await rotateSession(req, res, token);
    if (!result.ok) {
      clearSessionCookies(res);
      const detail = result.reason === "reused" ? "Session revoked. Please sign in again." : "Not authenticated";
      return res.status(401).json({ detail, code: result.reason === "reused" ? "session_reused" : "no_token" });
    }
    const user = await User.findById(result.userId).select("is_active").lean();
    if (!user || !user.is_active) {
      clearSessionCookies(res);
      return res.status(401).json({ detail: "Account disabled or removed.", code: "account_disabled" });
    }
    res.json({ ok: true, role: result.role });
  } catch (err) {
    console.error("[auth/refresh]", err);
    res.status(500).json({ detail: "Session refresh failed." });
  }
});

// ── Logout ───────────────────────────────────────────────────────────
// Revokes the presented refresh session server-side and clears all three
// cookies. A logout that only deleted a client token left the session working
// for anyone who had already copied it.
router.post("/logout", async (req, res) => {
  try {
    await revokeSession(readCookie(req.headers.cookie, REFRESH_COOKIE));
  } catch (err) {
    console.error("[auth/logout]", err);
  }
  clearSessionCookies(res);
  res.json({ ok: true });
});

// ── Government: me ───────────────────────────────────────────────────
router.get("/government/me", authenticate, requireGovernment, async (req, res) => {
  const official = await User.findById(req.userId);
  if (!official) return res.status(401).json({ detail: "Not authenticated" });
  res.json(official.toGovernmentJSON());
});

export default router;
