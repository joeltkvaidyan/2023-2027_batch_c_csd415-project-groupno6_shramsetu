/**
 * Phase 2 integration tests — recurring employers, job matching, applications.
 *
 * Focus: what a worker may see about OTHER workers (nothing), what an official
 * may post outside their jurisdiction (nothing), and the honesty/privacy
 * boundaries of matching and contact sharing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Employer } from "../src/models/Employer.js";
import { WageEntry } from "../src/models/WageEntry.js";
import { JobPosting } from "../src/models/JobPosting.js";
import { JobApplication } from "../src/models/JobApplication.js";
import { hashPassword, signToken } from "../src/utils/crypto.js";
import { scoreJob, scoreApplicant, MIN_MATCH_SCORE } from "../src/utils/jobMatch.js";

const api = supertest(app);
let mongod;

const ids = {};
const tokens = {};

async function makeUser(over = {}) {
  const u = await User.create({
    role: over.role || "worker",
    full_name: over.full_name || "Test Worker",
    mobile_number: over.mobile_number || `8${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword("Test@123"),
    is_phone_verified: true,
    is_active: true,
    ...over.fields,
  });
  return u;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-jobs"));

  ids.workerA = await makeUser({
    full_name: "Anil Kumar",
    fields: {
      worker_id: "SS-100001",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
    },
  });
  ids.workerB = await makeUser({
    full_name: "Meena Selvam",
    fields: {
      worker_id: "SS-100002",
      occupation: "hospitality",
      current_state: "Tamil Nadu",
      current_district: "Chennai",
    },
  });
  ids.officialEKM = await makeUser({
    role: "government",
    full_name: "Ernakulam Officer",
    fields: {
      employee_id: "EKM900",
      state: "Kerala",
      district: "Ernakulam",
      department: "Labour Department",
      mobile_number: "9000000101",
    },
  });
  ids.officialKL = await makeUser({
    role: "government",
    full_name: "Kerala State Officer",
    fields: { employee_id: "KL900", state: "Kerala", district: null, department: "Labour Department", mobile_number: "9000000102" },
  });
  ids.officialTN = await makeUser({
    role: "government",
    full_name: "Tamil Nadu Officer",
    fields: { employee_id: "TN900", state: "Tamil Nadu", district: "Chennai", department: "Labour Department", mobile_number: "9000000103" },
  });
  ids.superadmin = await makeUser({
    role: "government",
    full_name: "Super Admin",
    fields: { employee_id: "SA900", is_superadmin: true, mobile_number: "9000000104" },
  });

  for (const [key, u] of Object.entries(ids)) {
    tokens[key] = signToken({
      _id: u._id,
      role: u.role,
      worker_id: u.worker_id,
      employee_id: u.employee_id,
    });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const auth = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

// ── Recurring employers ─────────────────────────────────────────────
describe("recurring employers", () => {
  it("registers an employer and refuses a duplicate name", async () => {
    const first = await api
      .post("/api/v1/employers")
      .set(auth("workerA"))
      .send({
        name: "  Ravi Constructions ",
        occupation: "construction",
        phone: "98765 43210",
        district: "Ernakulam",
        state: "Kerala",
        daily_wage: 800,
      });

    expect(first.status).toBe(201);
    expect(first.body.name).toBe("Ravi Constructions");
    expect(first.body.phone).toBe("9876543210");

    const duplicate = await api
      .post("/api/v1/employers")
      .set(auth("workerA"))
      .send({ name: "ravi constructions" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("employer_exists");
  });

  it("derives totals only from the caller's own wage entries", async () => {
    await WageEntry.create([
      {
        worker_id: ids.workerA._id,
        work_date: new Date("2026-10-01T00:00:00.000Z"),
        employer_name: "Ravi Constructions",
        agreed_amount: 800,
        paid_amount: 500,
        payment_status: "partial",
      },
      {
        worker_id: ids.workerA._id,
        work_date: new Date("2026-10-02T00:00:00.000Z"),
        employer_name: " ravi constructions ",
        agreed_amount: 800,
        paid_amount: 800,
        payment_status: "paid",
      },
      // Another worker's row with the same employer name must never count.
      {
        worker_id: ids.workerB._id,
        work_date: new Date("2026-10-03T00:00:00.000Z"),
        employer_name: "Ravi Constructions",
        agreed_amount: 5000,
        paid_amount: 0,
        payment_status: "unpaid",
      },
    ]);

    const res = await api.get("/api/v1/employers").set(auth("workerA"));
    expect(res.status).toBe(200);
    expect(res.body.employers).toHaveLength(1);
    const e = res.body.employers[0];
    expect(e.stats.days_worked).toBe(2);
    expect(e.stats.total_agreed).toBe(1600);
    expect(e.stats.total_paid).toBe(1300);
    expect(e.stats.total_outstanding).toBe(300);
  });

  it("cannot read, edit or delete another worker's employer record", async () => {
    const mine = await api.get("/api/v1/employers").set(auth("workerA"));
    const employerId = mine.body.employers[0].id;

    const otherList = await api.get("/api/v1/employers").set(auth("workerB"));
    expect(otherList.body.employers).toHaveLength(0);

    const patch = await api
      .patch(`/api/v1/employers/${employerId}`)
      .set(auth("workerB"))
      .send({ name: "Hijacked" });
    expect(patch.status).toBe(404);

    const del = await api.delete(`/api/v1/employers/${employerId}`).set(auth("workerB"));
    expect(del.status).toBe(404);

    const stillThere = await Employer.findById(employerId);
    expect(stillThere.name).toBe("Ravi Constructions");
    expect(stillThere.is_active).toBe(true);
  });

  it("soft-deletes, keeping the wage history addressable", async () => {
    const mine = await api.get("/api/v1/employers").set(auth("workerA"));
    const employerId = mine.body.employers[0].id;

    const del = await api.delete(`/api/v1/employers/${employerId}`).set(auth("workerA"));
    expect(del.status).toBe(200);

    const active = await api.get("/api/v1/employers").set(auth("workerA"));
    expect(active.body.employers).toHaveLength(0);

    const all = await api.get("/api/v1/employers?include_inactive=true").set(auth("workerA"));
    expect(all.body.employers).toHaveLength(1);

    const record = await Employer.findById(employerId);
    expect(record.is_active).toBe(false);
  });

  it("validates phone and wage input", async () => {
    const badPhone = await api
      .post("/api/v1/employers")
      .set(auth("workerA"))
      .send({ name: "Bad Phone Co", phone: "12345" });
    expect(badPhone.status).toBe(422);

    const badWage = await api
      .post("/api/v1/employers")
      .set(auth("workerA"))
      .send({ name: "Bad Wage Co", daily_wage: -5 });
    expect(badWage.status).toBe(422);
  });

  it("rejects government accounts on worker employer routes", async () => {
    const res = await api.get("/api/v1/employers").set(auth("officialEKM"));
    expect(res.status).toBe(403);
  });
});

// ── Job matching unit behaviour ─────────────────────────────────────
describe("jobMatch scorer", () => {
  const now = new Date("2026-10-19T00:00:00.000Z");
  const worker = { occupation: "construction", current_district: "Ernakulam", current_state: "Kerala" };

  it("ranks a same-district, same-trade, fresh listing as a strong match", () => {
    const { score, level, reasons } = scoreJob(
      {
        occupation: "construction",
        district: "Ernakulam",
        state: "Kerala",
        openings: 3,
        wage_max: 900,
        createdAt: "2026-10-18T00:00:00.000Z",
      },
      worker,
      now
    );
    expect(level).toBe("strong");
    expect(score).toBe(45 + 25 + 5 + 15 + 5);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "occupation_match",
        "same_district",
        "recent_posting",
        "multiple_openings",
        "wage_listed",
      ])
    );
  });

  it("gives an 'any trade' listing local relevance without inventing a trade match", () => {
    const { reasons, score } = scoreJob(
      { occupation: "any", district: "Ernakulam", state: "Kerala", createdAt: "2026-10-19T00:00:00.000Z" },
      worker,
      now
    );
    expect(reasons).not.toContain("occupation_match");
    expect(reasons).toContain("open_to_any_trade");
    expect(score).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it("credits recency from the serialised `created_at` field too", () => {
    // Regression: the API sends created_at, so reading only createdAt meant a
    // brand-new listing never earned the recency weight its reasons promised.
    const { reasons, score } = scoreJob(
      {
        occupation: "construction",
        district: "Ernakulam",
        state: "Kerala",
        openings: 1,
        created_at: "2026-10-18T00:00:00.000Z",
      },
      worker,
      now
    );
    expect(reasons).toContain("recent_posting");
    expect(score).toBe(45 + 25 + 15);
  });

  it("scores a mismatched, far-away, stale listing below the visibility floor", () => {
    const { score } = scoreJob(
      {
        occupation: "hospitality",
        district: "Chennai",
        state: "Tamil Nadu",
        openings: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      worker,
      now
    );
    expect(score).toBeLessThan(MIN_MATCH_SCORE);
  });
});

// ── Job postings and applications ───────────────────────────────────
describe("job listings", () => {
  let kerakaJobId;
  let closedJobId;
  let tnJobId;

  it("forces a district official's listing into their own jurisdiction", async () => {
    const res = await api
      .post("/api/v1/jobs")
      .set(auth("officialEKM"))
      .send({
        title: "Mason required for apartment site",
        description: "Six-storey apartment project, daily wage paid weekly at the site office.",
        employer_name: "Ravi Constructions",
        occupation: "construction",
        state: "Kerala",
        district: "Ernakulam",
        wage_min: 700,
        wage_max: 900,
        openings: 4,
        contact_phone: "9876543210",
      });
    expect(res.status).toBe(201);
    expect(res.body.state).toBe("Kerala");
    expect(res.body.district).toBe("Ernakulam");
    expect(res.body.verification).toBe("unverified");
    kerakaJobId = res.body.id;

    // Cannot slip a listing into a different district.
    const outside = await api
      .post("/api/v1/jobs")
      .set(auth("officialEKM"))
      .send({
        title: "Mason required in another district",
        description: "This listing tries to escape the officer's jurisdiction entirely.",
        employer_name: "Ravi Constructions",
        occupation: "construction",
        district: "Thrissur",
      });
    expect(outside.status).toBe(403);
  });

  it("rejects an out-of-state listing from a state official", async () => {
    const res = await api
      .post("/api/v1/jobs")
      .set(auth("officialTN"))
      .send({
        title: "Construction helper needed",
        description: "A valid Tamil Nadu listing that must not be filed under Kerala.",
        employer_name: "TN Builders",
        occupation: "construction",
        state: "Kerala",
      });
    expect(res.status).toBe(403);
  });

  it("validates wage ranges and the owner can close a listing", async () => {
    const badWage = await api
      .post("/api/v1/jobs")
      .set(auth("officialKL"))
      .send({
        title: "Helper needed at site",
        description: "Long enough description for validation to pass on this listing.",
        employer_name: "KL Builders",
        occupation: "construction",
        wage_min: 900,
        wage_max: 500,
      });
    expect(badWage.status).toBe(422);

    const created = await api
      .post("/api/v1/jobs")
      .set(auth("officialKL"))
      .send({
        title: "Helper needed at site",
        description: "Long enough description for validation to pass on this listing.",
        employer_name: "KL Builders",
        occupation: "construction",
        district: "Thrissur",
        wage_min: 600,
        wage_max: 750,
      });
    expect(created.status).toBe(201);
    closedJobId = created.body.id;

    const closed = await api
      .patch(`/api/v1/jobs/${closedJobId}/status`)
      .set(auth("officialKL"))
      .send({ status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
  });

  it("refuses to let another official close someone else's listing", async () => {
    const res = await api
      .patch(`/api/v1/jobs/${kerakaJobId}/status`)
      .set(auth("officialTN"))
      .send({ status: "closed" });
    expect(res.status).toBe(404);
  });

  it("returns explainable matches in rank order and hides closed listings", async () => {
    const res = await api.get("/api/v1/jobs").set(auth("workerA"));
    expect(res.status).toBe(200);

    const idsSeen = res.body.jobs.map((j) => j.id);
    expect(idsSeen).toContain(kerakaJobId);
    expect(idsSeen).not.toContain(closedJobId);

    const top = res.body.jobs[0];
    expect(top.id).toBe(kerakaJobId);
    expect(top.match.reasons).toEqual(expect.arrayContaining(["occupation_match", "same_district"]));
    expect(top.match.score).toBeGreaterThan(0);
    expect(res.body.matching_note).toMatch(/not a promise/i);
  });

  it("does not expose another worker's applications and gates contact sharing", async () => {
    const apply = await api
      .post(`/api/v1/jobs/${kerakaJobId}/apply`)
      .set(auth("workerA"))
      .send({ note: "Available from Monday" });
    expect(apply.status).toBe(201);

    const duplicate = await api.post(`/api/v1/jobs/${kerakaJobId}/apply`).set(auth("workerA")).send({});
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("already_applied");

    // The other worker has no applications and no visibility into A's.
    const otherMine = await api.get("/api/v1/jobs/applications/mine").set(auth("workerB"));
    expect(otherMine.body.applications).toHaveLength(0);

    // Official from the wrong state cannot read the applicant list.
    const foreign = await api
      .get(`/api/v1/jobs/${kerakaJobId}/applications`)
      .set(auth("officialTN"));
    expect(foreign.status).toBe(404);

    const own = await api
      .get(`/api/v1/jobs/${kerakaJobId}/applications`)
      .set(auth("officialEKM"));
    expect(own.status).toBe(200);
    expect(own.body.applications).toHaveLength(1);
    // Contact was NOT shared → null even for the posting office.
    expect(own.body.applications[0].worker.contact_phone).toBeNull();
    expect(own.body.applications[0].worker.worker_code).toBe("SS-100001");
  });

  it("withdraws and re-applies with explicit contact consent", async () => {
    const withdraw = await api.delete(`/api/v1/jobs/${kerakaJobId}/apply`).set(auth("workerA"));
    expect(withdraw.status).toBe(200);

    const mine = await api.get("/api/v1/jobs/applications/mine").set(auth("workerA"));
    expect(mine.body.applications).toHaveLength(0);

    const reapply = await api
      .post(`/api/v1/jobs/${kerakaJobId}/apply`)
      .set(auth("workerA"))
      .send({ share_contact: true });
    expect(reapply.status).toBe(200);

    const own = await api
      .get(`/api/v1/jobs/${kerakaJobId}/applications`)
      .set(auth("officialEKM"));
    // The shared number is the worker's account number, never an invented one.
    expect(own.body.applications[0].worker.contact_phone).toBe(ids.workerA.mobile_number);
  });

  it("blocks applications to a closed listing", async () => {
    const res = await api.post(`/api/v1/jobs/${closedJobId}/apply`).set(auth("workerA")).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("job_closed");
  });

  it("lists only my own postings to an official", async () => {
    const res = await api.get("/api/v1/jobs/posted").set(auth("officialEKM"));
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].applications_count).toBe(1);

    const other = await api.get("/api/v1/jobs/posted").set(auth("officialTN"));
    expect(other.body.jobs).toHaveLength(0);
  });

  it("rejects workers on posting routes and governments on matching routes", async () => {
    const workerPost = await api.post("/api/v1/jobs").set(auth("workerA")).send({});
    expect(workerPost.status).toBe(403);

    const govBrowse = await api.get("/api/v1/jobs").set(auth("officialEKM"));
    expect(govBrowse.status).toBe(403);
  });

  it("keeps applications unique per worker and listing", async () => {
    const count = await JobApplication.countDocuments({ job_id: kerakaJobId, worker_id: ids.workerA._id });
    expect(count).toBe(1);
  });
});

// ── Applicant review (reverse matching for the posting office) ───────
describe("scoreApplicant", () => {
  const job = { occupation: "construction", district: "Thrissur", state: "Kerala" };

  it("rates a same-trade, same-state applicant above a different-trade one", () => {
    const near = scoreApplicant(job, {
      occupation: "construction",
      current_district: "Ernakulam",
      current_state: "Kerala",
    });
    const far = scoreApplicant(job, {
      occupation: "hospitality",
      current_district: "Chennai",
      current_state: "Tamil Nadu",
    });

    expect(near.score).toBe(65);
    expect(near.level).toBe("good");
    expect(near.reasons).toEqual(expect.arrayContaining(["occupation_match", "same_state"]));

    expect(far.score).toBe(0);
    expect(far.level).toBe("possible");
    expect(far.reasons).toContain("different_trade");
  });

  it("flags a thin profile instead of scoring absence as a judgement", () => {
    const { score, reasons } = scoreApplicant(job, { occupation: null });
    expect(score).toBe(0);
    expect(reasons).toContain("detail_not_recorded");
    expect(reasons).not.toContain("different_trade");
  });

  it("gives an 'any trade' listing partial credit to everyone", () => {
    const { score, reasons } = scoreApplicant({ occupation: "any", state: "Kerala" }, {
      occupation: "weaving",
      current_state: "Kerala",
    });
    expect(reasons).toContain("open_to_any_trade");
    expect(reasons).not.toContain("different_trade");
    expect(score).toBeGreaterThan(0);
  });
});

describe("applicant review", () => {
  let jobId;
  let appA; // construction worker, Kerala (matches the trade)
  let appB; // hospitality worker, Tamil Nadu (different trade)

  beforeAll(async () => {
    const created = await api
      .post("/api/v1/jobs")
      .set(auth("officialKL"))
      .send({
        title: "Mason for Thrissur site",
        description: "Long enough description for the applicant review flow to pass validation.",
        employer_name: "Thrissur Builders",
        occupation: "construction",
        district: "Thrissur",
        wage_min: 700,
        wage_max: 900,
      });
    expect(created.status).toBe(201);
    jobId = created.body.id;

    const a = await api
      .post(`/api/v1/jobs/${jobId}/apply`)
      .set(auth("workerA"))
      .send({ note: "Ten years on site" });
    expect(a.status).toBe(201);
    appA = a.body.id;

    const b = await api
      .post(`/api/v1/jobs/${jobId}/apply`)
      .set(auth("workerB"))
      .send({ share_contact: true });
    expect(b.status).toBe(201);
    appB = b.body.id;
  });

  it("ranks the closer profile first and explains the fit", async () => {
    const res = await api.get(`/api/v1/jobs/${jobId}/applications`).set(auth("officialKL"));
    expect(res.status).toBe(200);
    expect(res.body.applications).toHaveLength(2);
    expect(res.body.counts).toEqual({ total: 2, shortlisted: 0 });

    const [first, second] = res.body.applications;
    expect(first.id).toBe(appA);
    expect(first.review.score).toBeGreaterThan(second.review.score);
    expect(first.review.reasons).toEqual(expect.arrayContaining(["occupation_match", "same_state"]));
    expect(second.review.reasons).toContain("different_trade");
    expect(res.body.matching_note).toMatch(/not a rating of the worker/i);
  });

  it("never reveals a phone number the worker did not share", async () => {
    const res = await api.get(`/api/v1/jobs/${jobId}/applications`).set(auth("officialKL"));
    const byId = new Map(res.body.applications.map((a) => [a.id, a]));
    expect(byId.get(appA).worker.contact_phone).toBeNull();
    expect(byId.get(appB).worker.contact_phone).toBe(ids.workerB.mobile_number);
  });

  it("shortlists an applicant, shows it to the worker, and can undo it", async () => {
    const shortlist = await api
      .patch(`/api/v1/jobs/${jobId}/applications/${appA}`)
      .set(auth("officialKL"))
      .send({ status: "shortlisted" });
    expect(shortlist.status).toBe(200);
    expect(shortlist.body.shortlisted).toBe(true);
    expect(shortlist.body.reviewed_at).toBeTruthy();

    const list = await api.get(`/api/v1/jobs/${jobId}/applications`).set(auth("officialKL"));
    expect(list.body.counts.shortlisted).toBe(1);

    const posted = await api.get("/api/v1/jobs/posted").set(auth("officialKL"));
    const posting = posted.body.jobs.find((j) => j.id === jobId);
    expect(posting.applications_count).toBe(2);
    expect(posting.shortlisted_count).toBe(1);

    // The worker learns their application was read — nothing more.
    const mine = await api.get("/api/v1/jobs/applications/mine").set(auth("workerA"));
    const own = mine.body.applications.find((a) => a.job_id === jobId);
    expect(own.status).toBe("shortlisted");
    expect(own.shortlisted).toBe(true);

    const undo = await api
      .patch(`/api/v1/jobs/${jobId}/applications/${appA}`)
      .set(auth("officialKL"))
      .send({ status: "submitted" });
    expect(undo.status).toBe(200);
    expect(undo.body.shortlisted).toBe(false);
  });

  it("refuses to wipe a shortlist when the worker re-applies", async () => {
    await api
      .patch(`/api/v1/jobs/${jobId}/applications/${appA}`)
      .set(auth("officialKL"))
      .send({ status: "shortlisted" });

    const again = await api.post(`/api/v1/jobs/${jobId}/apply`).set(auth("workerA")).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_applied");

    const list = await api.get(`/api/v1/jobs/${jobId}/applications`).set(auth("officialKL"));
    const still = list.body.applications.find((a) => a.id === appA);
    expect(still.shortlisted).toBe(true);
  });

  it("hides a withdrawn application from the office queue", async () => {
    const withdraw = await api.delete(`/api/v1/jobs/${jobId}/apply`).set(auth("workerA"));
    expect(withdraw.status).toBe(200);

    const list = await api.get(`/api/v1/jobs/${jobId}/applications`).set(auth("officialKL"));
    expect(list.body.applications.map((a) => a.id)).not.toContain(appA);
    expect(list.body.counts.total).toBe(1);

    // Re-applying revives the same row, so the API answers 200, not 201.
    const readd = await api.post(`/api/v1/jobs/${jobId}/apply`).set(auth("workerA")).send({});
    expect(readd.status).toBe(200);
    // Re-applying starts a fresh, unreviewed application.
    expect(await JobApplication.findById(readd.body.id).then((a) => a.reviewed_at)).toBeNull();
    appA = readd.body.id;
  });

  it("validates the review status", async () => {
    const bad = await api
      .patch(`/api/v1/jobs/${jobId}/applications/${appA}`)
      .set(auth("officialKL"))
      .send({ status: "hired" });
    expect(bad.status).toBe(422);
  });

  it("returns 404 — not 403 — to an office from another jurisdiction", async () => {
    const foreign = await api
      .patch(`/api/v1/jobs/${jobId}/applications/${appA}`)
      .set(auth("officialTN"))
      .send({ status: "shortlisted" });
    expect(foreign.status).toBe(404);

    const foreignList = await api.get(`/api/v1/jobs/${jobId}/applications`).set(auth("officialTN"));
    expect(foreignList.status).toBe(404);

    // The record is untouched by the foreign attempt.
    const stillSubmitted = await JobApplication.findById(appA);
    expect(stillSubmitted.status).toBe("submitted");
  });

  it("does not let an application be reviewed through the wrong listing", async () => {
    const otherJob = await api
      .post("/api/v1/jobs")
      .set(auth("officialKL"))
      .send({
        title: "Helper for a second site",
        description: "A second listing used to prove application ids are scoped to their job.",
        employer_name: "Thrissur Builders",
        occupation: "construction",
        district: "Thrissur",
      });
    expect(otherJob.status).toBe(201);

    const mismatched = await api
      .patch(`/api/v1/jobs/${otherJob.body.id}/applications/${appA}`)
      .set(auth("officialKL"))
      .send({ status: "shortlisted" });
    expect(mismatched.status).toBe(404);
  });
});
