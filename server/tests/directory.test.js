/**
 * Signed-in contact directory.
 *
 * The properties under test:
 *  1. Contact numbers are not public. /public/workers still returns no phone.
 *  2. An authenticated employer or household account gets the same accepted
 *     workers with a phone number attached.
 *  3. Workers, officials and anonymous callers cannot read the contact list.
 *  4. Visibility stays identical to the public rule: pending/rejected workers
 *     are absent, so signing in never widens who can be found.
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
  await mongoose.connect(mongod.getUri("shramsetu-directory"));

  ids.employer = await makeUser({
    role: "employer",
    full_name: "Ravi Menon",
    fields: { business_name: "SK Constructions", current_state: "Kerala", current_district: "Ernakulam", gov_approve_status: "accepted" },
  });
  ids.citizen = await makeUser({
    role: "citizen",
    full_name: "Valsa Thomas",
    fields: { current_state: "Kerala", current_district: "Ernakulam" },
  });
  ids.official = await makeUser({
    role: "government",
    full_name: "Kerala Officer",
    fields: { employee_id: "DR900", state: "Kerala", department: "Labour Department" },
  });
  ids.acceptedWorker = await makeUser({
    full_name: "Ramesh Kumar",
    mobile_number: "9555500901",
    fields: {
      worker_id: "SS-400001",
      occupation: "construction",
      years_of_experience: 8,
      current_village_or_city: "Kakkanad",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "accepted",
    },
  });
  ids.pendingWorker = await makeUser({
    full_name: "Meena Kumari",
    mobile_number: "9555500902",
    fields: {
      worker_id: "SS-400002",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "pending",
    },
  });
  ids.rejectedWorker = await makeUser({
    full_name: "Rejected Rao",
    mobile_number: "9555500903",
    fields: {
      worker_id: "SS-400003",
      occupation: "construction",
      current_state: "Kerala",
      current_district: "Ernakulam",
      gov_approve_status: "rejected",
    },
  });

  tokens.employer = signToken(ids.employer);
  tokens.citizen = signToken(ids.citizen);
  tokens.official = signToken(ids.official);
  tokens.worker = signToken(ids.acceptedWorker);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

describe("signed-in contact directory", () => {
  it("refuses anonymous callers", async () => {
    const res = await api.get("/api/v1/directory/workers");
    expect(res.status).toBe(401);
  });

  it("returns accepted workers with a phone number to an employer", async () => {
    const res = await api
      .get("/api/v1/directory/workers")
      .set("Authorization", `Bearer ${tokens.employer}`)
      .query({ name: "Ramesh" });

    expect(res.status).toBe(200);
    expect(res.body.workers).toHaveLength(1);
    const worker = res.body.workers[0];
    expect(worker.full_name).toBe("Ramesh Kumar");
    expect(worker.phone).toBe("9555500901");
    // Street address / identity documents never ride along.
    expect(worker).not.toHaveProperty("current_address_line");
    expect(worker).not.toHaveProperty("aadhaar_last4");
  });

  it("serves the same contact list to a household account", async () => {
    const res = await api
      .get("/api/v1/directory/workers")
      .set("Authorization", `Bearer ${tokens.citizen}`)
      .query({ place: "Ernakulam" });

    expect(res.status).toBe(200);
    expect(res.body.workers.map((w) => w.full_name)).toContain("Ramesh Kumar");
    expect(res.body.workers.find((w) => w.full_name === "Ramesh Kumar").phone).toBe("9555500901");
  });

  it("never lists a worker the labour office has not accepted", async () => {
    const res = await api
      .get("/api/v1/directory/workers")
      .set("Authorization", `Bearer ${tokens.employer}`)
      .query({ place: "Ernakulam", page_size: 50 });

    expect(res.status).toBe(200);
    const names = res.body.workers.map((w) => w.full_name);
    expect(names).toContain("Ramesh Kumar");
    expect(names).not.toContain("Meena Kumari");
    expect(names).not.toContain("Rejected Rao");
  });

  it("keeps the same visibility as the public list", async () => {
    const [publicRes, signedInRes] = await Promise.all([
      api.get("/api/v1/public/workers").query({ place: "Ernakulam", page_size: 50 }),
      api
        .get("/api/v1/directory/workers")
        .set("Authorization", `Bearer ${tokens.employer}`)
        .query({ place: "Ernakulam", page_size: 50 }),
    ]);

    expect(publicRes.status).toBe(200);
    expect(signedInRes.status).toBe(200);
    expect(publicRes.body.total).toBe(signedInRes.body.total);
    expect(publicRes.body.workers.map((w) => w.id)).toEqual(signedInRes.body.workers.map((w) => w.id));
    // The public row is the signed-in row minus the phone number.
    for (const row of publicRes.body.workers) {
      expect(row).not.toHaveProperty("phone");
    }
  });

  it("blocks workers and officials from the contact list", async () => {
    for (const token of [tokens.worker, tokens.official]) {
      const res = await api
        .get("/api/v1/directory/workers")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
  });
});
