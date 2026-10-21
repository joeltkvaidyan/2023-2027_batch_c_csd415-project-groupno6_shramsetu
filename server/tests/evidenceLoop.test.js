/**
 * The loop this build exists for: the worker's evidence reaching the places it
 * matters — a filed complaint, and the way the worker is rated.
 *
 *  1. The unpaid-wages draft cites employer-confirmed days as corroborated and
 *     labels self-reported days as the worker's own account. It never lets the
 *     record overstate its strength, and it still produces a draft when nothing
 *     has been confirmed.
 *  2. Those confirmed days can be attached to the grievance through the existing
 *     attachments array, re-checked against the filer.
 *  3. An employer rating needs a confirmed engagement; the public path stays open
 *     but is labelled unverified; the worker gets a reply and a two-sided release.
 *  4. Objective signals are computed at read time, never stored.
 *  5. A low rating can never remove a worker from the public directory.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Engagement } from "../src/models/Engagement.js";
import { WorkerRating } from "../src/models/WorkerRating.js";
import { WageSlip } from "../src/models/WageSlip.js";
import { hashPassword, signToken } from "../src/utils/crypto.js";

const api = supertest(app);
let mongod;
const ids = {};
const tokens = {};

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

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-evidence-loop"));
  await Engagement.init();
  await WorkerRating.init();
  await WageSlip.init();

  ids.employer = await makeUser({
    role: "employer",
    full_name: "Ravi Contractor",
    fields: { business_name: "Ravi Constructions", current_state: "Kerala", current_district: "Ernakulam" },
  });
  ids.otherEmployer = await makeUser({
    role: "employer",
    full_name: "Second Contractor",
    fields: { business_name: "Second Constructions", current_state: "Kerala", current_district: "Ernakulam" },
  });
  ids.worker = await makeUser({
    full_name: "Suresh Kumar",
    fields: {
      worker_id: "SS-601001",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.rivalWorker = await makeUser({
    full_name: "Rival Kumar",
    fields: {
      worker_id: "SS-601002",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });

  for (const [key, u] of Object.entries(ids)) {
    tokens[key] = signToken({ _id: u._id, role: u.role, worker_id: u.worker_id });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const auth = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

/** offer → accept → confirm shift. Optionally pay, optionally on a given date. */
async function confirmedDay({ worker = "worker", employer = "employer", date, wage = 800, pay = false, paidAt }) {
  const created = await api
    .post("/api/v1/engagements")
    .set(auth(employer))
    .send({ worker_id: String(ids[worker]._id), work_date: date, wage_basis: "day", agreed_wage: wage });
  expect(created.status).toBe(201);
  const id = created.body.engagement.id;

  expect((await api.post(`/api/v1/engagements/${id}/accept`).set(auth(worker))).status).toBe(200);
  expect((await api.post(`/api/v1/engagements/${id}/worked`).set(auth(employer))).status).toBe(200);

  if (pay) {
    const body = { amount: wage };
    if (paidAt) body.paid_at = paidAt;
    const paid = await api.post(`/api/v1/engagements/${id}/payment`).set(auth(employer)).send(body);
    expect(paid.status).toBe(200);
  }
  return id;
}

const selfReport = (date, agreed, paid = 0) =>
  api.post("/api/v1/wages").set(auth("worker")).send({ work_date: date, agreed_amount: agreed, paid_amount: paid });

const prefill = (month) => api.get("/api/v1/wages/grievance-prefill").query({ month }).set(auth("worker"));

