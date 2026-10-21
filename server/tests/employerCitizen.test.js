/**
 * Phase 4 integration tests — government-ACCEPTED employer onboarding,
 * employer self-service job postings, citizen service requests.
 *
 * The properties under test:
 *  1. A new employer account starts PENDING and cannot post jobs or rate
 *     workers until a labour office accepts it (mirror of the worker gate).
 *  2. An accepted employer posts listings whose employer name comes from the
 *     accepted account, and the match score honestly exposes the small
 *     "employer_accepted" trust signal.
 *  3. Citizen help requests never leak a phone number in EITHER direction
 *     until the worker accepts the request; acceptance reveals both sides
 *     exactly once and only then.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
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
  await mongoose.connect(mongod.getUri("shramsetu-employer-citizen"));

  ids.pendingEmployer = await makeUser({
    role: "employer",
    full_name: "Sara Hardware Owner",
    fields: {
      business_name: "Sara Hardware Works",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "pending",
    },
  });
  ids.acceptedEmployer = await makeUser({
    role: "employer",
    full_name: "Greenline Care Owner",
    fields: {
      business_name: "Greenline Home Services",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.foreignEmployer = await makeUser({
    role: "employer",
    full_name: "Offstate Owner",
    fields: { business_name: "Offstate Ltd", current_state: "Tamil Nadu", current_district: "Chennai" },
  });
  ids.official = await makeUser({
    role: "government",
    full_name: "Kerala Officer",
    fields: { employee_id: "EC900", state: "Kerala", district: "Ernakulam", department: "Labour Department" },
  });
  ids.otherStateOfficial = await makeUser({
    role: "government",
    full_name: "TN Officer",
    fields: { employee_id: "EC901", state: "Tamil Nadu", district: "Chennai", department: "Labour Department" },
  });
  ids.worker = await makeUser({
    full_name: "Accepted Kumar",
    fields: {
      worker_id: "SS-300001",
      occupation: "construction",
      current_village_or_city: "Kakkanad",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.rivalWorker = await makeUser({
    full_name: "Rival Kumar",
    fields: {
      worker_id: "SS-300002",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.pendingWorker = await makeUser({
    full_name: "Pending Kumar",
    fields: {
      worker_id: "SS-300003",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "pending",
    },
  });
  ids.citizen = await makeUser({
    role: "citizen",
    full_name: "Mother Valsa",
    fields: {
      current_village_or_city: "Kakkanad",
      current_state: "Kerala",
      current_district: "Ernakulam",
    },
  });
  ids.otherCitizen = await makeUser({
    role: "citizen",
    full_name: "Other Valsa",
    fields: { current_state: "Kerala", current_district: "Ernakulam" },
  });

  for (const [key, u] of Object.entries(ids)) {
    tokens[key] = signToken({ _id: u._id, role: u.role, worker_id: u.worker_id, employee_id: u.employee_id });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const auth = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

// ── Registration shape ────────────────────────────────────────────────
describe("employer registration gate", () => {
  it("registers a citizen account without any labour-office gate", async () => {
    const res = await api.post("/api/v1/auth/citizen/register").send({
      full_name: "House Benoy",
      mobile_number: "8899001122",
      password: "Citizen@1",
      current_district: "Ernakulam",
      current_state: "Kerala",
    });
    expect(res.status).toBe(201);
    expect(res.body.recovery_key).toBeDefined();
    const row = await User.findOne({ role: "citizen", mobile_number: "8899001122" });
    expect(row).not.toBeNull();
    expect(row.is_phone_verified).toBe(false);
  });
  it("registers a new employer as PENDING for labour-office acceptance", async () => {
    const res = await api.post("/api/v1/auth/employer/register").send({
      full_name: "New Boss",
      mobile_number: "8123456789",
      password: "Employer@1",
      business_name: "New Boss Constructions",
      business_state: "Kerala",
      business_district: "Ernakulam",
    });
    expect(res.status).toBe(201);
    expect(res.body.gov_approve_status).toBe("pending");
    expect(res.body.recovery_key).toBeDefined();
    const row = await User.findOne({ role: "employer", mobile_number: "8123456789" });
    expect(row.gov_approve_status).toBe("pending");
    expect(row.current_district).toBe("Ernakulam");
  });

  it("a pending employer cannot post a job listing", async () => {
    const res = await api
      .post("/api/v1/jobs")
      .set(auth("pendingEmployer"))
      .send({
        title: "Helper needed at shop counter",
        description: "Sorting parcels and helping customers at a small retail shop.",
        occupation: "construction",
        state: "Kerala",
        district: "Ernakulam",
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("gov_approval_pending");
  });

  it("a pending employer cannot attach a public rating to a worker", async () => {
    const res = await api
      .post(`/api/v1/ratings/worker/${ids.worker._id}`)
      .set(auth("pendingEmployer"))
      .send({ stars: 5, comment: "Good work" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("gov_approval_pending");
  });

  it("the approval queue lists the pending employer, scoped to the official", async () => {
    const res = await api
      .get("/api/v1/government/employer-approvals")
      .query({ status: "pending" })
      .set(auth("official"));
    expect(res.status).toBe(200);
    expect(res.body.employers.some((e) => e.business_name === "Sara Hardware Works")).toBe(true);
    // Two pending employers at this point: the seeded one and the one the
    // register test created (same state/district scope).
    expect(res.body.counts.pending).toBe(2);

    const tn = await api.get("/api/v1/government/employer-approvals").set(auth("otherStateOfficial"));
    expect(tn.body.employers.some((e) => e.business_name === "Sara Hardware Works")).toBe(false);
  });

  it("dashboard stats include employer counts", async () => {
    const res = await api.get("/api/v1/government/dashboard/stats").set(auth("official"));
    expect(res.status).toBe(200);
    expect(res.body.total_employers).toBeGreaterThanOrEqual(3);
    expect(res.body.pending_employers).toBe(2);
  });

  it("accepting the employer unlocks posting; identity is fixed to the account", async () => {
    const approve = await api
      .patch(`/api/v1/government/employers/${ids.pendingEmployer._id}/approval`)
      .set(auth("official"))
      .send({ status: "accepted" });
    expect(approve.status).toBe(200);
    expect(approve.body.gov_approve_status).toBe("accepted");

    const me = await api.get("/api/v1/auth/employer/me").set(auth("pendingEmployer"));
    expect(me.body.gov_approve_status).toBe("accepted");
    expect(me.body.business_name).toBe("Sara Hardware Works");

    const post = await api
      .post("/api/v1/jobs")
      .set(auth("pendingEmployer"))
      .send({
        title: "Shop assistant for hardware counter",
        description: "Front desk help at a hardware shop; daily wage, local area only.",
        occupation: "other",
        state: "Kerala",
        district: "Ernakulam",
        openings: 2,
        // employer_name is IGNORED for employer posters — it must come from
        // the accepted account so no unattributed name reaches workers.
        employer_name: "Totally Different Name",
      });
    expect(post.status).toBe(201);
    expect(post.body.posted_by_role).toBe("employer");
    expect(post.body.employer_accepted).toBe(true);
    expect(post.body.employer_name).toBe("Sara Hardware Works");
    expect(post.body.verification).toBe("unverified"); // listing itself is never "verified"
    ids.jobId = post.body.id;

    const mine = await api.get("/api/v1/jobs/posted").set(auth("pendingEmployer"));
    expect(mine.body.jobs).toHaveLength(1);
    expect(mine.body.jobs[0].id).toBe(ids.jobId);
  });

  it("workers see the employer-accepted trust signal in match reasons", async () => {
    const res = await api.get("/api/v1/jobs").set(auth("worker"));
    expect(res.status).toBe(200);
    const job = res.body.jobs.find((j) => j.id === ids.jobId);
    expect(job).toBeDefined();
    expect(job.match.reasons).toContain("employer_accepted");
  });

  it("an accepted employer reads applicants when the worker consents to share contact", async () => {
    const apply = await api
      .post(`/api/v1/jobs/${ids.jobId}/apply`)
      .set(auth("worker"))
      .send({ share_contact: true, note: "Ten years counter experience" });
    expect(apply.status).toBe(201);

    const applicants = await api.get(`/api/v1/jobs/${ids.jobId}/applications`).set(auth("pendingEmployer"));
    expect(applicants.status).toBe(200);
    const row = applicants.body.applications.find((a) => a.worker.worker_code === "SS-300001");
    expect(row).toBeDefined();
    expect(row.worker.contact_phone).toBe(ids.worker.mobile_number); // consented reveal

    // A foreign employer gets the same 404 as a missing listing.
    const foreignGiven = await api.get(`/api/v1/jobs/${ids.jobId}/applications`).set(auth("foreignEmployer"));
    expect(foreignGiven.status).toBe(404);
  });

  it("the posting employer can shortlist and close its own listing", async () => {
    const mine = await api.get("/api/v1/jobs/posted").set(auth("pendingEmployer"));
    const applicationId = mine.body.jobs[0].applications_count > 0; // count sanity
    expect(applicationId).toBe(true);

    const list = await api.get(`/api/v1/jobs/${ids.jobId}/applications`).set(auth("pendingEmployer"));
    const aid = list.body.applications[0].id;
    const shortlist = await api
      .patch(`/api/v1/jobs/${ids.jobId}/applications/${aid}`)
      .set(auth("pendingEmployer"))
      .send({ status: "shortlisted" });
    expect(shortlist.status).toBe(200);
    expect(shortlist.body.status).toBe("shortlisted");

    const close = await api
      .patch(`/api/v1/jobs/${ids.jobId}/status`)
      .set(auth("pendingEmployer"))
      .send({ status: "closed" });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe("closed");
  });
});

// ── Citizen requests ──────────────────────────────────────────────────
describe("citizen service requests", () => {
  let requestId;

  it("citizen password login works", async () => {
    const res = await api.post("/api/v1/auth/citizen/login").send({
      mobile_number: ids.citizen.mobile_number,
      password: "Test@123",
    });
    expect(res.status).toBe(200);
    expect(res.body.citizen.role).toBe("citizen");
    expect(res.body.access_token).toBeDefined();
  });

  it("a citizen posts a help request; a worker cannot post one", async () => {
    const ok = await api
      .post("/api/v1/requests")
      .set(auth("citizen"))
      .send({
        occupation: "construction",
        description: "Need a helper for two days to fix the tiled courtyard drain.",
        area_village: "Kakkanad",
        district: "Ernakulam",
        state: "Kerala",
        preferred_time: "Any morning this week",
      });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("open");
    requestId = ok.body.id;
    expect(ok.body.worker).toBeNull(); // no contact before acceptance

    const bad = await api.post("/api/v1/requests").set(auth("citizen")).send({
      occupation: "astronaut",
      description: "Unsupported trade should be rejected here.",
    });
    expect(bad.status).toBe(422);

    const workerPost = await api.post("/api/v1/requests").set(auth("worker")).send({
      occupation: "construction",
      description: "Workers must not post household requests.",
    });
    expect(workerPost.status).toBe(403);
  });

  it("open requests never leak the citizen's phone; scoring is explainable", async () => {
    const res = await api.get("/api/v1/requests/nearby").set(auth("worker"));
    expect(res.status).toBe(200);
    const row = res.body.requests.find((r) => r.id === requestId);
    expect(row).toBeDefined();
    expect(row.citizen_name).toBe("Mother Valsa");
    expect(JSON.stringify(row)).not.toContain("contact_phone");
    expect(JSON.stringify(row)).not.toContain(ids.citizen.mobile_number);
    expect(row.match.reasons).toContain("occupation_match");
    expect(row.match.reasons).toContain("same_district");
    expect(row.match.reasons).toContain("same_area");
  });

  it("a pending worker cannot accept a house request", async () => {
    const res = await api.post(`/api/v1/requests/${requestId}/accept`).set(auth("pendingWorker"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("gov_approval_pending");
  });

  it("accepting reveals both sides' phones exactly once, first-come only", async () => {
    const win = await api.post(`/api/v1/requests/${requestId}/accept`).set(auth("worker"));
    expect(win.status).toBe(200);
    expect(win.body.citizen.phone).toBe(ids.citizen.mobile_number);

    const lost = await api.post(`/api/v1/requests/${requestId}/accept`).set(auth("rivalWorker"));
    expect(lost.status).toBe(404); // already taken — no second acceptor

    const citizenView = await api.get("/api/v1/requests/mine").set(auth("citizen"));
    const row = citizenView.body.requests.find((r) => r.id === requestId);
    expect(row.status).toBe("accepted");
    expect(row.worker.phone).toBe(ids.worker.mobile_number);
    expect(row.worker.worker_code).toBe("SS-300001");

    const workerView = await api.get("/api/v1/requests/accepted").set(auth("worker"));
    const taken = workerView.body.requests.find((r) => r.id === requestId);
    expect(taken.citizen.phone).toBe(ids.citizen.mobile_number);
    expect(taken.citizen.name).toBe("Mother Valsa");
  });

  it("citizen marks the request done; cancel only works while open", async () => {
    const done = await api.post(`/api/v1/requests/${requestId}/done`).set(auth("citizen"));
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("done");

    const again = await api.post(`/api/v1/requests/${requestId}/done`).set(auth("citizen"));
    expect(again.status).toBe(409);

    const second = await api
      .post("/api/v1/requests")
      .set(auth("otherCitizen"))
      .send({ occupation: "any", description: "Household request used to test cancellation." });
    expect(second.status).toBe(201);
    const cancel = await api.post(`/api/v1/requests/${second.body.id}/cancel`).set(auth("otherCitizen"));
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
  });

  it("ownership boundaries: a citizen cannot touch another citizen's request", async () => {
    const mine = await api.get("/api/v1/requests/mine").set(auth("otherCitizen"));
    expect(mine.body.requests.every((r) => r.status === "cancelled")).toBe(true);

    const listing = await api
      .post("/api/v1/requests")
      .set(auth("citizen"))
      .send({ occupation: "any", description: "Ownership boundary check request." });
    expect(listing.status).toBe(201);
    const steal = await api.post(`/api/v1/requests/${listing.body.id}/done`).set(auth("otherCitizen"));
    expect(steal.status).toBe(404);
  });
});
