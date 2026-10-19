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
import { scoreJob, MIN_MATCH_SCORE } from "../src/utils/jobMatch.js";

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
