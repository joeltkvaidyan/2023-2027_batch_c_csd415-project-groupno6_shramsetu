/**
 * Engagement spine — employer account ↔ worker ↔ one work date.
 *
 * The properties under test, in the order the loop runs:
 *  1. An employer offers; the terms and the expected amount are derived from
 *     the agreed basis, not from anything the client sends later.
 *  2. Only the offered WORKER may accept. Only the offering EMPLOYER may
 *     confirm the shift and record payment. Neither side can move a status the
 *     plan does not let it move.
 *  3. Confirming the shift writes the worker's wage diary: created when the day
 *     was never logged, upgraded from self-reported to "mutual" when it was,
 *     and left with its amounts untouched when the day was already fully paid.
 *  4. Payment is bounded by the agreed basis and can never be walked back.
 *  5. WageEntry's existing paid-day lock still holds after all of this, and a
 *     confirmed day's agreed amount cannot be rewritten by the worker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Engagement } from "../src/models/Engagement.js";
import { WageEntry } from "../src/models/WageEntry.js";
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
  await mongoose.connect(mongod.getUri("shramsetu-engagements"));
  // Build the unique indexes before any insert, or the duplicate-engagement
  // test would race index creation and pass for the wrong reason.
  await Engagement.init();
  await WageEntry.init();

  ids.employer = await makeUser({
    role: "employer",
    full_name: "Ravi Contractor",
    fields: {
      business_name: "Ravi Constructions",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.pendingEmployer = await makeUser({
    role: "employer",
    full_name: "New Boss",
    fields: {
      business_name: "New Boss Works",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "pending",
    },
  });
  ids.otherEmployer = await makeUser({
    role: "employer",
    full_name: "Second Contractor",
    fields: { business_name: "Second Constructions", current_state: "Kerala", current_district: "Ernakulam" },
  });
  ids.worker = await makeUser({
    full_name: "Suresh Kumar",
    fields: {
      worker_id: "SS-401001",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.rivalWorker = await makeUser({
    full_name: "Rival Kumar",
    fields: {
      worker_id: "SS-401002",
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

const offer = (who, body) =>
  api.post("/api/v1/engagements").set(auth(who)).send({
    worker_id: String(ids.worker._id),
    wage_basis: "day",
    agreed_wage: 800,
    ...body,
  });

/** offer → accept, returning the engagement id. */
async function offeredAndAccepted(who, body) {
  const created = await offer(who, body);
  expect(created.status).toBe(201);
  const accepted = await api
    .post(`/api/v1/engagements/${created.body.engagement.id}/accept`)
    .set(auth("worker"));
  expect(accepted.status).toBe(200);
  return created.body.engagement.id;
}

async function wageEntryFor(date) {
  const res = await api.get("/api/v1/wages").query({}).set(auth("worker"));
  return (res.body.entries || []).find((e) => String(e.work_date).startsWith(date));
}

