/**
 * Security integration tests — Phase 1 & 2 acceptance criteria.
 *
 * Covers:
 *  - jurisdiction scoping for government officials (list/detail/status/
 *    comment/notifications), fail-closed for stateless officials
 *  - superadmin sees everything
 *  - worker JWT → 403 on every /government route
 *  - worker cannot read another worker's grievance or document
 *  - unverified workers cannot password-login; re-registration of an
 *    unverified number never hijacks the account
 *  - document uploads: magic-byte validation, wrapped keys, ownership
 *  - disabled users lose access immediately (authenticate re-check)
 *  - OTP request rate limit returns 429
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Grievance } from "../src/models/Grievance.js";
import { Document } from "../src/models/Document.js";
import { hashPassword, verifyPassword } from "../src/utils/crypto.js";
import { clearUserCache } from "../src/middleware/auth.js";
import { config } from "../src/config.js";

const api = supertest(app);

let mongod;
const P = { worker: "Worker@123", official: "Official@123" };
const ids = {};

// A tiny valid PNG (8-byte signature + minimal IHDR-ish filler ≥ 12 bytes).
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  crypto.randomBytes(32),
]);

async function makeUser(over = {}) {
  const u = await User.create({
    role: "worker",
    full_name: over.full_name || "Test Worker",
    mobile_number: over.mobile_number || `9${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword(over.password || P.worker),
    is_phone_verified: over.is_phone_verified ?? true,
    is_active: over.is_active ?? true,
    ...over.fields,
  });
  return u;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-test"));

  // ── Officials ────────────────────────────────────────────────────
  ids.superadmin = (
    await makeUser({
      full_name: "Super Admin",
      password: P.official,
      fields: { role: "government", employee_id: "SA001", is_superadmin: true, mobile_number: "9000000090" },
    })
  )._id;
  ids.stateKL = (
    await makeUser({
      full_name: "Kerala State Officer",
      password: P.official,
      fields: { role: "government", employee_id: "KL001", state: "Kerala", district: null, mobile_number: "9000000091" },
    })
  )._id;
  ids.distEKM = (
    await makeUser({
      full_name: "Ernakulam District Officer",
      password: P.official,
      fields: { role: "government", employee_id: "EKM001", state: "Kerala", district: "Ernakulam", mobile_number: "9000000092" },
    })
  )._id;
  ids.stateless = (
    await makeUser({
      full_name: "No Jurisdiction Officer",
      password: P.official,
      fields: { role: "government", employee_id: "NJ001", state: null, district: null, is_superadmin: false, mobile_number: "9000000093" },
    })
  )._id;

  // ── Workers ──────────────────────────────────────────────────────
  ids.wInScope = (await makeUser({ full_name: "In Scope", fields: { current_state: "Kerala", current_district: "Ernakulam" } }))._id;
  ids.wOtherKerala = (await makeUser({ full_name: "Other Kerala", fields: { current_state: "Kerala", current_district: "Kozhikode" } }))._id;
  ids.wTamil = (await makeUser({ full_name: "Tamil Worker", fields: { current_state: "Tamil Nadu", current_district: "Coimbatore" } }))._id;
  ids.wUnverified = (
    await makeUser({
      full_name: "Unverified Worker",
      password: "Original@123",
      is_phone_verified: false,
      fields: { mobile_number: "9111100000" },
    })
  )._id;

  // ── Grievances ───────────────────────────────────────────────────
  const mkG = async (owner, state, district, subject) =>
    (
      await Grievance.create({
        owner_id: owner,
        owner_state: state,
        owner_district: district,
        complaint_number: `GR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        category: "unpaid_wages",
        subject,
        description: "Wages withheld for two months.",
        status: "submitted",
        priority: "high",
        attachments: [],
        timeline: [{ status: "submitted", note: null, changed_by: "Worker", created_at: new Date() }],
        comments: [],
      })
    )._id;

  ids.gInScope = await mkG(ids.wInScope, "Kerala", "Ernakulam", "In-scope grievance");
  ids.gSameState = await mkG(ids.wOtherKerala, "Kerala", "Kozhikode", "Same state other district");
  ids.gOutState = await mkG(ids.wTamil, "Tamil Nadu", "Coimbatore", "Out of state grievance");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  // Clean the test upload dir
  fs.rmSync(config.uploadDir, { recursive: true, force: true });
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const loginAs = async (userId, role) => {
  const u = await User.findById(userId);
  const { signToken } = await import("../src/utils/crypto.js");
  return signToken({ _id: u._id, role: role || u.role, worker_id: u.worker_id, employee_id: u.employee_id });
};

describe("Jurisdiction scoping — district official (Kerala/Ernakulam)", () => {
  let t;
  beforeAll(async () => {
    t = await loginAs(ids.distEKM);
  });

  it("lists only grievances filed in Ernakulam", async () => {
    const r = await api.get("/api/v1/government/grievances").set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    const subjects = r.body.grievances.map((g) => g.subject);
    expect(subjects).toContain("In-scope grievance");
    expect(subjects).not.toContain("Same state other district");
    expect(subjects).not.toContain("Out of state grievance");
  });

  it("cannot READ a grievance outside its district", async () => {
    const r = await api.get(`/api/v1/government/grievances/${ids.gSameState}`).set(auth(t));
    expect(r.status).toBe(403);
  });

  it("cannot UPDATE STATUS outside its district", async () => {
    const r = await api
      .post(`/api/v1/government/grievances/${ids.gSameState}/status`)
      .set(auth(t))
      .send({ status: "under_review" });
    expect(r.status).toBe(403);
  });

  it("cannot COMMENT outside its district", async () => {
    const r = await api
      .post(`/api/v1/government/grievances/${ids.gSameState}/comment`)
      .set(auth(t))
      .send({ content: "snooping" });
    expect(r.status).toBe(403);
  });

  it("cannot read or touch an out-of-STATE grievance", async () => {
    expect((await api.get(`/api/v1/government/grievances/${ids.gOutState}`).set(auth(t))).status).toBe(403);
    expect(
      (await api.post(`/api/v1/government/grievances/${ids.gOutState}/status`).set(auth(t)).send({ status: "under_review" })).status
    ).toBe(403);
  });

  it("dashboard stats are scoped", async () => {
    const r = await api.get("/api/v1/government/dashboard/stats").set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.total_workers).toBe(1);
    expect(r.body.total_grievances).toBe(1);
    expect(r.body.recent_filings).toHaveLength(1);
  });

  it("notifications: rejects target=all (403)", async () => {
    const r = await api.post("/api/v1/government/notifications/send").set(auth(t)).send({ title: "x", body: "y", target: "all" });
    expect(r.status).toBe(403);
  });

  it("notifications: rejects out-of-scope state and district (403)", async () => {
    const outState = await api
      .post("/api/v1/government/notifications/send")
      .set(auth(t))
      .send({ title: "x", body: "y", target: "state", target_value: "Tamil Nadu" });
    expect(outState.status).toBe(403);

    const outDistrict = await api
      .post("/api/v1/government/notifications/send")
      .set(auth(t))
      .send({ title: "x", body: "y", target: "district", target_value: "Kozhikode" });
    expect(outDistrict.status).toBe(403);
  });

  it("notifications: allows in-scope district targets and reaches only those workers", async () => {
    const r = await api
      .post("/api/v1/government/notifications/send")
      .set(auth(t))
      .send({ title: "Camp notice", body: "Medical camp Friday", target: "district", target_value: "Ernakulam" });
    expect(r.status).toBe(201);
    expect(r.body.sent_count).toBe(1);
  });
});

describe("Jurisdiction scoping — state official (Kerala)", () => {
  let t;
  beforeAll(async () => {
    t = await loginAs(ids.stateKL);
  });

  it("sees both Kerala districts but not Tamil Nadu", async () => {
    const r = await api.get("/api/v1/government/grievances").set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    const subjects = r.body.grievances.map((g) => g.subject);
    expect(subjects).not.toContain("Out of state grievance");
  });

  it("can notify an in-state district but not a cross-state one", async () => {
    const ok = await api
      .post("/api/v1/government/notifications/send")
      .set(auth(t))
      .send({ title: "x", body: "y", target: "district", target_value: "Kozhikode" });
    expect(ok.status).toBe(201);
    expect(ok.body.sent_count).toBe(1);

    const bad = await api
      .post("/api/v1/government/notifications/send")
      .set(auth(t))
      .send({ title: "x", body: "y", target: "district", target_value: "Coimbatore" });
    expect(bad.status).toBe(403);
  });
});

describe("Fail-closed: official with no jurisdiction", () => {
  let t;
  beforeAll(async () => {
    t = await loginAs(ids.stateless);
  });

  it("sees NOTHING (empty list, empty stats)", async () => {
    const list = await api.get("/api/v1/government/grievances").set(auth(t));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);

    const stats = await api.get("/api/v1/government/dashboard/stats").set(auth(t));
    expect(stats.body.total_workers).toBe(0);
    expect(stats.body.total_grievances).toBe(0);
  });

  it("cannot send notifications to anyone (403)", async () => {
    const r = await api
      .post("/api/v1/government/notifications/send")
      .set(auth(t))
      .send({ title: "x", body: "y", target: "district", target_value: "Ernakulam" });
    expect(r.status).toBe(403);
  });
});

describe("Superadmin", () => {
  let t;
  beforeAll(async () => {
    t = await loginAs(ids.superadmin);
  });

  it("sees all grievances regardless of jurisdiction", async () => {
    const r = await api.get("/api/v1/government/grievances").set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3);
  });

  it("can update any grievance", async () => {
    const r = await api
      .post(`/api/v1/government/grievances/${ids.gOutState}/status`)
      .set(auth(t))
      .send({ status: "under_review", note: "Picked up" });
    expect(r.status).toBe(200);
    expect(r.body.new_status).toBe("under_review");
  });

  it("can broadcast to all workers", async () => {
    const r = await api.post("/api/v1/government/notifications/send").set(auth(t)).send({ title: "x", body: "y", target: "all" });
    expect(r.status).toBe(201);
    expect(r.body.sent_count).toBe(3); // the three active verified workers
  });

  it("can read audit logs", async () => {
    const r = await api.get("/api/v1/government/audit-logs").set(auth(t));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.logs)).toBe(true);
  });

  it("sees every official with jurisdiction + scope counts (monitoring view)", async () => {
    const r = await api.get("/api/v1/government/officials").set(auth(t));
    expect(r.status).toBe(200);
    const rows = r.body.officials;
    expect(rows.map((o) => o.employee_id).sort()).toEqual(["EKM001", "KL001", "NJ001", "SA001"]);
    const byId = Object.fromEntries(rows.map((o) => [o.employee_id, o]));

    // State official: one state, no district — whole Kerala.
    expect(byId.KL001.state).toBe("Kerala");
    expect(byId.KL001.district).toBeNull();
    expect(byId.KL001.is_superadmin).toBe(false);
    expect(byId.KL001.workers_in_scope).toBe(2);
    expect(byId.KL001.grievances_in_scope).toBe(2);

    // District official: one district inside that state.
    expect(byId.EKM001.district).toBe("Ernakulam");
    expect(byId.EKM001.workers_in_scope).toBe(1);
    expect(byId.EKM001.grievances_in_scope).toBe(1);

    // Superadmin: everything.
    expect(byId.SA001.is_superadmin).toBe(true);
    expect(byId.SA001.workers_in_scope).toBe(4);
    expect(byId.SA001.grievances_in_scope).toBe(3);

    // Fail-closed official (no jurisdiction): a scope of exactly zero.
    expect(byId.NJ001.workers_in_scope).toBe(0);
    expect(byId.NJ001.grievances_in_scope).toBe(0);
  });
});

describe("Officials directory is superadmin-only", () => {
  it("state, district and stateless officials all get 403", async () => {
    for (const who of [ids.stateKL, ids.distEKM, ids.stateless]) {
      const t = await loginAs(who);
      expect((await api.get("/api/v1/government/officials").set(auth(t))).status).toBe(403);
    }
  });
});

describe("Worker JWT is rejected on every /government route", () => {
  let t;
  beforeAll(async () => {
    t = await loginAs(ids.wInScope);
  });

  const cases = [
    ["GET", "/api/v1/government/dashboard/stats"],
    ["GET", "/api/v1/government/workers"],
    ["GET", "/api/v1/government/grievances"],
    ["GET", `/api/v1/government/grievances/${ids.gInScope}`],
    ["POST", `/api/v1/government/grievances/${ids.gInScope}/status`],
    ["POST", `/api/v1/government/grievances/${ids.gInScope}/comment`],
    ["POST", "/api/v1/government/notifications/send"],
    ["GET", "/api/v1/government/officials"],
    ["GET", "/api/v1/government/audit-logs"],
  ];

  for (const [method, url] of cases) {
    it(`${method} ${url.replace(ids.gInScope, ":id")} → 403`, async () => {
      const r = await api[method.toLowerCase()](url).set(auth(t)).send({ status: "resolved", content: "x", title: "x", body: "y" });
      expect(r.status).toBe(403);
    });
  }
});

describe("Worker ownership boundaries", () => {
  let tIn, tOther;
  beforeAll(async () => {
    tIn = await loginAs(ids.wInScope);
    tOther = await loginAs(ids.wOtherKerala);
  });

  it("worker cannot read another worker's grievance (404, no existence leak)", async () => {
    const r = await api.get(`/api/v1/grievances/${ids.gSameState}`).set(auth(tIn));
    expect(r.status).toBe(404);
  });

  it("worker cannot comment on another worker's grievance", async () => {
    const r = await api.post(`/api/v1/grievances/${ids.gSameState}/comments`).set(auth(tIn)).send({ content: "hi" });
    expect(r.status).toBe(404);
  });

  it("worker cannot withdraw another worker's grievance", async () => {
    const r = await api.post(`/api/v1/grievances/${ids.gSameState}/withdraw`).set(auth(tIn));
    expect(r.status).toBe(404);
  });

  it("uploaded documents are invisible to other workers", async () => {
    const up = await api
      .post("/api/v1/documents")
      .set(auth(tOther))
      .attach("file", PNG_BYTES, "my-id.png");
    expect(up.status).toBe(201);
    ids.docOther = up.body.id;

    const wrong = await api.get(`/api/v1/documents/${ids.docOther}/download`).set(auth(tIn));
    expect(wrong.status).toBe(404);

    const list = await api.get("/api/v1/documents").set(auth(tIn));
    expect(list.body.some((d) => d.id === ids.docOther)).toBe(false);
  });
});

describe("Document crypto and validation", () => {
  let t;
  beforeAll(async () => {
    t = await loginAs(ids.wInScope);
  });

  it("rejects a fake PDF (text bytes) by content", async () => {
    const r = await api
      .post("/api/v1/documents")
      .set(auth(t))
      .attach("file", Buffer.from("this is definitely not a pdf"), "evil.pdf");
    expect(r.status).toBe(422);
  });

  it("rejects an extension/content mismatch (.png that is a PDF)", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), crypto.randomBytes(64)]);
    const r = await api.post("/api/v1/documents").set(auth(t)).attach("file", pdf, "mismatch.png");
    expect(r.status).toBe(422);
  });

  it("stores a wrapped per-file key, never the plaintext key", async () => {
    const up = await api.post("/api/v1/documents").set(auth(t)).attach("file", PNG_BYTES, "real.png");
    expect(up.status).toBe(201);
    ids.docMine = up.body.id;

    const row = await Document.findById(up.body.id);
    expect(row.encryption_key.startsWith("wrapped:v1:")).toBe(true);
    expect(row.encryption_key).not.toBe(PNG_BYTES.toString("base64"));
  });

  it("downloads the exact original bytes with RFC 5987 Content-Disposition", async () => {
    const r = await api.get(`/api/v1/documents/${ids.docMine}/download`).set(auth(t));
    expect(r.status).toBe(200);
    expect(Buffer.compare(r.body, PNG_BYTES)).toBe(0);
    expect(r.headers["content-disposition"]).toContain("filename*=UTF-8''");
  });
});

describe("Auth hardening", () => {
  it("an UNVERIFIED worker cannot log in with a password (403)", async () => {
    const r = await api.post("/api/v1/auth/worker/login").send({ mobile_number: "9111100000", password: "Original@123" });
    expect(r.status).toBe(403);
  });

  it("re-registering an UNVERIFIED number re-sends the OTP and never overwrites the password", async () => {
    const r = await api
      .post("/api/v1/auth/worker/register")
      .field("mobile_number", "9111100000")
      .field("full_name", "Hijacker")
      .field("password", "Hijacker@999");
    expect(r.status).toBe(200);
    expect(r.body.resent).toBe(true);

    const u = await User.findById(ids.wUnverified);
    // Password is still the ORIGINAL one → verification by the real owner works.
    expect(await verifyPassword("Original@123", u.password_hash)).toBe(true);
    expect(await verifyPassword("Hijacker@999", u.password_hash)).toBe(false);
    expect(u.full_name).toBe("Unverified Worker"); // profile untouched
  });

  it("completing OTP verification lets the ORIGINAL password work", async () => {
    // Simulate OTP delivery via the model layer (the adapter prints to the
    // terminal in dev). The digest is the peppered HMAC the route now writes.
    const { hashOtp } = await import("../src/utils/crypto.js");
    const { OtpCode } = await import("../src/models/Document.js");
    await OtpCode.create({
      mobile_number: "9111100000",
      code_hash: hashOtp("123456"),
      purpose: "register",
      expires_at: new Date(Date.now() + 60_000),
      last_sent_at: new Date(),
    });
    const v = await api.post("/api/v1/auth/worker/otp/verify").send({ mobile_number: "9111100000", otp: "123456" });
    expect(v.status).toBe(200);
    expect(v.body.access_token).toBeTruthy();

    const login = await api.post("/api/v1/auth/worker/login").send({ mobile_number: "9111100000", password: "Original@123" });
    expect(login.status).toBe(200);
  });

  it("registering over a VERIFIED number is rejected (409)", async () => {
    const r = await api
      .post("/api/v1/auth/worker/register")
      .field("mobile_number", "9111100000")
      .field("full_name", "Hijacker")
      .field("password", "Hijacker@999");
    expect(r.status).toBe(409);
  });

  it("a disabled user loses access immediately (401), even with a valid JWT", async () => {
    const t = await loginAs(ids.wInScope);
    await User.findByIdAndUpdate(ids.wInScope, { is_active: false });
    clearUserCache();

    const r = await api.get("/api/v1/grievances").set(auth(t));
    expect(r.status).toBe(401);

    await User.findByIdAndUpdate(ids.wInScope, { is_active: true });
    clearUserCache();
    const ok = await api.get("/api/v1/grievances").set(auth(t));
    expect(ok.status).toBe(200);
  });

  it("OTP requests are rate limited (429 after the configured cap)", async () => {
    let last;
    for (let i = 0; i < 7; i++) {
      last = await api.post("/api/v1/auth/worker/login/otp/request").send({ mobile_number: "9222200000" });
    }
    expect(last.status).toBe(429);
  });

  it("rejects tampered tokens", async () => {
    const t = await loginAs(ids.wInScope);
    const tampered = t.slice(0, -4) + "AAAA";
    const r = await api.get("/api/v1/grievances").set(auth(tampered));
    expect(r.status).toBe(401);
  });
});
