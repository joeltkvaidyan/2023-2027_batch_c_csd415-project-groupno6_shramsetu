/**
 * Form V wage slips and the Form IX muster roll.
 *
 * Two things are being proved here:
 *
 *  1. The arithmetic is enforced on the FAILING side. Each invariant has a test
 *     that would fail if the guard were removed, and each refusal carries a
 *     specific code — a slip is refused, never quietly corrected.
 *  2. The evidence belongs to the parties. A worker can fetch their own slips
 *     and nobody else's; a foreign employer gets the same 404 as a missing row.
 *
 * Plus: the two delivery formats (printable HTML, plain text in six languages),
 * immutability (a correction supersedes, it never edits), and the muster roll
 * built only from days that were actually confirmed as worked.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Engagement } from "../src/models/Engagement.js";
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
  await mongoose.connect(mongod.getUri("shramsetu-wageslips"));
  await Engagement.init();
  await WageSlip.init();

  ids.employer = await makeUser({
    role: "employer",
    full_name: "Ravi Contractor",
    fields: {
      business_name: "Ravi Constructions",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
      preferred_language: "ml",
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
      worker_id: "SS-501001",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.rivalWorker = await makeUser({
    full_name: "Rival Kumar",
    fields: { worker_id: "SS-501002", occupation: "construction", current_state: "Kerala", current_district: "Ernakulam" },
  });
  ids.scriptWorker = await makeUser({
    full_name: "Ravi <script>alert(1)</script>",
    fields: { worker_id: "SS-501003", occupation: "construction", current_state: "Kerala", current_district: "Ernakulam" },
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

/** offer → accept → confirm shift → pay in full. Returns the engagement id. */
async function paidEngagement({
  date,
  worker = "worker",
  employer = "employer",
  wage = 800,
  basis = "day",
  hours,
  units,
}) {
  const created = await api
    .post("/api/v1/engagements")
    .set(auth(employer))
    .send({
      worker_id: String(ids[worker]._id),
      work_date: date,
      wage_basis: basis,
      agreed_wage: wage,
      hours,
      units,
    });
  expect(created.status).toBe(201);
  const id = created.body.engagement.id;

  expect((await api.post(`/api/v1/engagements/${id}/accept`).set(auth(worker))).status).toBe(200);
  expect((await api.post(`/api/v1/engagements/${id}/worked`).set(auth(employer))).status).toBe(200);
  const paid = await api
    .post(`/api/v1/engagements/${id}/payment`)
    .set(auth(employer))
    .send({ amount: created.body.engagement.expected_amount });
  expect(paid.status).toBe(200);
  expect(paid.body.engagement.status).toBe("paid");
  return id;
}

const issue = (who, body) => api.post("/api/v1/wage-slips").set(auth(who)).send(body);

// ── Issuing ───────────────────────────────────────────────────────────
describe("issuing a Form V slip", () => {
  let engagementId;

  beforeAll(async () => {
    engagementId = await paidEngagement({ date: "2026-12-01", wage: 800 });
  });

  it("issues a slip carrying the Form V fields and the retention date", async () => {
    const res = await issue("employer", { engagement_id: engagementId });
    expect(res.status).toBe(201);
    const slip = res.body.wage_slip;

    expect(slip.slip_number).toMatch(/^WS-[0-9A-F]{8}$/);
    expect(slip.status).toBe("issued");
    expect(slip.establishment.name).toBe("Ravi Constructions");
    expect(slip.employee.name).toBe("Suresh Kumar");
    expect(slip.employee.code).toBe("SS-501001");
    expect(slip.wage_period.days).toBe(1);
    expect(slip.gross_wages).toBe(800);
    expect(slip.net_wages).toBe(800);
    expect(slip.language).toBe("ml"); // from the employer's preference

    // five years out, to the day
    const issueDate = new Date(slip.issue_date);
    const retained = new Date(slip.retain_until);
    expect(retained.getUTCFullYear() - issueDate.getUTCFullYear()).toBe(5);

    expect(slip.form_source_note).toMatch(/Code on Wages 2019/);
    expect(slip.form_source_note).toMatch(/Wages \(Central\) Rules 2026/);
    expect(slip.form_source_note).toMatch(/State rules may differ/);

    ids.slipId = slip.id;
    ids.slip = slip;
  });

  it("writes wage_slip_id onto the confirmed day", async () => {
    const res = await api.get(`/api/v1/engagements/${engagementId}`).set(auth("employer"));
    expect(res.status).toBe(200);
    expect(res.body.engagement.wage_slip_id).toBe(ids.slipId);
  });

  it("marks the statutory fields we do not hold as absent instead of inventing them", () => {
    const slip = ids.slip;
    expect(slip.employee.uan).toBeNull();
    expect(slip.employee.bank_account).toBeNull();
    expect(slip.employee.designation).toBeNull();
    expect(slip.employee.father_or_mother_or_spouse_name).toBeNull();
    expect(slip.establishment.registration_number).toBeNull();
    expect(slip.earnings.da).toBeNull();
    expect(slip.earnings.allowances).toBeNull();
    expect(slip.deductions.pf).toBeNull();
    for (const path of [
      "employee.uan",
      "employee.bank_account",
      "employee.designation",
      "establishment.registration_number",
      "earnings.da",
      "deductions.pf",
    ]) {
      expect(slip.absent_fields).toContain(path);
    }
    // the whole paid amount lands in basic wages when no split is supplied
    expect(slip.earnings.basic).toBe(800);
  });

  it("accepts a full split and computes gross, total deductions and net", async () => {
    const id = await paidEngagement({ date: "2026-12-02", wage: 800 });
    const res = await issue("employer", {
      engagement_id: id,
      earnings: { basic: 600, da: 100, allowances: 100, overtime: 0 },
      deductions: { pf: 50, esi: 20, other: 30 },
      employee: {
        father_or_mother_or_spouse_name: "Lakshmi Kumar",
        designation: "Mason",
        uan: "101234567890",
        bank_account: "XXXXXX4412",
      },
      establishment_address: "Shop 4, Kakkanad, Ernakulam",
      establishment_registration_number: "KL/ERN/1234",
      language: "en",
    });
    expect(res.status).toBe(201);
    const slip = res.body.wage_slip;
    expect(slip.earnings.basic).toBe(600);
    expect(slip.earnings.da).toBe(100);
    expect(slip.gross_wages).toBe(800);
    expect(slip.total_deductions).toBe(100);
    expect(slip.net_wages).toBe(700);
    expect(slip.absent_fields).not.toContain("employee.uan");
    expect(slip.absent_fields).not.toContain("earnings.da");
  });
});

