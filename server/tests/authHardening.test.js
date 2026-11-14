/**
 * Phase 1 auth hardening — OTP delivery, digest keying, atomic consumption.
 *
 * The failures this guards against are the quiet ones:
 *  - a gateway error swallowed by a fire-and-forget send, so the worker waits
 *    for a code that was never sent while the UI says "OTP sent";
 *  - a plain sha256 digest, reversible from a database dump because six digits
 *    is a million candidates;
 *  - read-then-write verification, where two parallel requests both "consume"
 *    the same code and both get a session.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

// The adapter is mocked so a test can make delivery fail on demand; the default
// behaviour still "delivers" (no-op), which is all the routes need.
const sms = vi.hoisted(() => ({ fail: false, sent: [] }));
vi.mock("../src/services/smsAdapter.js", () => ({
  send: async (mobile, code) => {
    if (sms.fail) throw new Error("gateway timeout");
    sms.sent.push({ mobile, code });
  },
}));

const { default: app } = await import("../src/app.js");
const { User } = await import("../src/models/User.js");
const { OtpCode } = await import("../src/models/Document.js");
const { hashPassword, sha256, hashOtp } = await import("../src/utils/crypto.js");
const { config } = await import("../src/config.js");

const api = supertest(app);
let mongod;

const MAX = config.otp.maxAttempts;
const MOBILE = "9123400001";

/** A live OTP row for `mobile`, exactly as issueOtp would have written it. */
async function giveOtp(mobile, code, purpose = "login") {
  await OtpCode.deleteMany({ mobile_number: mobile, purpose });
  await OtpCode.create({
    mobile_number: mobile,
    code_hash: hashOtp(code),
    purpose,
    expires_at: new Date(Date.now() + 60_000),
    last_sent_at: new Date(),
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-test"));
  await User.create({
    role: "worker",
    full_name: "OTP Test Worker",
    mobile_number: MOBILE,
    password_hash: await hashPassword("Worker@123"),
    is_phone_verified: true,
    is_active: true,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  sms.fail = false;
  sms.sent.length = 0;
});

describe("OTP delivery failures", () => {
  it("answers 502 (not 200) when the SMS gateway rejects the message", async () => {
    sms.fail = true;
    const r = await api.post("/api/v1/auth/worker/login/otp/request").send({ mobile_number: "9123400002" });
    expect(r.status).toBe(502);
    expect(r.body.detail).toBe("Could not send OTP");
  });

  it("leaves no OTP row behind, so the next attempt is not rate-limited by a code nobody received", async () => {
    sms.fail = true;
    await api.post("/api/v1/auth/worker/login/otp/request").send({ mobile_number: "9123400003" });
    expect(await OtpCode.countDocuments({ mobile_number: "9123400003" })).toBe(0);

    sms.fail = false;
    const retry = await api.post("/api/v1/auth/worker/login/otp/request").send({ mobile_number: "9123400003" });
    expect(retry.status).toBe(200);
    expect(sms.sent.at(-1).mobile).toBe("9123400003");
  });

  it("a delivered code is stored as a peppered HMAC, never as a plain hash", async () => {
    const r = await api.post("/api/v1/auth/worker/login/otp/request").send({ mobile_number: "9123400004" });
    expect(r.status).toBe(200);
    const { code } = sms.sent.at(-1);
    const row = await OtpCode.findOne({ mobile_number: "9123400004" });
    expect(row.code_hash).toBe(hashOtp(code));
    expect(row.code_hash).not.toBe(sha256(code));
  });
});

describe("OTP consumption is atomic and capped", () => {
  it("a code issued by the old plain-sha256 scheme no longer verifies", async () => {
    await OtpCode.deleteMany({ mobile_number: MOBILE });
    await OtpCode.create({
      mobile_number: MOBILE,
      code_hash: sha256("123456"),
      purpose: "login",
      expires_at: new Date(Date.now() + 60_000),
      last_sent_at: new Date(),
    });
    const r = await api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "123456" });
    expect(r.status).toBe(400);
    expect(r.body.detail).toBe("Incorrect OTP.");
  });

  it("two parallel verifies of the same code yield exactly one session", async () => {
    await giveOtp(MOBILE, "424242");
    const [a, b] = await Promise.all([
      api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "424242" }),
      api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "424242" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const won = [a, b].find((r) => r.status === 200);
    expect(won.body.access_token).toBeTruthy();
  });

  it("charges exactly one attempt per wrong guess and retires the code at the cap", async () => {
    await giveOtp(MOBILE, "555555");
    for (let i = 1; i <= MAX; i += 1) {
      const r = await api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "000000" });
      expect(r.status).toBe(400);
      const row = await OtpCode.findOne({ mobile_number: MOBILE });
      expect(row.attempts).toBe(i);
      if (i < MAX) expect(r.body.detail).toBe("Incorrect OTP.");
      else expect(r.body.detail).toBe("Too many attempts. Request a new code.");
    }
    // The real code is worthless once the cap is reached.
    const correct = await api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "555555" });
    expect(correct.status).toBe(400);
    expect(correct.body.detail).toBe("Too many attempts. Request a new code.");
  });

  it("does not credit a correct guess to an attempt slot twice under concurrency", async () => {
    await giveOtp(MOBILE, "999999");
    const wrong = Array.from({ length: 3 }, () =>
      api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "111111" })
    );
    await Promise.all(wrong);
    const row = await OtpCode.findOne({ mobile_number: MOBILE });
    expect(row.attempts).toBe(3);
    expect(row.consumed_at).toBeNull();

    const ok = await api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "999999" });
    expect(ok.status).toBe(200);
  });

  it("rejects an expired code even when the digits are right", async () => {
    await giveOtp(MOBILE, "777777");
    await OtpCode.updateOne({ mobile_number: MOBILE }, { expires_at: new Date(Date.now() - 1000) });
    const r = await api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "777777" });
    expect(r.status).toBe(400);
    expect(r.body.detail).toContain("expired");
  });

  it("a new code invalidates the previous unconsumed one", async () => {
    await giveOtp(MOBILE, "121212");
    await OtpCode.updateOne({ mobile_number: MOBILE }, { last_sent_at: new Date(Date.now() - 10 * 60_000) });
    const r = await api.post("/api/v1/auth/worker/login/otp/request").send({ mobile_number: MOBILE });
    expect(r.status).toBe(200);
    const fresh = sms.sent.at(-1).code;
    const old = await api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: "121212" });
    expect(old.status).toBe(400);
    const ok = await api.post("/api/v1/auth/worker/login/otp").send({ mobile_number: MOBILE, otp: fresh });
    expect(ok.status).toBe(200);
  });
});

describe("pepper is real keying, not decoration", () => {
  it("uses a different digest than an unkeyed hash for the same digits", () => {
    const digits = String(crypto.randomInt(100000, 999999));
    expect(hashOtp(digits)).not.toBe(sha256(digits));
    expect(hashOtp(digits)).toMatch(/^[0-9a-f]{64}$/);
  });
});
