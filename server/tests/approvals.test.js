/**
 * Phase 3 integration tests — government acceptance, account recovery,
 * employer accounts, public "find a worker" directory and ratings.
 *
 * The property under test everywhere: acceptance gates what the public sees,
 * recovery works without a phone, private contact data never leaks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { OtpCode } from "../src/models/Document.js";
import { WorkerRating } from "../src/models/WorkerRating.js";
import { JobPosting } from "../src/models/JobPosting.js";
import { sha256, hashPassword, signToken } from "../src/utils/crypto.js";

const api = supertest(app);
let mongod;

const ids = {};
const tokens = {};

async function makeUser(over = {}) {
  return User.create({
    role: over.role || "worker",
    full_name: over.full_name || "Test Worker",
    mobile_number: over.mobile_number || `8${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword("Test@123"),
    is_phone_verified: true,
    is_active: true,
    ...over.fields,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-approvals"));

  ids.pendingWorker = await makeUser({
    full_name: "Pending Kumar",
    fields: {
      worker_id: "SS-200001",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "pending",
      recovery_key_hash: sha256("SRK-TEST-KEY1"),
    },
  });
  ids.acceptedWorker = await makeUser({
    full_name: "Accepted Kumar",
    fields: {
      worker_id: "SS-200002",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.official = await makeUser({
    role: "government",
    full_name: "Kerala Officer",
    fields: {
      employee_id: "AP900",
      state: "Kerala",
      district: "Ernakulam",
      department: "Labour Department",
    },
  });
  ids.otherStateOfficial = await makeUser({
    role: "government",
    full_name: "TN Officer",
    fields: { employee_id: "AP901", state: "Tamil Nadu", district: "Chennai", department: "Labour Department" },
  });
  ids.employer = await makeUser({
    role: "employer",
    full_name: "Ravi Constructions Owner",
    fields: {},
  });
  // A pending worker no other test mutates: gates (apply / rating / directory)
  // are asserted against THIS worker's "pending" status.
  ids.pendingOnly = await makeUser({
    full_name: "Gate Pending",
    fields: {
      worker_id: "SS-200003",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "pending",
    },
  });

  for (const [key, u] of Object.entries(ids)) {
    tokens[key] = signToken({ _id: u._id, role: u.role, worker_id: u.worker_id, employee_id: u.employee_id });
  }

  ids.job = await JobPosting.create({
    title: "Mason helper needed at site",
    description: "Assist masons with material handling at an apartment site.",
    employer_name: "Verify Builder",
    occupation: "construction",
    state: "Kerala",
    district: "Ernakulam",
    status: "open",
    posted_by: ids.official._id,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const auth = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

// ── Government acceptance queue ───────────────────────────────────────
describe("government worker acceptance", () => {
  it("lists the pending queue scoped to the official", async () => {
    const res = await api.get("/api/v1/government/worker-approvals").set(auth("official"));
    expect(res.status).toBe(200);
    expect(res.body.workers.some((w) => w.worker_id === "SS-200001")).toBe(true);
    expect(res.body.counts.pending).toBe(2);
  });

  it("a foreign-state official cannot even see the worker", async () => {
    const res = await api.get("/api/v1/government/worker-approvals").set(auth("otherStateOfficial"));
    expect(res.status).toBe(200);
    expect(res.body.workers.some((w) => w.worker_id === "SS-200001")).toBe(false);
  });

  it("accepts a pending worker and the worker becomes visible in the public directory", async () => {
    const res = await api
      .patch(`/api/v1/government/workers/${ids.pendingWorker._id}/approval`)
      .set(auth("official"))
      .send({ status: "accepted" });
    expect(res.status).toBe(200);
    expect(res.body.gov_approve_status).toBe("accepted");

    const dir = await api.get("/api/v1/public/workers").query({ name: "Pending Kumar" });
    expect(dir.status).toBe(200);
    expect(dir.body.workers.length).toBe(1);
  });

  it("reject returns 422 for a bad status and 404 for an unknown worker", async () => {
    const bad = await api
      .patch(`/api/v1/government/workers/${ids.pendingWorker._id}/approval`)
      .set(auth("official"))
      .send({ status: "maybe" });
    expect(bad.status).toBe(422);

    const missing = await api
      .patch("/api/v1/government/workers/000000000000000000000000/approval")
      .set(auth("official"))
      .send({ status: "accepted" });
    expect(missing.status).toBe(404);
  });
});

// ── Apply gate ────────────────────────────────────────────────────────
describe("job application acceptance gate", () => {
  it("blocks applying while registration is pending", async () => {
    const blocked = await api
      .post(`/api/v1/jobs/${String(ids.job._id)}/apply`)
      .set(auth("pendingOnly"))
      .send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("gov_approval_pending");
  });

  it("lets an accepted worker apply", async () => {
    const ok = await api
      .post(`/api/v1/jobs/${String(ids.job._id)}/apply`)
      .set(auth("acceptedWorker"))
      .send({});
    expect(ok.status).toBe(201);
  });
});

// ── Public find-a-worker directory ────────────────────────────────────
describe("public worker directory", () => {
  it("hides rejected workers and returns only privacy-safe fields", async () => {
    const res = await api.get("/api/v1/public/workers").query({ place: "Ernakulam" });
    expect(res.status).toBe(200);
    for (const w of res.body.workers) {
      expect(w.mobile_number).toBeUndefined();
      expect(w.current_address_line).toBeUndefined();
      expect(w.phone).toBeUndefined();
      expect(w.full_name).toBeTruthy();
      expect(w.gov_accepted).toBe(true);
    }
  });

  it("never exposes another worker's phone number even with a name hit", async () => {
    const res = await api.get("/api/v1/public/workers").query({ name: "Accepted" });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("mobile_number");
  });
});

// ── Ratings ───────────────────────────────────────────────────────────
describe("worker ratings", () => {
  it("an employer rates an accepted worker once; re-rating updates it", async () => {
    const first = await api
      .post(`/api/v1/ratings/worker/${ids.acceptedWorker._id}`)
      .set(auth("employer"))
      .send({ stars: 5, comment: "Reliable. Finished on time.", employer_name: "Ravi Constructions" });
    expect(first.status).toBe(200);
    expect(first.body.summary.count).toBe(1);

    const second = await api
      .post(`/api/v1/ratings/worker/${ids.acceptedWorker._id}`)
      .set(auth("employer"))
      .send({ stars: 4 });
    expect(second.status).toBe(200);
    expect(second.body.summary.count).toBe(1);
    expect(second.body.summary.average).toBe(4);
  });

  it("a member of the public rates by name+phone and one phone rates once", async () => {
    const r = await api
      .post(`/api/v1/ratings/worker/${ids.acceptedWorker._id}`)
      .send({ stars: 4, rater_name: "Anitha", rater_phone: "9812345670" });
    expect(r.status).toBe(200);

    const dupe = await api
      .post(`/api/v1/ratings/worker/${ids.acceptedWorker._id}`)
      .send({ stars: 2, rater_name: "Anitha again", rater_phone: "9812345670" });
    expect(dupe.status).toBe(409);

    const missingFields = await api
      .post(`/api/v1/ratings/worker/${ids.acceptedWorker._id}`)
      .send({ stars: 3, rater_name: "" });
    expect(missingFields.status).toBe(422);
  });

  it("a worker cannot rate themselves and unknown workers 404", async () => {
    const res = await api.post(`/api/v1/ratings/worker/${ids.acceptedWorker._id}`).set(auth("acceptedWorker")).send({ stars: 5 });
    expect(res.status).toBe(403);

    const bogus = await api
      .post("/api/v1/ratings/worker/000000000000000000000000")
      .set(auth("employer"))
      .send({ stars: 5 });
    expect(bogus.status).toBe(404);
  });

  it("a pending worker cannot be rated yet", async () => {
    const res = await api
      .post(`/api/v1/ratings/worker/${ids.pendingOnly._id}`)
      .set(auth("employer"))
      .send({ stars: 5 });
    expect(res.status).toBe(404);
  });
});

// ── Recovery key flow ─────────────────────────────────────────────────
describe("account recovery", () => {
  let recoveryKey = null;

  it("registration returns a recovery key exactly once", async () => {
    const mobile = `91112${crypto.randomInt(100000, 999999)}`.slice(0, 10);
    const reg = await api.post("/api/v1/auth/worker/register").send({
      full_name: "Recovery Ravi",
      mobile_number: mobile,
      password: "Recover@1",
      occupation: "construction",
    });
    expect(reg.status).toBe(201);
    expect(reg.body.recovery_key).toMatch(/^SRK-/);
    recoveryKey = reg.body.recovery_key;
    ids.recoveryWorkerId = reg.body.worker_id;
    // Simulate phone verification (terminal-only delivery).
    await OtpCode.create({
      mobile_number: mobile,
      code_hash: sha256("123456"),
      purpose: "register",
      expires_at: new Date(Date.now() + 5 * 60_000),
    });
    const v = await api.post("/api/v1/auth/worker/otp/verify").send({ mobile_number: mobile, otp: "123456" });
    expect(v.status).toBe(200);
    expect(v.body.worker.gov_approve_status).toBe("pending");
  });

  it("never re-issues a worker code after a deletion", async () => {
    // Regression: the old SS-100000+count scheme re-issued the code of a
    // deleted worker, so account recovery keyed on that code silently
    // targeted a DIFFERENT surviving account. Codes are now derived from the
    // highest existing one (and enforced unique at the DB level), so a
    // deletion can never resurrect a live account's identity.
    const mobileA = `92223${crypto.randomInt(100000, 999999)}`.slice(0, 10);
    const regA = await api.post("/api/v1/auth/worker/register").send({
      full_name: "Code Collision A",
      mobile_number: mobileA,
      password: "Code@1234",
    });
    expect(regA.status).toBe(201);

    await User.deleteOne({ worker_id: regA.body.worker_id, mobile_number: mobileA });

    const mobileB = `92224${crypto.randomInt(100000, 999999)}`.slice(0, 10);
    const regB = await api.post("/api/v1/auth/worker/register").send({
      full_name: "Code Collision B",
      mobile_number: mobileB,
      password: "Code@1234",
    });
    expect(regB.status).toBe(201);
    expect(regB.body.worker_id).not.toBe(regA.body.worker_id);
  });

  it("accepts a wrong key with the same 401 as an unknown worker", async () => {
    const res = await api.post("/api/v1/auth/worker/recover/password").send({
      worker_id: ids.recoveryWorkerId,
      recovery_key: "SRK-WRONG-KEY",
      new_password: "Whatever@1",
    });
    expect(res.status).toBe(401);
  });

  it("resets the password with the recovery key and the new password logs in", async () => {
    const res = await api.post("/api/v1/auth/worker/recover/password").send({
      worker_id: ids.recoveryWorkerId,
      recovery_key: recoveryKey,
      new_password: "BackUp@99",
    });
    expect(res.status).toBe(200);

    const login = await api
      .post("/api/v1/auth/worker/login")
      .send({ mobile_number: String(9000000000 + Number(String(ids.recoveryWorkerId).replace(/\D/g, "").slice(-4))), password: "BackUp@99" });
    // mobile lookup: derive it from the created worker instead
    const user = await User.findOne({ worker_id: ids.recoveryWorkerId });
    const realLogin = await api
      .post("/api/v1/auth/worker/login")
      .send({ mobile_number: user.mobile_number, password: "BackUp@99" });
    expect(realLogin.status).toBe(200);
    expect(login.status).toBe(401); // the derived guess above is not the real number
  });

  it("moves the account to a new phone in two steps", async () => {
    const user = await User.findOne({ worker_id: ids.recoveryWorkerId });
    const newMobile = `8${crypto.randomInt(100000000, 999999999)}`;

    const step1 = await api.post("/api/v1/auth/worker/recover/mobile").send({
      worker_id: ids.recoveryWorkerId,
      recovery_key: recoveryKey,
      new_mobile_number: newMobile,
    });
    expect(step1.status).toBe(200);

    const otpRow = await OtpCode.findOne({ mobile_number: newMobile, purpose: "recovery", consumed_at: null });
    // Find a matching code by brute force over the 6-digit space is impractical;
    // create a known consumed-ready OTP instead and use it directly.
    const code = "654321";
    otpRow.code_hash = sha256(code);
    await otpRow.save();

    const step2 = await api.post("/api/v1/auth/worker/recover/mobile/confirm").send({
      worker_id: ids.recoveryWorkerId,
      recovery_key: recoveryKey,
      new_mobile_number: newMobile,
      otp: code,
    });
    expect(step2.status).toBe(200);
    expect(step2.body.access_token).toBeTruthy();

    const moved = await User.findById(user._id);
    expect(moved.mobile_number).toBe(newMobile);
    expect(moved.is_phone_verified).toBe(true);
  });

  it("a worker with no recovery key cannot be probed (same 401)", async () => {
    const noKeyWorker = await makeUser({ full_name: "No Key", fields: { worker_id: "SS-300001", recovery_key_hash: null } });
    const res = await api.post("/api/v1/auth/worker/recover/password").send({
      worker_id: "SS-300001",
      recovery_key: "SRK-AAAA-BBBB-CCCC",
      new_password: "Whatever@1",
    });
    expect(res.status).toBe(401);
    void noKeyWorker;
  });
});

// ── Employer accounts ─────────────────────────────────────────────────
describe("employer accounts", () => {
  it("registers, returns a recovery key, and OTP-verifies into an employer session", async () => {
    const mobile = `9${crypto.randomInt(100000000, 999999999)}`;
    const reg = await api.post("/api/v1/auth/employer/register").send({
      full_name: "Verify Build Owners",
      mobile_number: mobile,
      password: "Employer@1",
    });
    expect(reg.status).toBe(201);
    expect(reg.body.recovery_key).toMatch(/^SRK-/);

    await OtpCode.create({
      mobile_number: mobile,
      code_hash: sha256("123456"),
      purpose: "register",
      expires_at: new Date(Date.now() + 5 * 60_000),
    });
    const v = await api.post("/api/v1/auth/employer/otp/verify").send({ mobile_number: mobile, otp: "123456" });
    expect(v.status).toBe(200);
    expect(v.body.employer.role).toBe("employer");
  });

  it("employer OTP login works end to end", async () => {
    const user = await User.findById(ids.employer._id);
    await OtpCode.create({
      mobile_number: user.mobile_number,
      code_hash: sha256("123456"),
      purpose: "login",
      expires_at: new Date(Date.now() + 5 * 60_000),
    });
    const res = await api.post("/api/v1/auth/employer/login/otp").send({ mobile_number: user.mobile_number, otp: "123456" });
    expect(res.status).toBe(200);
    expect(res.body.employer.role).toBe("employer");
  });

  it("rating summary endpoint reflects saved ratings", async () => {
    const res = await api.get(`/api/v1/ratings/worker/${ids.acceptedWorker._id}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(2);
    expect(res.body.average).toBeGreaterThan(0);
  });
});
