/**
 * Browser sessions: httpOnly cookies, rotating refresh tokens, CSRF.
 *
 * These tests drive the API the way a browser does — a supertest agent keeps the
 * cookie jar and sends no Authorization header — and assert the properties that
 * make the scheme worth having:
 *
 *  - the access token is httpOnly (JS cannot read it) and the CSRF token is not;
 *  - an unsafe cookie-authenticated request without the CSRF header is refused;
 *  - a bearer request still works and needs no CSRF token;
 *  - refresh rotates, and reusing a rotated token revokes the whole chain;
 *  - logout revokes server-side, so a copied refresh token stops working;
 *  - only the sha256 of the refresh token is stored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { hashPassword, sha256 } from "../src/utils/crypto.js";

const api = supertest(app);

let mongod;
const PASSWORD = "Session@123";

function cookieValue(res, name) {
  const raw = res.headers["set-cookie"] || [];
  for (const entry of raw) {
    const [pair] = entry.split(";");
    const index = pair.indexOf("=");
    if (pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1));
  }
  return null;
}

function cookieAttrs(res, name) {
  const raw = res.headers["set-cookie"] || [];
  return raw.find((entry) => entry.startsWith(`${name}=`)) || "";
}

const cookiefy = (cookies) =>
  Object.entries(cookies)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

let workerId;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-test"));

  const worker = await User.create({
    role: "worker",
    full_name: "Session Worker",
    mobile_number: `9${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword(PASSWORD),
    is_phone_verified: true,
    is_active: true,
  });
  workerId = String(worker._id);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function login(agent = api) {
  return agent.post("/api/v1/auth/worker/login").send({
    mobile_number: (await User.findById(workerId)).mobile_number,
    password: PASSWORD,
  });
}

describe("login sets cookies instead of handing the browser a token", () => {
  it("sets an httpOnly access cookie, an httpOnly refresh cookie and a readable CSRF cookie", async () => {
    const res = await login();
    expect(res.status).toBe(200);

    expect(cookieAttrs(res, "st_access")).toMatch(/HttpOnly/i);
    expect(cookieAttrs(res, "st_refresh")).toMatch(/HttpOnly/i);
    expect(cookieAttrs(res, "st_csrf")).not.toMatch(/HttpOnly/i);
    expect(cookieAttrs(res, "st_access")).toMatch(/SameSite=Lax/i);
    // The refresh token must not travel to every endpoint.
    expect(cookieAttrs(res, "st_refresh")).toMatch(/Path=\/api\/v1\/auth/i);

    expect(cookieValue(res, "st_access")).toBeTruthy();
    expect(cookieValue(res, "st_refresh")).toBeTruthy();
    expect(cookieValue(res, "st_csrf")).toBeTruthy();
  });

  it("authenticates a plain GET from the cookie alone", async () => {
    const res = await login();
    const cookies = {
      st_access: cookieValue(res, "st_access"),
      st_refresh: cookieValue(res, "st_refresh"),
      st_csrf: cookieValue(res, "st_csrf"),
    };

    const me = await api.get("/api/v1/auth/worker/me").set("Cookie", cookiefy(cookies));
    expect(me.status).toBe(200);
    expect(me.body.full_name).toBe("Session Worker");
  });

  it("keeps returning a bearer token, which still works without cookies", async () => {
    const res = await login();
    expect(typeof res.body.access_token).toBe("string");

    const me = await api
      .get("/api/v1/auth/worker/me")
      .set("Authorization", `Bearer ${res.body.access_token}`);
    expect(me.status).toBe(200);
  });
});

describe("CSRF double submit", () => {
  it("refuses an unsafe cookie-authenticated request without the header", async () => {
    const res = await login();
    const cookies = {
      st_access: cookieValue(res, "st_access"),
      st_refresh: cookieValue(res, "st_refresh"),
      st_csrf: cookieValue(res, "st_csrf"),
    };

    const attempt = await api
      .post("/api/v1/documents/pin/set")
      .set("Cookie", cookiefy(cookies))
      .send({ pin: "4821" });
    expect(attempt.status).toBe(403);
    expect(attempt.body.code).toBe("csrf_failed");
  });

  it("accepts the same request once the header echoes the cookie", async () => {
    const res = await login();
    const csrf = cookieValue(res, "st_csrf");
    const cookies = { st_access: cookieValue(res, "st_access"), st_csrf: csrf };

    const attempt = await api
      .post("/api/v1/documents/pin/set")
      .set("Cookie", cookiefy(cookies))
      .set("X-CSRF-Token", csrf)
      .send({ pin: "4821" });
    expect(attempt.status).toBe(200);
  });

  it("refuses a mismatched CSRF header", async () => {
    const res = await login();
    const cookies = { st_access: cookieValue(res, "st_access"), st_csrf: cookieValue(res, "st_csrf") };

    const attempt = await api
      .post("/api/v1/documents/pin/set")
      .set("Cookie", cookiefy(cookies))
      .set("X-CSRF-Token", "x".repeat(cookieValue(res, "st_csrf").length))
      .send({ pin: "4821" });
    expect(attempt.status).toBe(403);
  });

  it("does not require a CSRF header for bearer clients", async () => {
    const res = await login();
    const attempt = await api
      .post("/api/v1/documents/pin/verify")
      .set("Authorization", `Bearer ${res.body.access_token}`)
      .send({ pin: "4821" });
    expect(attempt.status).toBe(200);
  });
});

describe("refresh rotation", () => {
  it("trades a refresh cookie for a new pair and rejects CSRF-less calls", async () => {
    const res = await login();
    const refresh = cookieValue(res, "st_refresh");
    const csrf = cookieValue(res, "st_csrf");

    const noCsrf = await api.post("/api/v1/auth/refresh").set("Cookie", `st_refresh=${refresh}`);
    expect(noCsrf.status).toBe(403);

    const ok = await api
      .post("/api/v1/auth/refresh")
      .set("Cookie", `st_refresh=${refresh}; st_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(ok.status).toBe(200);
    expect(cookieValue(ok, "st_access")).toBeTruthy();

    const access = cookieValue(ok, "st_access");
    const me = await api.get("/api/v1/auth/worker/me").set("Cookie", `st_access=${access}`);
    expect(me.status).toBe(200);
  });

  it("revokes the whole chain when a rotated token is presented again", async () => {
    const res = await login();
    const first = cookieValue(res, "st_refresh");
    const csrf = cookieValue(res, "st_csrf");

    const rotated = await api
      .post("/api/v1/auth/refresh")
      .set("Cookie", `st_refresh=${first}; st_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(rotated.status).toBe(200);
    const second = cookieValue(rotated, "st_refresh");

    // The stolen copy is used later: that is the reuse signal.
    const reuse = await api
      .post("/api/v1/auth/refresh")
      .set("Cookie", `st_refresh=${first}; st_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe("session_reused");

    // ...and the legitimate holder's current token is dead too.
    const after = await api
      .post("/api/v1/auth/refresh")
      .set("Cookie", `st_refresh=${second}; st_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(after.status).toBe(401);
  });

  it("stores only the sha256 of the refresh token", async () => {
    const res = await login();
    const refresh = cookieValue(res, "st_refresh");
    const stored = await Session.findOne({ user_id: workerId }).sort({ createdAt: -1 }).lean();

    expect(stored.token_hash).toBe(sha256(refresh));
    expect(stored.token_hash).not.toBe(refresh);
    expect(stored.token_hash).toHaveLength(64);
    expect(stored.family_id).toBeTruthy();
  });

  it("answers 401 when no refresh cookie is presented", async () => {
    const csrf = "abc123";
    const res = await api
      .post("/api/v1/auth/refresh")
      .set("Cookie", `st_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(401);
  });
});

describe("logout", () => {
  it("revokes the session server-side and clears the cookies", async () => {
    const res = await login();
    const refresh = cookieValue(res, "st_refresh");
    const csrf = cookieValue(res, "st_csrf");

    const out = await api
      .post("/api/v1/auth/logout")
      .set("Cookie", `st_refresh=${refresh}; st_csrf=${csrf}`);
    expect(out.status).toBe(200);
    expect(cookieAttrs(out, "st_access")).toMatch(/st_access=;/);
    expect(cookieAttrs(out, "st_refresh")).toMatch(/st_refresh=;/);

    // A copy taken before logout no longer works.
    const reuse = await api
      .post("/api/v1/auth/refresh")
      .set("Cookie", `st_refresh=${refresh}; st_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(reuse.status).toBe(401);

    const record = await Session.findOne({ token_hash: sha256(refresh) }).lean();
    expect(record.revoked_at).not.toBeNull();
    expect(record.revoked_reason).toBe("logout");
  });

  it("also ends the session through /worker/logout", async () => {
    const res = await login();
    const cookies = {
      st_access: cookieValue(res, "st_access"),
      st_refresh: cookieValue(res, "st_refresh"),
      st_csrf: cookieValue(res, "st_csrf"),
    };

    const out = await api
      .post("/api/v1/auth/worker/logout")
      .set("Cookie", cookiefy(cookies))
      .set("X-CSRF-Token", cookies.st_csrf);
    expect(out.status).toBe(200);

    const reuse = await api
      .post("/api/v1/auth/refresh")
      .set("Cookie", `st_refresh=${cookies.st_refresh}; st_csrf=${cookies.st_csrf}`)
      .set("X-CSRF-Token", cookies.st_csrf);
    expect(reuse.status).toBe(401);
  });
});

describe("expired or missing access cookie", () => {
  it("tells the SPA the token expired so it can refresh", async () => {
    const res = await login();
    const access = cookieValue(res, "st_access");
    // A syntactically valid but foreign-signed token.
    const fake = `${access.slice(0, -6)}abcdef`;

    const me = await api.get("/api/v1/auth/worker/me").set("Cookie", `st_access=${fake}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("token_expired");
  });
});
