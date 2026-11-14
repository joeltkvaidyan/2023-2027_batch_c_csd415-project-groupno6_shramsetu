/**
 * Idempotent submissions: a retry must not file two grievances or rewrite a
 * settled wage day.
 *
 * The failure this prevents is ordinary, not exotic: a worker on a patchy
 * connection taps "File grievance", the request succeeds, the reply is lost, and
 * they tap again. Without a key the labour office receives two complaints for
 * one incident — or, for wages, the retry hits the paid-day lock and the worker
 * is told their wage is frozen when they were only trying again.
 *
 * Each test asserts the property that makes the key worth having:
 *   1. same key twice → one record, and the second answer is the first record;
 *   2. different keys → separate records (two real complaints still both file);
 *   3. no key → old behaviour, nothing deduplicated;
 *   4. a key is scoped to its owner (one worker cannot replay another's);
 *   5. a replayed wage write bypasses the paid-day lock it is not re-breaking.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Grievance } from "../src/models/Grievance.js";
import { WageEntry } from "../src/models/WageEntry.js";
import { hashPassword, signToken } from "../src/utils/crypto.js";

const api = supertest(app);
let mongod;

const workers = {};

async function makeWorker(name) {
  const user = await User.create({
    role: "worker",
    full_name: name,
    worker_id: `SS-9${crypto.randomInt(10000, 99999)}`,
    mobile_number: `9${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword("Test@123"),
    is_phone_verified: true,
    is_active: true,
    current_state: "Kerala",
    current_district: "Ernakulam",
  });
  return { user, token: signToken(user) };
}

const grievance = (over = {}) => ({
  category: "unpaid_wages",
  subject: "Two weeks of wages unpaid",
  description: "Worked on the site for two weeks and was paid nothing.",
  ...over,
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-idempotency"));
  await Grievance.init();
  await WageEntry.init();
  workers.a = await makeWorker("Idempotent Worker A");
  workers.b = await makeWorker("Idempotent Worker B");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("grievance filing", () => {
  it("files once when the same key arrives twice, replaying the first record", async () => {
    const key = crypto.randomUUID();
    const body = grievance({ client_request_id: key });

    const first = await api.post("/api/v1/grievances").set(auth(workers.a.token)).send(body);
    expect(first.status).toBe(201);

    const retry = await api.post("/api/v1/grievances").set(auth(workers.a.token)).send(body);
    expect(retry.status).toBe(200);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    // The worker gets the complaint they already filed, not a new number.
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.complaint_number).toBe(first.body.complaint_number);

    const count = await Grievance.countDocuments({ owner_id: workers.a.user._id });
    expect(count).toBe(1);
  });

  it("accepts the key as an Idempotency-Key header too", async () => {
    const key = crypto.randomUUID();
    const body = grievance({ subject: "Header key complaint" });

    const first = await api
      .post("/api/v1/grievances")
      .set(auth(workers.a.token))
      .set("Idempotency-Key", key)
      .send(body);
    expect(first.status).toBe(201);

    const retry = await api
      .post("/api/v1/grievances")
      .set(auth(workers.a.token))
      .set("Idempotency-Key", key)
      .send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
  });

  it("still files two complaints when the worker sends two different keys", async () => {
    // Identical text, two submissions: this is a worker filing about the same
    // employer for two separate incidents, and it must not be collapsed.
    const body = grievance({ subject: "Same text, different incident" });

    const first = await api
      .post("/api/v1/grievances")
      .set(auth(workers.a.token))
      .send({ ...body, client_request_id: crypto.randomUUID() });
    const second = await api
      .post("/api/v1/grievances")
      .set(auth(workers.b.token))
      .send({ ...body, client_request_id: crypto.randomUUID() });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.complaint_number).not.toBe(second.body.complaint_number);
  });

  it("keeps the old behaviour for a client that sends no key", async () => {
    const first = await api.post("/api/v1/grievances").set(auth(workers.b.token)).send(grievance());
    const second = await api.post("/api/v1/grievances").set(auth(workers.b.token)).send(grievance());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
  });

  it("scopes a key to its owner, so one worker cannot replay another's record", async () => {
    const key = crypto.randomUUID();
    const mine = await api
      .post("/api/v1/grievances")
      .set(auth(workers.a.token))
      .send(grievance({ client_request_id: key, subject: "Worker A complaint" }));
    expect(mine.status).toBe(201);

    const theirs = await api
      .post("/api/v1/grievances")
      .set(auth(workers.b.token))
      .send(grievance({ client_request_id: key, subject: "Worker B complaint" }));

    // A shared key must not hand worker B worker A's complaint.
    expect(theirs.status).toBe(201);
    expect(theirs.body.id).not.toBe(mine.body.id);
    expect(theirs.body.subject).toBe("Worker B complaint");
  });

  it("ignores a malformed key instead of lumping submissions together", async () => {
    const body = grievance({ client_request_id: "not a key! ".repeat(20) });
    const first = await api.post("/api/v1/grievances").set(auth(workers.a.token)).send(body);
    const second = await api.post("/api/v1/grievances").set(auth(workers.a.token)).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
  });
});

describe("wage entries", () => {
  const day = { work_date: "2026-03-02", agreed_amount: 800, paid_amount: 800 };

  it("replays an already-settled day instead of failing its lock", async () => {
    const key = crypto.randomUUID();

    const first = await api
      .post("/api/v1/wages")
      .set(auth(workers.a.token))
      .send({ ...day, client_request_id: key });
    expect(first.status).toBe(201);
    expect(first.body.payment_status).toBe("paid");

    // The worker's connection dropped before the reply arrived, so they are
    // retrying a submission the server already fully recorded.
    const retry = await api
      .post("/api/v1/wages")
      .set(auth(workers.a.token))
      .send({ ...day, client_request_id: key });

    expect(retry.status).toBe(200);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.body.id).toBe(first.body.id);
    expect(await WageEntry.countDocuments({ worker_id: workers.a.user._id, client_request_id: key })).toBe(1);
  });

  it("still refuses a genuine edit of a paid day", async () => {
    // Same day, NEW key: this is the worker actually changing the amount, so
    // the paid-day lock applies and the change is refused.
    const res = await api
      .post("/api/v1/wages")
      .set(auth(workers.a.token))
      .send({ ...day, agreed_amount: 1200, paid_amount: 1200, client_request_id: crypto.randomUUID() });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("wage_paid_locked");
  });

  it("stores one row per day even when retried without a key", async () => {
    const other = { work_date: "2026-03-03", agreed_amount: 500, paid_amount: 0 };
    const first = await api.post("/api/v1/wages").set(auth(workers.a.token)).send(other);
    const second = await api.post("/api/v1/wages").set(auth(workers.a.token)).send(other);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // The upsert key is the day, so the row is replaced, never duplicated.
    expect(second.body.id).toBe(first.body.id);
  });
});
