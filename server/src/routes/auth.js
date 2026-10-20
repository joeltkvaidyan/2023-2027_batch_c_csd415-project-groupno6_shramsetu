import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { OtpCode } from "../models/Document.js";
import { hashPassword, verifyPassword, signToken, sha256, randomOtp } from "../utils/crypto.js";
import { validateDocumentFile } from "../utils/fileValidation.js";
import { config } from "../config.js";
import { authenticate, requireWorker, requireGovernment, audit } from "../middleware/auth.js";
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

// ── OTP delivery: printed to the backend terminal (dev/demo mode) ─────
function sendOtp(mobile, code) {
  const line = "─".repeat(52);
  console.log(`\n${line}`);
  console.log(`  📩 OTP for +91 ${mobile}:  ${code}`);
  console.log(`  (valid ${Math.round(config.otp.expireSeconds / 60)} min — ShramSetu dev terminal delivery)`);
  console.log(`${line}\n`);
  // Mirror to a file so automated checks can assert on THIS run's OTP even
  // when the API runs in a user terminal (node --watch) instead of a log we
  // control. Dev/demo convenience only; OTP_ECHO_ENABLED=false silences both.
  try {
    if (config.otp.echoEnabled) {
      fs.mkdirSync("logs", { recursive: true });
      fs.appendFileSync(
        "logs/otp-dev.log",
        `${new Date().toISOString()} +91 ${mobile} OTP ${code}\n`
      );
    }
  } catch {
    /* best-effort; never block the login flow over a log write */
  }
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
  await OtpCode.create({
    mobile_number: mobile,
    code_hash: sha256(code),
    purpose,
    expires_at: new Date(now.getTime() + config.otp.expireSeconds * 1000),
    last_sent_at: now,
  });
  sendOtp(mobile, code);
  return { wait: 0, code };
}

async function consumeOtp(mobile, code, purpose) {
  const row = await OtpCode.findOne({
    mobile_number: mobile,
    purpose,
    consumed_at: null,
    expires_at: { $gt: new Date() },
  }).sort({ createdAt: -1 });
  if (!row) return { ok: false, reason: "OTP expired or not requested. Request a new code." };
  if (row.attempts >= config.otp.maxAttempts) {
    row.consumed_at = new Date();
    await row.save();
    return { ok: false, reason: "Too many attempts. Request a new code." };
  }
  if (row.code_hash !== sha256(code)) {
    row.attempts += 1;
    await row.save();
    return { ok: false, reason: "Incorrect OTP." };
  }
  row.consumed_at = new Date();
  await row.save();
  return { ok: true };
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
  const last = await User.findOne({ role: "worker", worker_id: /^SS-\d{6}$/ })
    .sort({ worker_id: -1 })
    .select("worker_id")
    .lean();
  const floor = last ? Number.parseInt(last.worker_id.slice(3), 10) : 100000;
  await counters.updateOne({ _id: "worker_id" }, { $max: { seq: floor } }, { upsert: true });
  const updated = await counters.findOneAndUpdate(
    { _id: "worker_id" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  // Driver 6 returns the document directly; older shapes wrap it in `value`.
  const seq = Number(updated?.seq ?? updated?.value?.seq ?? floor + 1);
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
    res.json({ access_token: signToken(worker), token_type: "bearer", worker: worker.toWorkerJSON() });
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
    res.json({ access_token: signToken(worker), token_type: "bearer", worker: worker.toWorkerJSON() });
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
    res.json({ access_token: signToken(worker), token_type: "bearer", worker: worker.toWorkerJSON() });
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

router.post("/worker/logout", authenticate, (req, res) => res.json({ detail: "Logged out" }));

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
    res.json({ access_token: signToken(worker), token_type: "bearer", worker: worker.toWorkerJSON() });
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
    await User.create({
      role: "employer",
      full_name: fullName,
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
    console.error("[auth/employer/register]", err);
    res.status(500).json({ detail: "Registration failed. Please try again." });
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
    res.json({ access_token: signToken(employer), token_type: "bearer", employer: employer.toEmployerJSON() });
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
    res.json({ access_token: signToken(employer), token_type: "bearer", employer: employer.toEmployerJSON() });
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
    res.json({ access_token: signToken(employer), token_type: "bearer", employer: employer.toEmployerJSON() });
  } catch (err) {
    console.error("[auth/employer/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
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
    res.json({ access_token: signToken(official), token_type: "bearer", government: official.toGovernmentJSON() });
  } catch (err) {
    console.error("[auth/gov/login]", err);
    res.status(500).json({ detail: "Login failed. Please try again." });
  }
});

// ── Government: me ───────────────────────────────────────────────────
router.get("/government/me", authenticate, requireGovernment, async (req, res) => {
  const official = await User.findById(req.userId);
  if (!official) return res.status(401).json({ detail: "Not authenticated" });
  res.json(official.toGovernmentJSON());
});

export default router;