// ── The failing side of every invariant ───────────────────────────────
describe("arithmetic guards refuse instead of correcting", () => {
  let id;

  beforeAll(async () => {
    id = await paidEngagement({ date: "2026-12-05", wage: 800 });
  });

  it("refuses a slip for an engagement that has not been paid", async () => {
    const created = await api
      .post("/api/v1/engagements")
      .set(auth("employer"))
      .send({ worker_id: String(ids.worker._id), work_date: "2026-12-03", wage_basis: "day", agreed_wage: 500 });
    const unpaidId = created.body.engagement.id;
    await api.post(`/api/v1/engagements/${unpaidId}/accept`).set(auth("worker"));

    const res = await issue("employer", { engagement_id: unpaidId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("engagement_not_paid");
    // and nothing was written
    expect(await WageSlip.countDocuments({ engagement_id: unpaidId })).toBe(0);
  });

  it("refuses a gross that does not equal the amount paid", async () => {
    const res = await issue("employer", {
      engagement_id: id,
      earnings: { basic: 500, da: 100, allowances: 100 },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("gross_mismatch");
    expect(res.body.gross_wages).toBe(700);
    expect(res.body.paid_amount).toBe(800);
  });

  it("refuses a negative or non-numeric component", async () => {
    const negative = await issue("employer", { engagement_id: id, earnings: { basic: -100 } });
    expect(negative.status).toBe(422);
    expect(negative.body.code).toBe("invalid_amount");

    const text = await issue("employer", { engagement_id: id, deductions: { pf: "lots" } });
    expect(text.status).toBe(422);
    expect(text.body.code).toBe("invalid_amount");
  });

  it("refuses deductions that would make net wages negative", async () => {
    const other = await paidEngagement({ date: "2026-12-11", wage: 800 });
    const res = await issue("employer", {
      engagement_id: other,
      deductions: { pf: 900 },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("net_negative");
    expect(res.body.net_wages).toBe(-100);
  });

  it("refuses deductions above half the period wages", async () => {
    const res = await issue("employer", {
      engagement_id: id,
      deductions: { pf: 300, esi: 200 },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("deductions_exceed_half");
    expect(res.body.max_deductions).toBe(400);
  });

  it("accepts deductions exactly at the half-way cap", async () => {
    const res = await issue("employer", { engagement_id: id, deductions: { other: 400 } });
    expect(res.status).toBe(201);
    expect(res.body.wage_slip.total_deductions).toBe(400);
    expect(res.body.wage_slip.net_wages).toBe(400);
  });

  it("refuses a slip dated after the payment it evidences", async () => {
    const other = await paidEngagement({ date: "2026-12-08", wage: 600 });
    const res = await issue("employer", { engagement_id: other, issue_date: "2030-01-01" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("slip_after_payment");
  });

  it("refuses an impossible wage period in days", async () => {
    const other = await paidEngagement({ date: "2026-12-09", wage: 600 });
    const res = await issue("employer", { engagement_id: other, wage_period_days: 45 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("invalid_wage_period_days");
  });
});

// ── Immutability and correction ───────────────────────────────────────
describe("immutability and supersession", () => {
  let engagementId;
  let originalId;

  beforeAll(async () => {
    engagementId = await paidEngagement({ date: "2026-12-06", wage: 700 });
    const res = await issue("employer", { engagement_id: engagementId });
    originalId = res.body.wage_slip.id;
  });

  it("refuses a second slip and points at the existing one", async () => {
    const res = await issue("employer", { engagement_id: engagementId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("slip_exists");
    expect(res.body.wage_slip_id).toBe(originalId);
  });

  it("has no update route at all", async () => {
    const res = await api
      .patch(`/api/v1/wage-slips/${originalId}`)
      .set(auth("employer"))
      .send({ net_wages: 10 });
    expect(res.status).toBe(404);
    const after = await api.get(`/api/v1/wage-slips/${originalId}`).set(auth("employer"));
    expect(after.body.wage_slip.net_wages).toBe(700);
  });

  it("supersedes with a new slip and leaves the old figures untouched", async () => {
    const res = await api
      .post(`/api/v1/wage-slips/${originalId}/supersede`)
      .set(auth("employer"))
      .send({ deductions: { other: 100 }, language: "en" });

    expect(res.status).toBe(201);
    const fresh = res.body.wage_slip;
    expect(fresh.supersedes).toBe(originalId);
    expect(fresh.net_wages).toBe(600);
    expect(res.body.superseded.status).toBe("superseded");
    expect(res.body.superseded.superseded_by).toBe(fresh.id);
    expect(res.body.superseded.net_wages).toBe(700); // unchanged

    const engagement = await api.get(`/api/v1/engagements/${engagementId}`).set(auth("employer"));
    expect(engagement.body.engagement.wage_slip_id).toBe(fresh.id);

    ids.supersededId = originalId;
  });

  it("refuses to supersede a slip that is already superseded", async () => {
    const res = await api
      .post(`/api/v1/wage-slips/${ids.supersededId}/supersede`)
      .set(auth("employer"))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("slip_superseded");
  });
});

// ── Party-scoped access ───────────────────────────────────────────────
describe("who may read a slip", () => {
  it("shows a worker their own slips and nobody else's", async () => {
    const mine = await api.get("/api/v1/wage-slips/mine").set(auth("worker"));
    expect(mine.status).toBe(200);
    expect(mine.body.wage_slips.some((s) => s.id === ids.slipId)).toBe(true);
    expect(mine.body.wage_slips.every((s) => s.worker_id === String(ids.worker._id))).toBe(true);

    const rival = await api.get("/api/v1/wage-slips/mine").set(auth("rivalWorker"));
    expect(rival.body.wage_slips.some((s) => s.id === ids.slipId)).toBe(false);
  });

  it("404s a slip to a worker or employer who is not a party", async () => {
    const rival = await api.get(`/api/v1/wage-slips/${ids.slipId}`).set(auth("rivalWorker"));
    expect(rival.status).toBe(404);

    const foreign = await api.get(`/api/v1/wage-slips/${ids.slipId}`).set(auth("otherEmployer"));
    expect(foreign.status).toBe(404);

    const printForeign = await api.get(`/api/v1/wage-slips/${ids.slipId}/print`).set(auth("otherEmployer"));
    expect(printForeign.status).toBe(404);

    const textForeign = await api.get(`/api/v1/wage-slips/${ids.slipId}/text`).set(auth("rivalWorker"));
    expect(textForeign.status).toBe(404);
  });

  it("refuses a worker issuing a slip", async () => {
    const res = await issue("worker", { engagement_id: ids.slipId });
    expect(res.status).toBe(403);
  });
});

// ── The two delivery formats ──────────────────────────────────────────
describe("printable HTML and plain text", () => {
  it("serves printable HTML and escapes the values it interpolates", async () => {
    const id = await paidEngagement({ date: "2026-12-07", worker: "scriptWorker", wage: 500 });
    const slip = await issue("employer", { engagement_id: id, language: "en" });
    expect(slip.status).toBe(201);

    const res = await api.get(`/api/v1/wage-slips/${slip.body.wage_slip.id}/print`).set(auth("employer"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("FORM V");
    expect(res.text).toContain("Print this page");
    expect(res.text).toContain("&lt;script&gt;");
    expect(res.text).not.toContain("<script>alert(1)</script>");
  });

  it("renders plain text in all six languages, and falls back to English", async () => {
    const expected = {
      en: "WAGE SLIP",
      hi: "वेतन पर्ची",
      ml: "കൂലി രസീത്",
      ta: "ஊதியச் சீட்டு",
      te: "వేతన రసీదు",
      bn: "মজুরি রসিদ",
    };

    for (const [language, marker] of Object.entries(expected)) {
      const res = await api
        .get(`/api/v1/wage-slips/${ids.slipId}/text`)
        .query({ language })
        .set(auth("worker"));
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      expect(res.headers["x-slip-language"]).toBe(language);
      expect(res.text).toContain(marker);
      // the amount is formatted regardless of the currency label each language uses
      expect(res.text).toContain("800.00");
      expect(res.text).toContain(ids.slip.slip_number);
    }

    const fallback = await api
      .get(`/api/v1/wage-slips/${ids.slipId}/text`)
      .query({ language: "fr" })
      .set(auth("worker"));
    expect(fallback.status).toBe(200);
    expect(fallback.headers["x-slip-language"]).toBe("en");
    expect(fallback.text).toContain("WAGE SLIP");
  });

  it("renders an absent field as 'not recorded', not as a zero", async () => {
    const res = await api
      .get(`/api/v1/wage-slips/${ids.slipId}/text`)
      .query({ language: "en" })
      .set(auth("worker"));
    expect(res.text).toMatch(/UAN: Not recorded/);
    expect(res.text).toMatch(/Bank account: Not recorded/);
    expect(res.text).not.toMatch(/UAN: Rs 0/);
  });
});

// ── Form IX muster roll ───────────────────────────────────────────────
describe("Form IX muster roll", () => {
  beforeAll(async () => {
    await paidEngagement({ date: "2027-03-02", wage: 800 });
    await paidEngagement({ date: "2027-03-03", wage: 800 });
    await paidEngagement({ date: "2027-03-04", worker: "rivalWorker", wage: 700 });

    // A no-show and an accepted-but-never-worked day must not count as attendance.
    const noShow = await api
      .post("/api/v1/engagements")
      .set(auth("employer"))
      .send({ worker_id: String(ids.worker._id), work_date: "2027-03-05", wage_basis: "day", agreed_wage: 800 });
    await api.post(`/api/v1/engagements/${noShow.body.engagement.id}/accept`).set(auth("worker"));
    expect((await api.post(`/api/v1/engagements/${noShow.body.engagement.id}/no-show`).set(auth("employer"))).status).toBe(200);

    const offered = await api
      .post("/api/v1/engagements")
      .set(auth("employer"))
      .send({ worker_id: String(ids.worker._id), work_date: "2027-03-06", wage_basis: "day", agreed_wage: 800 });
    await api.post(`/api/v1/engagements/${offered.body.engagement.id}/accept`).set(auth("worker"));
  });

  it("counts only days that were confirmed as worked, per worker", async () => {
    const res = await api.get("/api/v1/records/muster-roll").query({ month: "2027-03" }).set(auth("employer"));
    expect(res.status).toBe(200);
    const roll = res.body.muster_roll;

    expect(roll.month).toBe("2027-03");
    expect(roll.days_in_month).toBe(31);
    expect(roll.establishment.name).toBe("Ravi Constructions");
    expect(roll.totals).toEqual({ employees: 2, present_days: 3 });

    const suresh = roll.employees.find((e) => e.worker_code === "SS-501001");
    expect(suresh.total_days).toBe(2);
    expect(Object.keys(suresh.day_marks).sort()).toEqual(["2", "3"]);
    expect(suresh.day_marks["6"]).toBeUndefined(); // accepted, never worked

    const rival = roll.employees.find((e) => e.worker_code === "SS-501002");
    expect(rival.total_days).toBe(1);

    // the columns we do not hold are declared absent, not filled in
    expect(roll.absent_fields).toContain("shift");
    expect(roll.absent_fields).toContain("total_ot_hours");
    expect(roll.form_source_note).toMatch(/Form IX/);
  });

  it("scopes the roll to the calling establishment", async () => {
    const res = await api.get("/api/v1/records/muster-roll").query({ month: "2027-03" }).set(auth("otherEmployer"));
    expect(res.status).toBe(200);
    expect(res.body.muster_roll.employees).toHaveLength(0);
    expect(res.body.muster_roll.totals.present_days).toBe(0);
  });

  it("refuses a malformed month and a worker caller", async () => {
    const bad = await api.get("/api/v1/records/muster-roll").query({ month: "March" }).set(auth("employer"));
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("invalid_month");

    const worker = await api.get("/api/v1/records/muster-roll").query({ month: "2027-03" }).set(auth("worker"));
    expect(worker.status).toBe(403);
  });

  it("serves a printable Form IX view", async () => {
    const res = await api
      .get("/api/v1/records/muster-roll/print")
      .query({ month: "2027-03", language: "en" })
      .set(auth("employer"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("ATTENDANCE-CUM-MUSTER ROLL");
    expect(res.text).toContain("Suresh Kumar");
    expect(res.text).toContain("2027-03");
  });
});