// ── Offer ─────────────────────────────────────────────────────────────
describe("offering an engagement", () => {
  it("creates an offered engagement with terms derived from the agreed basis", async () => {
    const res = await offer("employer", { work_date: "2026-10-05", agreed_wage: 800 });
    expect(res.status).toBe(201);
    expect(res.body.engagement.status).toBe("offered");
    expect(res.body.engagement.worker_confirmed_at).toBeNull();
    expect(res.body.engagement.employer_confirmed_at).toBeNull();
    // expected amount comes from the basis for a day rate
    expect(res.body.engagement.expected_amount).toBe(800);
    expect(res.body.engagement.employer.name).toBe("Ravi Constructions");
    expect(res.body.engagement.worker.code).toBe("SS-401001");
    expect(res.body.wage_entry).toBeNull(); // nothing is written until the shift is confirmed
  });

  it("lets an employer whose registration is still pending offer: a private record earns no public visibility", async () => {
    const res = await offer("pendingEmployer", { work_date: "2026-10-05", agreed_wage: 700 });
    expect(res.status).toBe(201);
  });

  it("rejects a worker account that does not exist, or is not a worker", async () => {
    const notWorker = await offer("employer", { work_date: "2026-10-05", worker_id: String(ids.employer._id) });
    expect(notWorker.status).toBe(422);
    const missing = await offer("employer", {
      work_date: "2026-10-05",
      worker_id: String(new mongoose.Types.ObjectId()),
    });
    expect(missing.status).toBe(422);
  });

  it("validates the basis, the date, and the quantity the basis needs", async () => {
    const badBasis = await offer("employer", { work_date: "2026-10-05", wage_basis: "fortnight" });
    expect(badBasis.status).toBe(422);

    const badDate = await offer("employer", { work_date: "05-10-2026" });
    expect(badDate.status).toBe(422);

    const hourlyNoHours = await offer("employer", { work_date: "2026-10-05", wage_basis: "hour" });
    expect(hourlyNoHours.status).toBe(422);
    expect(hourlyNoHours.body.detail).toMatch(/hours is required/);

    const pieceNoUnits = await offer("employer", { work_date: "2026-10-05", wage_basis: "piece" });
    expect(pieceNoUnits.status).toBe(422);
    expect(pieceNoUnits.body.detail).toMatch(/units is required/);

    const negative = await offer("employer", { work_date: "2026-10-05", agreed_wage: -1 });
    expect(negative.status).toBe(422);
  });

  it("refuses a second engagement for the same employer, worker and date", async () => {
    const first = await offer("employer", { work_date: "2026-10-06" });
    expect(first.status).toBe(201);
    const dup = await offer("employer", { work_date: "2026-10-06" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("engagement_exists");
  });

  it("allows a DIFFERENT employer to offer the same worker on the same date", async () => {
    const a = await offer("employer", { work_date: "2026-10-07" });
    const b = await offer("otherEmployer", { work_date: "2026-10-07" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201); // uniqueness is per pair; the clash surfaces at the diary
  });

  it("refuses a worker offering an engagement", async () => {
    const res = await offer("worker", { work_date: "2026-10-05" });
    expect(res.status).toBe(403);
  });
});

// ── Accept ────────────────────────────────────────────────────────────
describe("accepting", () => {
  it("lets only the offered worker accept", async () => {
    const created = await offer("employer", { work_date: "2026-10-23", agreed_wage: 900 });
    const id = created.body.engagement.id;

    const rival = await api.post(`/api/v1/engagements/${id}/accept`).set(auth("rivalWorker"));
    expect(rival.status).toBe(404); // same 404 as missing: no leak to a non-party

    const employer = await api.post(`/api/v1/engagements/${id}/accept`).set(auth("employer"));
    expect(employer.status).toBe(403); // requireWorker

    const ok = await api.post(`/api/v1/engagements/${id}/accept`).set(auth("worker"));
    expect(ok.status).toBe(200);
    expect(ok.body.engagement.status).toBe("accepted");
    expect(ok.body.engagement.worker_confirmed_at).toBeTruthy();
    expect(ok.body.engagement.employer_confirmed_at).toBeNull(); // the two sides stay separate
  });

  it("refuses a second accept", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-24", agreed_wage: 950 });
    const again = await api.post(`/api/v1/engagements/${id}/accept`).set(auth("worker"));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("invalid_transition");
  });
});

// ── Confirm worked + wage diary ───────────────────────────────────────
describe("confirming the shift", () => {
  it("lets only the offering employer confirm, and only from accepted", async () => {
    const created = await offer("employer", { work_date: "2026-10-25" });
    const id = created.body.engagement.id;

    const early = await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));
    expect(early.status).toBe(409); // still offered

    await api.post(`/api/v1/engagements/${id}/accept`).set(auth("worker"));

    const worker = await api.post(`/api/v1/engagements/${id}/worked`).set(auth("worker"));
    expect(worker.status).toBe(403);

    const foreign = await api.post(`/api/v1/engagements/${id}/worked`).set(auth("otherEmployer"));
    expect(foreign.status).toBe(404);

    const ok = await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));
    expect(ok.status).toBe(200);
    expect(ok.body.engagement.status).toBe("worked");
    expect(ok.body.engagement.employer_confirmed_at).toBeTruthy();
  });

  it("creates the worker's wage diary row as employer-confirmed", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-26", agreed_wage: 800 });
    const res = await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));

    expect(res.status).toBe(200);
    expect(res.body.wage_entry_created).toBe(true);
    const entry = res.body.wage_entry;
    expect(entry.source).toBe("employer_confirmed");
    expect(entry.employer_confirmed).toBe(true);
    expect(entry.agreed_amount).toBe(800);
    expect(entry.paid_amount).toBe(0);
    expect(entry.payment_status).toBe("unpaid");
    expect(entry.engagement_id).toBe(id);
    expect(String(entry.employer_account_id)).toBe(String(ids.employer._id));
    expect(entry.confirmed_at).toBeTruthy();
    // and it is readable through the worker's own wage API
    expect((await wageEntryFor("2026-10-26")).source).toBe("employer_confirmed");
  });

  it("upgrades a self-reported day to mutual, keeping money already received", async () => {
    const logged = await api.post("/api/v1/wages").set(auth("worker")).send({
      work_date: "2026-10-08",
      employer_name: "Ravi Constructions",
      agreed_amount: 500,
      paid_amount: 200,
      payment_status: "partial",
    });
    expect(logged.status).toBe(201);
    expect(logged.body.source).toBe("worker_reported");

    const id = await offeredAndAccepted("employer", { work_date: "2026-10-08", agreed_wage: 600 });
    const res = await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));

    expect(res.status).toBe(200);
    expect(res.body.wage_entry_created).toBe(false); // upgraded, not duplicated
    expect(res.body.wage_entry.source).toBe("mutual");
    expect(res.body.wage_entry.agreed_amount).toBe(600); // the figure both sides confirmed
    expect(res.body.wage_entry.paid_amount).toBe(200); // received money is not reduced
    expect(res.body.wage_entry.payment_status).toBe("partial");
    expect(res.body.wage_entry.engagement_id).toBe(id);
  });

  it("holds the paid-day lock: an already-paid day keeps its amounts", async () => {
    await api.post("/api/v1/wages").set(auth("worker")).send({
      work_date: "2026-10-09",
      employer_name: "Ravi Constructions",
      agreed_amount: 500,
      paid_amount: 500,
    });

    const id = await offeredAndAccepted("employer", { work_date: "2026-10-09", agreed_wage: 900 });
    const res = await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));

    expect(res.status).toBe(200);
    expect(res.body.wage_entry_locked).toBe(true);
    expect(res.body.wage_entry.agreed_amount).toBe(500); // untouched
    expect(res.body.wage_entry.paid_amount).toBe(500); // untouched
    expect(res.body.wage_entry.payment_status).toBe("paid");
    expect(res.body.wage_entry.source).toBe("mutual"); // provenance still attached
    expect(res.body.wage_entry.engagement_id).toBe(id);
  });

  it("refuses to hijack a day already recorded against another engagement", async () => {
    const first = await offeredAndAccepted("employer", { work_date: "2026-10-10", agreed_wage: 700 });
    const worked = await api.post(`/api/v1/engagements/${first}/worked`).set(auth("employer"));
    expect(worked.status).toBe(200);

    const second = await offeredAndAccepted("otherEmployer", { work_date: "2026-10-10", agreed_wage: 750 });
    const clash = await api.post(`/api/v1/engagements/${second}/worked`).set(auth("otherEmployer"));

    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("wage_entry_conflict");

    const after = await api.get(`/api/v1/engagements/${second}`).set(auth("otherEmployer"));
    expect(after.body.engagement.status).toBe("accepted"); // nothing half-written
    // the first employer's record is intact
    expect((await wageEntryFor("2026-10-10")).agreed_amount).toBe(700);
  });

  it("re-derives the expected amount from the hours actually worked", async () => {
    const id = await offeredAndAccepted("employer", {
      work_date: "2026-10-11",
      wage_basis: "hour",
      agreed_wage: 100,
      hours: 6,
    });
    const before = await api.get(`/api/v1/engagements/${id}`).set(auth("employer"));
    expect(before.body.engagement.expected_amount).toBe(600);

    const res = await api
      .post(`/api/v1/engagements/${id}/worked`)
      .set(auth("employer"))
      .send({ hours: 8 });

    expect(res.status).toBe(200);
    expect(res.body.engagement.expected_amount).toBe(800);
    expect(res.body.engagement.hours).toBe(8);
    expect(res.body.wage_entry.agreed_amount).toBe(800);
  });
});

