/**
 * Worker identity card + public verification.
 *
 * The properties under test:
 *   1. A worker can fetch their own card, and the card carries a verification
 *      URL whose token is derived from the worker code — never the code alone,
 *      because worker codes are sequential.
 *   2. Anyone holding the card (no session) can verify it, and gets only what
 *      is printed on the card: no phone number, no address, no Aadhaar digits.
 *   3. A card stops verifying when the registration is not accepted by a labour
 *      office, and a tampered token never verifies.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { hashPassword, signToken } from "../src/utils/crypto.js";
import { cardToken } from "../src/utils/cardToken.js";

const api = supertest(app);
let mongod;

const tokens = {};

async function makeUser(over = {}) {
  return User.create({
    role: over.role || "worker",
    full_name: over.full_name || "Test Worker",
    mobile_number: over.mobile_number || `8${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword("Test@123"),
    is_phone_verified: true,
    is_active: true,
    ...over.fields,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-idcard"));

  const accepted = await makeUser({
    full_name: "Lakshmi Devi",
    fields: {
      worker_id: "SS-000123",
      occupation: "Mason",
      years_of_experience: 6,
      current_district: "Bengaluru Urban",
      current_state: "Karnataka",
      gov_approve_status: "accepted",
    },
  });
  const pending = await makeUser({
    full_name: "Pending Worker",
    fields: { worker_id: "SS-000124", gov_approve_status: "pending" },
  });
  const employer = await makeUser({ role: "employer", full_name: "Site Owner" });

  for (const [key, user] of Object.entries({ accepted, pending, employer })) {
    tokens[key] = signToken({ _id: user._id, role: user.role, worker_id: user.worker_id });
  }
  tokens.acceptedId = accepted._id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /api/v1/id-card", () => {
  it("returns the card for the signed-in worker with a verifiable URL", async () => {
    const res = await api
      .get("/api/v1/id-card")
      .set("Authorization", `Bearer ${tokens.accepted}`)
      .expect(200);

    expect(res.body.worker_id).toBe("SS-000123");
    expect(res.body.full_name).toBe("Lakshmi Devi");
    expect(res.body.status).toBe("accepted");
    expect(res.body.issued).toBe(true);

    // The token is keyed, not the bare sequential code.
    expect(res.body.verify_code).toBe(`SS-000123.${cardToken("SS-000123")}`);
    expect(res.body.verify_url.endsWith(`/verify/${res.body.verify_code}`)).toBe(true);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("does not issue a usable card for a registration still pending approval", async () => {
    const res = await api
      .get("/api/v1/id-card")
      .set("Authorization", `Bearer ${tokens.pending}`)
      .expect(200);

    expect(res.body.status).toBe("pending");
    expect(res.body.issued).toBe(false);
  });

  it("refuses non-worker accounts", async () => {
    await api
      .get("/api/v1/id-card")
      .set("Authorization", `Bearer ${tokens.employer}`)
      .expect(403);
  });

  it("requires a session at all", async () => {
    await api.get("/api/v1/id-card").expect(401);
  });
});

describe("GET /api/v1/public/verify/worker/:code", () => {
  it("verifies an accepted worker without any session", async () => {
    const code = `SS-000123.${cardToken("SS-000123")}`;
    const res = await api.get(`/api/v1/public/verify/worker/${code}`).expect(200);

    expect(res.body.valid).toBe(true);
    expect(res.body.worker_id).toBe("SS-000123");
    expect(res.body.full_name).toBe("Lakshmi Devi");
    expect(res.body.occupation).toBe("Mason");
    expect(res.body.district).toBe("Bengaluru Urban");
  });

  it("leaks no contact details, address or Aadhaar digits", async () => {
    const code = `SS-000123.${cardToken("SS-000123")}`;
    const res = await api.get(`/api/v1/public/verify/worker/${code}`).expect(200);

    for (const key of [
      "mobile_number",
      "current_address_line",
      "aadhaar_last4",
      "email",
      "native_state",
      "password_hash",
      "recovery_key_hash",
    ]) {
      expect(res.body).not.toHaveProperty(key);
    }
  });

  it("rejects a tampered token", async () => {
    const good = cardToken("SS-000123");
    const bad = `${good.slice(0, -1)}${good.endsWith("a") ? "b" : "a"}`;
    await api.get(`/api/v1/public/verify/worker/SS-000123.${bad}`).expect(404);
  });

  it("rejects a bare worker code with no token", async () => {
    await api.get("/api/v1/public/verify/worker/SS-000123").expect(400);
  });

  it("rejects a well-formed code for a worker who is not accepted", async () => {
    const code = `SS-000124.${cardToken("SS-000124")}`;
    await api.get(`/api/v1/public/verify/worker/${code}`).expect(404);
  });

  it("returns the same 404 for an unknown worker as for a bad token", async () => {
    const unknown = await api
      .get(`/api/v1/public/verify/worker/SS-999999.${cardToken("SS-999999")}`)
      .expect(404);
    const badToken = await api.get("/api/v1/public/verify/worker/SS-000123.deadbeefdeadbeef").expect(404);
    expect(unknown.body).toEqual(badToken.body);
  });
});
