/**
 * Worker insurance: the record, who may see what, and the honesty of "covered".
 *
 * The rule this file protects is the one a household depends on: the public
 * verify page may say "covered" only for a policy that is in force at the
 * moment of the check, and it must say whether a labour office actually checked
 * the policy or the worker simply typed it in.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { InsurancePolicy } from "../src/models/InsurancePolicy.js";
import { AuditLog } from "../src/models/Document.js";
import { hashPassword, signToken } from "../src/utils/crypto.js";
import { cardCode } from "../src/utils/cardToken.js";
import { policyStatus, pickCurrentPolicy } from "../src/utils/insurance.js";

const api = supertest(app);
let mongod;
const t = {};
let inScopeWorker;
let outOfScopeWorker;

async function makeUser(over = {}) {
  return User.create({
    role: over.role || "worker",
    full_name: over.full_name || "Test Worker",
    mobile_number: over.mobile_number || `9${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword("Test@123"),
    is_phone_verified: true,
    is_active: true,
    ...over.fields,
  });
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

const policyBody = (over = {}) => ({
  provider: "National Insurance Co.",
  policy_number: "NIC/KA/2026/0099231",
  coverage: "accident",
  sum_insured: 200000,
  valid_from: daysFromNow(-10).toISOString(),
  valid_to: daysFromNow(355).toISOString(),
  ...over,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-insurance"));

  inScopeWorker = await makeUser({
    full_name: "Lakshmi Devi",
    fields: {
      worker_id: "SS-800001",
      occupation: "Mason",
      current_state: "Karnataka",
      current_district: "Bengaluru Urban",
      gov_approve_status: "accepted",
    },
  });
  outOfScopeWorker = await makeUser({
    full_name: "Worker Elsewhere",
    fields: {
      worker_id: "SS-800002",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  const official = await makeUser({
    role: "government",
    full_name: "Official Rao",
    fields: { employee_id: "INS001", state: "Karnataka", district: "Bengaluru Urban" },
  });
  const employer = await makeUser({ role: "employer", full_name: "Site Owner" });

  t.worker = signToken({ _id: inScopeWorker._id, role: "worker" });
  t.outsideWorker = signToken({ _id: outOfScopeWorker._id, role: "worker" });
  t.official = signToken({ _id: official._id, role: "government" });
  t.employer = signToken({ _id: employer._id, role: "employer" });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("policyStatus()", () => {
  it("reads the clock, not a stored flag", () => {
    expect(policyStatus({ valid_from: daysFromNow(-1), valid_to: daysFromNow(1) })).toBe("active");
    expect(policyStatus({ valid_from: daysFromNow(-10), valid_to: daysFromNow(-1) })).toBe("expired");
    expect(policyStatus({ valid_from: daysFromNow(5), valid_to: daysFromNow(10) })).toBe("upcoming");
  });

  it("prefers verified cover over a longer self-declared one", () => {
    const now = new Date();
    const declared = {
      verification: "self_declared",
      valid_from: daysFromNow(-1),
      valid_to: daysFromNow(300),
    };
    const verified = {
      verification: "office_verified",
      valid_from: daysFromNow(-1),
      valid_to: daysFromNow(30),
    };
    expect(pickCurrentPolicy([declared, verified], now)).toBe(verified);
  });

  it("ignores cover that has expired, however well verified", () => {
    const expired = {
      verification: "office_verified",
      valid_from: daysFromNow(-100),
      valid_to: daysFromNow(-1),
    };
    expect(pickCurrentPolicy([expired])).toBe(null);
  });
});

describe("worker insurance records", () => {
  it("starts every entry as self-declared", async () => {
    const res = await api
      .post("/api/v1/insurance")
      .set("Authorization", `Bearer ${t.worker}`)
      .send(policyBody())
      .expect(201);

    expect(res.body.policy.verification).toBe("self_declared");
    expect(res.body.policy.status).toBe("active");
    expect(res.body.policy.policy_number).toBe("NIC/KA/2026/0099231");
  });

  it("refuses a policy that ended before it started", async () => {
    await api
      .post("/api/v1/insurance")
      .set("Authorization", `Bearer ${t.worker}`)
      .send(policyBody({ valid_from: daysFromNow(30), valid_to: daysFromNow(10) }))
      .expect(400);
  });

  it("refuses a policy that has already expired", async () => {
    await api
      .post("/api/v1/insurance")
      .set("Authorization", `Bearer ${t.worker}`)
      .send(
        policyBody({
          policy_number: "OLD/1",
          valid_from: daysFromNow(-400),
          valid_to: daysFromNow(-5),
        }),
      )
      .expect(400);
  });

  it("will not let one worker store the same policy number twice", async () => {
    await api
      .post("/api/v1/insurance")
      .set("Authorization", `Bearer ${t.worker}`)
      .send(policyBody())
      .expect(409);
  });

  it("refuses non-worker accounts", async () => {
    await api
      .post("/api/v1/insurance")
      .set("Authorization", `Bearer ${t.employer}`)
      .send(policyBody({ policy_number: "X/1" }))
      .expect(403);
  });

  it("lists the current policy for the worker's own session", async () => {
    const res = await api
      .get("/api/v1/insurance")
      .set("Authorization", `Bearer ${t.worker}`)
      .expect(200);

    expect(res.body.current).not.toBe(null);
    expect(res.body.current.provider).toBe("National Insurance Co.");
    expect(res.body.policies.length).toBeGreaterThan(0);
  });

  it("cannot see or touch another worker's policy", async () => {
    const created = await api
      .get("/api/v1/insurance")
      .set("Authorization", `Bearer ${t.worker}`)
      .expect(200);
    const id = created.body.policies[0].id;

    await api
      .delete(`/api/v1/insurance/${id}`)
      .set("Authorization", `Bearer ${t.outsideWorker}`)
      .expect(404);
  });
});

describe("what the ID card and the public QR page show", () => {
  it("puts the active policy on the worker's own card", async () => {
    const res = await api
      .get("/api/v1/id-card")
      .set("Authorization", `Bearer ${t.worker}`)
      .expect(200);

    expect(res.body.insurance.covered).toBe(true);
    expect(res.body.insurance.provider).toBe("National Insurance Co.");
    expect(res.body.insurance.verification).toBe("self_declared");
  });

  it("masks the policy number on the public verify page, and flags unverified cover", async () => {
    const res = await api
      .get(`/api/v1/public/verify/worker/${cardCode("SS-800001")}`)
      .expect(200);

    expect(res.body.insurance.covered).toBe(true);
    expect(res.body.insurance.policy_number_masked).toBe("••••9231");
    expect(JSON.stringify(res.body)).not.toContain("NIC/KA/2026/0099231");
    expect(res.body.insurance.verification).toBe("self_declared");
  });

  it("stops claiming cover the moment the policy expires", async () => {
    const policy = await InsurancePolicy.findOne({ worker_id: inScopeWorker._id });
    policy.valid_to = new Date(Date.now() - 60 * 1000);
    policy.valid_from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    await policy.save();

    const res = await api
      .get(`/api/v1/public/verify/worker/${cardCode("SS-800001")}`)
      .expect(200);

    expect(res.body.insurance.covered).toBe(false);
    expect(res.body.insurance.status).toBe("expired");
    expect(res.body.insurance.on_record).toBe(true);

    // Put it back in force for the verification tests below.
    policy.valid_to = daysFromNow(120);
    policy.valid_from = daysFromNow(-10);
    await policy.save();
  });
});

describe("labour-office verification", () => {
  it("lists policies for workers in the official's jurisdiction only", async () => {
    await api
      .post("/api/v1/insurance")
      .set("Authorization", `Bearer ${t.outsideWorker}`)
      .send(policyBody({ policy_number: "KL/77", provider: "Kerala Co-op Insurance" }))
      .expect(201);

    const res = await api
      .get("/api/v1/government/insurance")
      .set("Authorization", `Bearer ${t.official}`)
      .expect(200);

    const numbers = res.body.policies.map((p) => p.policy_number);
    expect(numbers).toContain("NIC/KA/2026/0099231");
    expect(numbers).not.toContain("KL/77");
  });

  it("marks a checked policy office_verified and writes an audit entry", async () => {
    const list = await api
      .get("/api/v1/government/insurance")
      .set("Authorization", `Bearer ${t.official}`)
      .expect(200);
    const target = list.body.policies.find((p) => p.policy_number === "NIC/KA/2026/0099231");

    const res = await api
      .post(`/api/v1/government/insurance/${target.id}/verify`)
      .set("Authorization", `Bearer ${t.official}`)
      .expect(200);

    expect(res.body.policy.verification).toBe("office_verified");
    expect(res.body.policy.verified_at).not.toBe(null);

    const logged = await AuditLog.findOne({ action: "insurance.verify" }).lean();
    expect(logged).not.toBe(null);
  });

  it("shows the verified badge to whoever scans the card", async () => {
    const res = await api
      .get(`/api/v1/public/verify/worker/${cardCode("SS-800001")}`)
      .expect(200);
    expect(res.body.insurance.verification).toBe("office_verified");
  });

  it("refuses to verify a worker outside the official's jurisdiction", async () => {
    const outside = await InsurancePolicy.findOne({ policy_number: "KL/77" });
    await api
      .post(`/api/v1/government/insurance/${outside._id}/verify`)
      .set("Authorization", `Bearer ${t.official}`)
      .expect(403);
  });

  it("refuses non-government accounts", async () => {
    const policy = await InsurancePolicy.findOne({ policy_number: "NIC/KA/2026/0099231" });
    await api
      .post(`/api/v1/government/insurance/${policy._id}/verify`)
      .set("Authorization", `Bearer ${t.employer}`)
      .expect(403);
  });

  it("will not let the worker delete a policy an official verified", async () => {
    const policy = await InsurancePolicy.findOne({ policy_number: "NIC/KA/2026/0099231" });
    await api
      .delete(`/api/v1/insurance/${policy._id}`)
      .set("Authorization", `Bearer ${t.worker}`)
      .expect(409);
  });
});