// ── The draft ────────────────────────────────────────────────────────
describe("unpaid-wages draft cites its evidence honestly", () => {
  let confirmedId;

  beforeAll(async () => {
    confirmedId = await confirmedDay({ date: "2026-07-01", wage: 800 }); // worked, unpaid
    await selfReport("2026-07-02", 500); // worker's own record, unpaid
  });

  it("separates employer-confirmed days from self-reported days", async () => {
    const res = await prefill("2026-07");
    expect(res.status).toBe(200);

    expect(res.body.evidence_summary.strength).toBe("mixed");
    expect(res.body.evidence_summary.confirmed_days).toBe(1);
    expect(res.body.evidence_summary.self_reported_days).toBe(1);
    expect(res.body.evidence_summary.total_unpaid).toBe(1300);

    const confirmed = res.body.days.find((d) => d.evidence === "employer_confirmed");
    expect(confirmed.engagement_id).toBe(confirmedId);
    expect(confirmed.employer_account_id).toBe(String(ids.employer._id));
    expect(confirmed.confirmed_at).toBeTruthy();
    expect(confirmed.agreed_amount).toBe(800);
    expect(confirmed.wage_slip).toBeNull(); // no slip issued yet

    const self = res.body.days.find((d) => d.evidence === "self_reported");
    expect(self.engagement_id).toBeNull();
    expect(self.confirmed_at).toBeNull();
    expect(self.source).toBe("worker_reported");
  });

  it("writes the distinction into the draft text, not just the JSON", async () => {
    const res = await prefill("2026-07");
    const text = res.body.description;
    expect(text).toMatch(/Employer-confirmed days \(1 day\(s\), Rs 800\.00\): 2026-07-01/);
    expect(text).toMatch(/Days recorded only by me \(1 day\(s\), Rs 500\.00\): 2026-07-02/);
    expect(text).toMatch(/The employer has not confirmed them/);
    expect(res.body.subject).toMatch(/1 employer-confirmed/);
  });

  it("offers the confirmed day as attachable evidence", async () => {
    const res = await prefill("2026-07");
    expect(res.body.suggested_evidence).toEqual([
      { kind: "engagement", ref_id: confirmedId, label: "Employer-confirmed day 2026-07-01" },
    ]);
  });

  it("carries the wage slip where one exists", async () => {
    // A slip is only issued for a fully paid day, so this state cannot arise
    // through the API today (see the report); it is built directly to prove the
    // mapping, which is what the draft has to get right if the rule is relaxed.
    const id = await confirmedDay({ date: "2026-07-20", wage: 650 });
    const engagement = await Engagement.findById(id);
    await WageSlip.create({
      slip_number: "WS-TEST0001",
      status: "issued",
      engagement_id: engagement._id,
      worker_id: engagement.worker_id,
      employer_account_id: engagement.employer_account_id,
      issue_date: new Date("2026-07-20T12:00:00.000Z"),
      establishment: { name: "Ravi Constructions" },
      wage_period: { from: engagement.work_date, to: engagement.work_date, days: 1 },
      employee: { name: engagement.worker_name },
      attendance: { kind: "day", value: 1 },
      earnings: { basic: 650, overtime: 0 },
      gross_wages: 650,
      deductions: { pf: null, esi: null, other: null },
      total_deductions: 0,
      net_wages: 650,
      signature: { name: "Ravi Constructions" },
      form_source_note: "test fixture",
      retain_until: new Date("2031-07-20T00:00:00.000Z"),
    });

    const res = await prefill("2026-07");
    const row = res.body.days.find((d) => new Date(d.work_date).toISOString().startsWith("2026-07-20"));
    expect(row.evidence).toBe("employer_confirmed");
    expect(row.wage_slip.slip_number).toBe("WS-TEST0001");

    const suggestion = res.body.suggested_evidence.find((s) => s.kind === "wage_slip");
    expect(suggestion.ref_id).toBe(String(res.body.days.find((d) => d.wage_slip)?.wage_slip.id));
    expect(suggestion.label).toContain("WS-TEST0001");
  });

  it("still produces a draft when nothing has been confirmed", async () => {
    await selfReport("2026-06-01", 400);
    const res = await prefill("2026-06");
    expect(res.status).toBe(200);
    expect(res.body.evidence_summary.strength).toBe("self_reported_only");
    expect(res.body.days).toHaveLength(1);
    expect(res.body.days[0].evidence).toBe("self_reported");
    expect(res.body.description).toMatch(/no employer has confirmed them yet/i);
    expect(res.body.suggested_evidence).toEqual([]);
  });

  it("handles a month with nothing unpaid", async () => {
    await confirmedDay({ date: "2026-05-01", wage: 600, pay: true, paidAt: "2026-05-01T12:00:00.000Z" });
    const res = await prefill("2026-05");
    expect(res.status).toBe(200);
    expect(res.body.evidence_summary.strength).toBe("none");
    expect(res.body.days).toEqual([]);
    expect(res.body.description).toMatch(/no unpaid wage days/i);
  });

  it("is worker-only", async () => {
    const res = await api.get("/api/v1/wages/grievance-prefill").query({ month: "2026-07" }).set(auth("employer"));
    expect(res.status).toBe(403);
  });
});