// ── Payment ───────────────────────────────────────────────────────────
describe("recording payment", () => {
  it("lets only the offering employer pay, and only from worked", async () => {
    const created = await offer("employer", { work_date: "2026-10-12", agreed_wage: 800 });
    const id = created.body.engagement.id;

    const early = await api.post(`/api/v1/engagements/${id}/payment`).set(auth("employer")).send({ amount: 800 });
    expect(early.status).toBe(409);

    await api.post(`/api/v1/engagements/${id}/accept`).set(auth("worker"));
    const notWorked = await api
      .post(`/api/v1/engagements/${id}/payment`)
      .set(auth("employer"))
      .send({ amount: 800 });
    expect(notWorked.status).toBe(409);

    await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));

    const worker = await api.post(`/api/v1/engagements/${id}/payment`).set(auth("worker")).send({ amount: 800 });
    expect(worker.status).toBe(403);

    const foreign = await api
      .post(`/api/v1/engagements/${id}/payment`)
      .set(auth("otherEmployer"))
      .send({ amount: 800 });
    expect(foreign.status).toBe(404);
  });

  it("refuses payment above what the agreed basis owes", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-27", agreed_wage: 800 });
    await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));

    const res = await api.post(`/api/v1/engagements/${id}/payment`).set(auth("employer")).send({ amount: 801 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("payment_exceeds_agreed");
    expect(res.body.expected_amount).toBe(800);
  });

  it("records a shortfall honestly, then settles on top-up", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-13", agreed_wage: 800 });
    await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));

    const partial = await api
      .post(`/api/v1/engagements/${id}/payment`)
      .set(auth("employer"))
      .send({ amount: 300, method: "upi", reference: "UPI-7721" });
    expect(partial.status).toBe(200);
    expect(partial.body.engagement.status).toBe("worked"); // 300 of 800 is not "paid"
    expect(partial.body.engagement.payment.shortfall).toBe(500);
    expect(partial.body.wage_entry.paid_amount).toBe(300);
    expect(partial.body.wage_entry.payment_status).toBe("partial");

    const settled = await api
      .post(`/api/v1/engagements/${id}/payment`)
      .set(auth("employer"))
      .send({ amount: 800, method: "upi", reference: "UPI-7722" });
    expect(settled.status).toBe(200);
    expect(settled.body.engagement.status).toBe("paid");
    expect(settled.body.engagement.payment.shortfall).toBe(0);
    expect(settled.body.engagement.paid_at).toBeTruthy();
    expect(settled.body.wage_entry.paid_amount).toBe(800);
    expect(settled.body.wage_entry.payment_status).toBe("paid");
  });

  it("never walks a recorded payment back", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-14", agreed_wage: 800 });
    await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));
    const first = await api.post(`/api/v1/engagements/${id}/payment`).set(auth("employer")).send({ amount: 500 });
    expect(first.status).toBe(200);

    const lower = await api.post(`/api/v1/engagements/${id}/payment`).set(auth("employer")).send({ amount: 400 });
    expect(lower.status).toBe(409);
    expect(lower.body.code).toBe("payment_cannot_decrease");
  });

  it("leaves the paid day locked to the worker afterwards", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-15", agreed_wage: 800 });
    await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));
    await api.post(`/api/v1/engagements/${id}/payment`).set(auth("employer")).send({ amount: 800 });

    const edit = await api.post("/api/v1/wages").set(auth("worker")).send({
      work_date: "2026-10-15",
      employer_name: "Ravi Constructions",
      agreed_amount: 800,
      paid_amount: 0,
    });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe("wage_paid_locked");
  });
});

// ── No-show and cancellation ──────────────────────────────────────────
describe("no-show and cancellation", () => {
  it("records a no-show instead of a worked day, and refuses payment after it", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-16" });
    const res = await api.post(`/api/v1/engagements/${id}/no-show`).set(auth("employer"));
    expect(res.status).toBe(200);
    expect(res.body.engagement.status).toBe("no_show");

    const pay = await api.post(`/api/v1/engagements/${id}/payment`).set(auth("employer")).send({ amount: 0 });
    expect(pay.status).toBe(409);
    // and no wage row was invented for a day nobody worked
    expect(await wageEntryFor("2026-10-16")).toBeUndefined();
  });

  it("lets the worker withdraw an offer, which is a cancellation not a new status", async () => {
    const created = await offer("employer", { work_date: "2026-10-17" });
    const id = created.body.engagement.id;

    const cancel = await api.post(`/api/v1/engagements/${id}/cancel`).set(auth("worker"));
    expect(cancel.status).toBe(200);
    expect(cancel.body.engagement.status).toBe("cancelled");
    expect(cancel.body.engagement.cancelled_at).toBeTruthy();

    const late = await api.post(`/api/v1/engagements/${id}/accept`).set(auth("worker"));
    expect(late.status).toBe(409);
  });

  it("refuses to cancel once the shift has been confirmed", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-18" });
    await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));
    const res = await api.post(`/api/v1/engagements/${id}/cancel`).set(auth("employer"));
    expect(res.status).toBe(409);
  });

  it("refuses a no-show from a non-employer party", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-28" });
    const res = await api.post(`/api/v1/engagements/${id}/no-show`).set(auth("worker"));
    expect(res.status).toBe(403);
  });
});