// ── Filing with evidence ─────────────────────────────────────────────
describe("attaching platform evidence to a grievance", () => {
  let slipId;
  let slipNumber;
  let confirmedId;

  beforeAll(async () => {
    confirmedId = await confirmedDay({ date: "2026-07-10", wage: 700, pay: true, paidAt: "2026-07-10T19:00:00.000Z" });
    const slip = await api
      .post("/api/v1/wage-slips")
      .set(auth("employer"))
      .send({ engagement_id: confirmedId, language: "en" });
    expect(slip.status).toBe(201);
    slipId = slip.body.wage_slip.id;
    slipNumber = slip.body.wage_slip.slip_number;
  });

  it("stores references in the existing attachments array, labelled", async () => {
    const res = await api
      .post("/api/v1/grievances")
      .set(auth("worker"))
      .send({
        category: "unpaid_wages",
        subject: "Unpaid wages Rs 700.00 — 1 day",
        description: "Employer-confirmed day 2026-07-10, unpaid.",
        evidence: [
          { kind: "wage_slip", ref_id: slipId },
          { kind: "engagement", ref_id: confirmedId },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.attachments).toHaveLength(2);
    expect(res.body.evidence.platform_records).toHaveLength(2);
    expect(res.body.evidence.uploaded_files).toBe(0);

    const slipRow = res.body.attachments.find((a) => a.kind === "wage_slip");
    expect(slipRow.ref_id).toBe(slipId);
    expect(slipRow.label).toContain(slipNumber);
  });

  it("drops a reference the filer does not own instead of attaching it", async () => {
    const res = await api
      .post("/api/v1/grievances")
      .set(auth("rivalWorker"))
      .send({
        category: "unpaid_wages",
        subject: "Attempted foreign evidence",
        description: "This references another worker's slip and must not attach.",
        evidence: [{ kind: "wage_slip", ref_id: slipId }],
      });
    expect(res.status).toBe(201);
    expect(res.body.attachments).toHaveLength(0); // never someone else's record
  });

  it("ignores junk evidence without failing the filing", async () => {
    const res = await api
      .post("/api/v1/grievances")
      .set(auth("worker"))
      .send({
        category: "unpaid_wages",
        subject: "Complaint with junk evidence ids",
        description: "The filing must survive a stale reference rather than being rejected.",
        evidence: [{ kind: "screenshot", ref_id: "not-an-id" }, { kind: "wage_slip", ref_id: "000000000000000000000000" }],
      });
    expect(res.status).toBe(201);
    expect(res.body.attachments).toHaveLength(0);
  });
});

// ── The rating gate ──────────────────────────────────────────────────
describe("rating requires a confirmed engagement", () => {
  const rate = (who, workerId, body) =>
    api.post(`/api/v1/ratings/worker/${workerId}`).set(auth(who)).send(body);

  it("refuses an employer with no confirmed engagement", async () => {
    const res = await rate("otherEmployer", String(ids.worker._id), { stars: 5, comment: "Never hired them." });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("no_confirmed_engagement");
    expect(await WorkerRating.countDocuments({ rater_user_id: ids.otherEmployer._id })).toBe(0);
  });

  it("refuses an employer whose only engagement was a no-show", async () => {
    const created = await api
      .post("/api/v1/engagements")
      .set(auth("otherEmployer"))
      .send({ worker_id: String(ids.worker._id), work_date: "2026-08-04", wage_basis: "day", agreed_wage: 500 });
    const id = created.body.engagement.id;
    await api.post(`/api/v1/engagements/${id}/accept`).set(auth("worker"));
    await api.post(`/api/v1/engagements/${id}/no-show`).set(auth("otherEmployer"));

    const res = await rate("otherEmployer", String(ids.worker._id), { stars: 5 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("no_confirmed_engagement");
  });

  it("accepts an employer with a confirmed engagement and labels it verified", async () => {
    const engagementId = await confirmedDay({ date: "2026-08-03", wage: 800, pay: true });
    const res = await rate("employer", String(ids.worker._id), {
      stars: 5,
      comment: "Turned up on time and finished the work.",
      employer_name: "Ravi Constructions",
    });
    expect(res.status).toBe(200);
    expect(res.body.rating.verification).toBe("confirmed_engagement");
    expect(res.body.rating.rater_label).toBe("verified_employer");
    expect(res.body.rating.rater_verified).toBe(true);
    expect(res.body.rating.engagement_id).toBe(engagementId);
    expect(res.body.rating.released).toBe(false); // worker has not replied yet

    ids.employerRatingId = res.body.rating.id;
    ids.engagementId = engagementId;
  });

  it("keeps the public path open but labels it unverified", async () => {
    const res = await api
      .post(`/api/v1/ratings/worker/${ids.worker._id}`)
      .send({ stars: 4, rater_name: "Anitha", rater_phone: "9812345671" });
    expect(res.status).toBe(200);
    expect(res.body.rating.verification).toBe("public_self_declared");
    expect(res.body.rating.rater_label).toBe("unverified_public");
    expect(res.body.rating.rater_verified).toBe(false);
    expect(res.body.rating.engagement_id).toBeNull();
  });

  it("gives the worker a right of reply, and only to that worker", async () => {
    const rival = await api
      .post(`/api/v1/ratings/${ids.employerRatingId}/response`)
      .set(auth("rivalWorker"))
      .send({ text: "Not my rating to answer." });
    expect(rival.status).toBe(404);

    const res = await api
      .post(`/api/v1/ratings/${ids.employerRatingId}/response`)
      .set(auth("worker"))
      .send({ text: "The rate was renegotiated on site; the wages were paid the same evening." });
    expect(res.status).toBe(200);
    expect(res.body.rating.response.text).toMatch(/renegotiated/);
    expect(res.body.rating.released).toBe(true);

    const again = await api
      .post(`/api/v1/ratings/${ids.employerRatingId}/response`)
      .set(auth("worker"))
      .send({ text: "A second reply should be refused." });
    expect(again.status).toBe(409);
  });

  it("locks the record once released, so the rater cannot amend it afterwards", async () => {
    const res = await rate("employer", String(ids.worker._id), { stars: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("rating_locked");

    const stored = await WorkerRating.findById(ids.employerRatingId);
    expect(stored.stars).toBe(5); // unchanged
  });

  it("releases by time as well, once the reply window has run out", async () => {
    const created = await makeUser({
      full_name: "Window Worker",
      fields: {
        worker_id: "SS-601003",
        occupation: "construction",
        current_state: "Kerala",
        current_district: "Ernakulam",
        gov_approve_status: "accepted",
      },
    });
    const engagement = await confirmedDayWith(created, "2026-08-06", 500);

    const rating = await api
      .post(`/api/v1/ratings/worker/${created._id}`)
      .set(auth("employer"))
      .send({ stars: 3, engagement_id: engagement });
    expect(rating.status).toBe(200);
    expect(rating.body.rating.released).toBe(false);

    // Age the rating past the 14-day reply window. Raw driver: Mongoose treats
    // createdAt as immutable, so a model update would be silently dropped.
    await WorkerRating.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rating.body.rating.id) },
      { $set: { createdAt: new Date(Date.now() - 15 * 86_400_000) } }
    );
    const aged = await WorkerRating.findById(rating.body.rating.id);
    expect(aged.isReleased()).toBe(true);
  });
});

/** confirmedDay for an arbitrary worker user (not in the ids map). */
async function confirmedDayWith(workerUser, date, wage) {
  const token = signToken({ _id: workerUser._id, role: "worker", worker_id: workerUser.worker_id });
  const asWorker = { Authorization: `Bearer ${token}` };

  const created = await api
    .post("/api/v1/engagements")
    .set(auth("employer"))
    .send({ worker_id: String(workerUser._id), work_date: date, wage_basis: "day", agreed_wage: wage });
  expect(created.status).toBe(201);
  const id = created.body.engagement.id;

  expect((await api.post(`/api/v1/engagements/${id}/accept`).set(asWorker)).status).toBe(200);
  expect((await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"))).status).toBe(200);
  return id;
}

// ── Objective signals ────────────────────────────────────────────────
describe("objective signals are computed at read time", () => {
  it("counts confirmed shifts and on-time payments, and nothing is stored", async () => {
    // Two shifts: one paid on the day, one paid three days late.
    await confirmedDay({ date: "2026-08-01", wage: 800, pay: true, paidAt: "2026-08-01T20:00:00.000Z" });
    await confirmedDay({ date: "2026-08-02", wage: 800, pay: true, paidAt: "2026-08-05T10:00:00.000Z" });

    const first = await api.get(`/api/v1/ratings/worker/${ids.worker._id}`);
    expect(first.status).toBe(200);
    const before = first.body.signals;
    expect(before.shifts_confirmed).toBeGreaterThanOrEqual(2);
    expect(before.paid_on_time).toBeGreaterThanOrEqual(1);
    expect(before.rule).toMatch(/end of the shift day/);
    // Derived, never a column on the user or the rating.
    const userRow = await User.findById(ids.worker._id).lean();
    expect(userRow.shifts_confirmed).toBeUndefined();
    expect(userRow.paid_on_time).toBeUndefined();

    // A new confirmed shift changes the number on the very next read.
    await confirmedDay({ date: "2026-08-07", wage: 800, pay: true, paidAt: "2026-08-07T09:00:00.000Z" });
    const second = await api.get(`/api/v1/ratings/worker/${ids.worker._id}`);
    expect(second.body.signals.shifts_confirmed).toBe(before.shifts_confirmed + 1);
    expect(second.body.signals.paid_on_time).toBe(before.paid_on_time + 1);
  });

  it("puts the signals on the public directory row", async () => {
    const res = await api.get("/api/v1/public/workers").query({ name: "Suresh" });
    expect(res.status).toBe(200);
    const row = res.body.workers.find((w) => w.worker_code === "SS-601001");
    expect(row).toBeDefined();
    expect(row.signals.shifts_confirmed).toBeGreaterThanOrEqual(2);
    expect(row.signals.rule).toMatch(/end of the shift day/);
  });
});

// ── The directory guard ──────────────────────────────────────────────
describe("a low rating never removes a worker from the directory", () => {
  it("keeps a one-star worker listed, with an unchanged total", async () => {
    const before = await api.get("/api/v1/public/workers").query({ name: "Suresh" });
    expect(before.body.workers.some((w) => w.id === String(ids.worker._id))).toBe(true);
    const totalBefore = before.body.total;

    for (let i = 0; i < 5; i += 1) {
      const r = await api
        .post(`/api/v1/ratings/worker/${ids.worker._id}`)
        .send({ stars: 1, rater_name: `Unhappy ${i}`, rater_phone: `98000000${10 + i}` });
      expect(r.status).toBe(200);
    }

    const after = await api.get("/api/v1/public/workers").query({ name: "Suresh" });
    expect(after.status).toBe(200);
    // THIS is the guard: if anyone ever filters the directory by rating, the
    // worker disappears and both assertions below fail.
    expect(after.body.workers.some((w) => w.id === String(ids.worker._id))).toBe(true);
    expect(after.body.total).toBe(totalBefore);

    const summary = await api.get(`/api/v1/ratings/worker/${ids.worker._id}`);
    expect(summary.body.average).toBeLessThan(3); // the ratings really did land
    expect(summary.body.signals.shifts_confirmed).toBeGreaterThanOrEqual(2);
  });
});