// ── Disputes ──────────────────────────────────────────────────────────
describe("disputes", () => {
  it("lets the worker dispute, and stops the employer confirming after that", async () => {
    const created = await offer("employer", { work_date: "2026-10-19", agreed_wage: 500 });
    const id = created.body.engagement.id;
    await api.post(`/api/v1/engagements/${id}/accept`).set(auth("worker"));

    const res = await api
      .post(`/api/v1/engagements/${id}/dispute`)
      .set(auth("worker"))
      .send({ reason: "The rate changed when I arrived at the site." });

    expect(res.status).toBe(200);
    expect(res.body.engagement.status).toBe("disputed");
    expect(res.body.engagement.dispute.raised_by).toBe("worker");
    expect(res.body.engagement.dispute.reason).toMatch(/rate changed/);

    const worked = await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));
    expect(worked.status).toBe(409);
  });

  it("lets the employer dispute after payment without moving the money", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-20", agreed_wage: 800 });
    await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));
    await api.post(`/api/v1/engagements/${id}/payment`).set(auth("employer")).send({ amount: 800 });

    const res = await api
      .post(`/api/v1/engagements/${id}/dispute`)
      .set(auth("employer"))
      .send({ reason: "Paid to the wrong worker by mistake, asking for a review." });

    expect(res.status).toBe(200);
    expect(res.body.engagement.status).toBe("disputed");
    expect(res.body.engagement.dispute.raised_by).toBe("employer");

    // the diary still records the money that changed hands
    const entry = await wageEntryFor("2026-10-20");
    expect(entry.payment_status).toBe("paid");
    expect(entry.paid_amount).toBe(800);
  });

  it("requires a reason and refuses to dispute a cancelled engagement", async () => {
    const created = await offer("employer", { work_date: "2026-10-21" });
    const id = created.body.engagement.id;
    await api.post(`/api/v1/engagements/${id}/accept`).set(auth("worker"));

    const empty = await api.post(`/api/v1/engagements/${id}/dispute`).set(auth("worker")).send({ reason: "no" });
    expect(empty.status).toBe(422);

    await api.post(`/api/v1/engagements/${id}/cancel`).set(auth("employer"));
    const late = await api
      .post(`/api/v1/engagements/${id}/dispute`)
      .set(auth("worker"))
      .send({ reason: "Cancelled without notice and I want it recorded." });
    expect(late.status).toBe(409);
  });
});

// ── Isolation and the confirmed-day guard ─────────────────────────────
describe("isolation and the confirmed-day guard", () => {
  it("hides an engagement from everyone who is not a party", async () => {
    const created = await offer("employer", { work_date: "2026-10-29" });
    const id = created.body.engagement.id;

    const foreignWorker = await api.get(`/api/v1/engagements/${id}`).set(auth("rivalWorker"));
    expect(foreignWorker.status).toBe(404);

    const foreignEmployer = await api.get(`/api/v1/engagements/${id}`).set(auth("otherEmployer"));
    expect(foreignEmployer.status).toBe(404);

    const mine = await api.get("/api/v1/engagements/mine").set(auth("worker"));
    expect(mine.body.engagements.some((e) => e.id === id)).toBe(true);
  });

  it("refuses a worker rewriting the agreed amount of a confirmed day, but still allows recording what was paid", async () => {
    const id = await offeredAndAccepted("employer", { work_date: "2026-10-22", agreed_wage: 800 });
    await api.post(`/api/v1/engagements/${id}/worked`).set(auth("employer"));

    const rewrite = await api.post("/api/v1/wages").set(auth("worker")).send({
      work_date: "2026-10-22",
      employer_name: "Ravi Constructions",
      agreed_amount: 400, // employer confirmed 800
      paid_amount: 0,
    });
    expect(rewrite.status).toBe(409);
    expect(rewrite.body.code).toBe("wage_confirmed_locked");

    const paid = await api.post("/api/v1/wages").set(auth("worker")).send({
      work_date: "2026-10-22",
      agreed_amount: 800,
      paid_amount: 500,
    });
    expect(paid.status).toBe(201);
    expect(paid.body.paid_amount).toBe(500);
    // `source` records who established the AGREED figure, not who touched the
    // row last: this day was created by the employer's confirmation, so it
    // stays employer_confirmed even though the worker recorded the payment.
    expect(paid.body.source).toBe("employer_confirmed");
    expect(paid.body.engagement_id).toBe(id);
  });
});
