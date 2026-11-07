/**
 * Document-wallet PIN, now enforced by the server.
 *
 * What these tests protect: the PIN is hashed with scrypt and never returned,
 * five wrong guesses lock the wallet and the lock refuses even the correct PIN,
 * and — the part that makes the lock mean something — a download without a
 * wallet token is refused once a PIN exists. The old client-side version stored
 * a hash in localStorage that any script (or any person holding the phone)
 * could read or delete, so the "lock" only hid pixels in one browser.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import supertest from "supertest";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { clearUserCache } from "../src/middleware/auth.js";
import { hashPassword, signToken } from "../src/utils/crypto.js";

const api = supertest(app);

let mongod;
let worker;
let otherWorker;
let token;
let otherToken;

const PIN = "4821";
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  crypto.randomBytes(64),
]);

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function makeWorker(name) {
  const u = await User.create({
    role: "worker",
    full_name: name,
    mobile_number: `9${crypto.randomInt(100000000, 999999999)}`,
    password_hash: await hashPassword("Worker@123"),
    is_phone_verified: true,
  });
  const t = signToken({ _id: u._id, role: "worker", worker_id: u.worker_id });
  return { user: u, token: t };
}

/** Reset the wallet so each test starts from "no PIN". */
async function resetWallet(id) {
  await User.updateOne(
    { _id: id },
    { $set: { wallet_pin_hash: null, wallet_pin_attempts: 0, wallet_pin_locked_until: null } }
  );
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("shramsetu-test"));
  const a = await makeWorker("PIN Worker");
  worker = a.user;
  token = a.token;
  const b = await makeWorker("PIN Other Worker");
  otherWorker = b.user;
  otherToken = b.token;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  clearUserCache();
  await resetWallet(worker._id);
  await resetWallet(otherWorker._id);
});

async function setPin(pin = PIN, currentPin) {
  const body = currentPin === undefined ? { pin } : { pin, current_pin: currentPin };
  return api.post("/api/v1/documents/pin/set").set(auth(token)).send(body);
}

async function unlock(pin = PIN, t = token) {
  return api.post("/api/v1/documents/pin/verify").set(auth(t)).send({ pin });
}

async function upload(t = token) {
  return api.post("/api/v1/documents").set(auth(t)).attach("file", PNG_BYTES, "aadhaar.png");
}

describe("PIN status", () => {
  it("reports that no PIN is set on a fresh account", async () => {
    const res = await api.get("/api/v1/documents/pin/status").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ is_set: false, locked: false, locked_until: null });
    expect(res.body.attempts_remaining).toBe(5);
  });

  it("never exposes the stored digest", async () => {
    await setPin();
    const res = await api.get("/api/v1/documents/pin/status").set(auth(token));
    expect(res.body.is_set).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|pin_hash/);
  });

  it("requires a worker account", async () => {
    const gov = await User.create({
      role: "government",
      full_name: "Official",
      mobile_number: `9${crypto.randomInt(100000000, 999999999)}`,
      employee_id: `EMP${crypto.randomInt(10000, 99999)}`,
      password_hash: await hashPassword("Official@123"),
    });
    const t = signToken({ _id: gov._id, role: "government", employee_id: gov.employee_id });
    const res = await api.get("/api/v1/documents/pin/status").set(auth(t));
    expect(res.status).toBe(403);
  });
});

describe("setting a PIN", () => {
  it("stores an scrypt digest, never the PIN itself", async () => {
    expect((await setPin()).status).toBe(200);
    const stored = await User.findById(worker._id).select("wallet_pin_hash");
    expect(stored.wallet_pin_hash).toMatch(/^scrypt:32768:8:1:/);
    expect(stored.wallet_pin_hash).not.toContain(PIN);
  });

  it("gives two workers different digests for the same PIN (per-user salt)", async () => {
    await setPin();
    await api.post("/api/v1/documents/pin/set").set(auth(otherToken)).send({ pin: PIN });
    const a = await User.findById(worker._id).select("wallet_pin_hash");
    const b = await User.findById(otherWorker._id).select("wallet_pin_hash");
    expect(a.wallet_pin_hash).not.toBe(b.wallet_pin_hash);
  });

  it("rejects a PIN that is not 4-8 digits", async () => {
    for (const pin of ["123", "123456789", "abcd", "12 34", ""]) {
      const res = await setPin(pin);
      expect(res.status).toBe(422);
    }
    expect((await api.get("/api/v1/documents/pin/status").set(auth(token))).body.is_set).toBe(false);
  });

  it("returns a wallet token that unlocks the wallet immediately", async () => {
    const res = await setPin();
    expect(res.body.unlock_token).toBeTruthy();
    expect(res.body.expires_in).toBe(600);
  });

  it("requires the current PIN to change it, and refuses a wrong one", async () => {
    await setPin();
    expect((await setPin("9999")).status).toBe(422); // no current_pin at all
    expect((await setPin("9999", "0000")).status).toBe(401);
    expect((await unlock(PIN)).status).toBe(200); // unchanged
    expect((await setPin("9999", PIN)).status).toBe(200);
    expect((await unlock("9999")).status).toBe(200);
    expect((await unlock(PIN)).status).toBe(401);
  });
});

describe("verifying a PIN", () => {
  it("409s when no PIN has been set", async () => {
    expect((await unlock("4821")).status).toBe(409);
  });

  it("accepts the correct PIN and resets the attempt counter", async () => {
    await setPin();
    await unlock("0000");
    await unlock("0000");
    const before = await User.findById(worker._id).select("wallet_pin_attempts");
    expect(before.wallet_pin_attempts).toBe(2);

    expect((await unlock(PIN)).status).toBe(200);
    const after = await User.findById(worker._id).select("wallet_pin_attempts");
    expect(after.wallet_pin_attempts).toBe(0);
  });

  it("counts down the remaining attempts", async () => {
    await setPin();
    for (const expected of [4, 3, 2, 1]) {
      const res = await unlock("0000");
      expect(res.status).toBe(401);
      expect(res.body.detail).toBe("Incorrect PIN");
      expect(res.body.attempts_remaining).toBe(expected);
    }
  });

  /** Five wrong guesses, then the lock must hold — including against the PIN. */
  it("locks the wallet for five minutes on the fifth wrong guess", async () => {
    await setPin();
    for (let i = 0; i < 4; i++) expect((await unlock("0000")).status).toBe(401);

    const locked = await unlock("0000");
    expect(locked.status).toBe(423);
    expect(locked.body.retry_after).toBeGreaterThan(290);
    expect(locked.headers["retry-after"]).toBeDefined();

    // The lock is the point: a correct guess during lockout must not pass.
    const correctButLocked = await unlock(PIN);
    expect(correctButLocked.status).toBe(423);

    const status = await api.get("/api/v1/documents/pin/status").set(auth(token));
    expect(status.body.locked).toBe(true);
    expect(status.body.attempts_remaining).toBe(0);
  });

  it("accepts the correct PIN again once the lockout window has passed", async () => {
    await setPin();
    await User.updateOne(
      { _id: worker._id },
      { $set: { wallet_pin_locked_until: new Date(Date.now() - 1000) } }
    );
    expect((await unlock(PIN)).status).toBe(200);
    const after = await User.findById(worker._id).select("wallet_pin_locked_until wallet_pin_attempts");
    expect(after.wallet_pin_locked_until).toBeNull();
    expect(after.wallet_pin_attempts).toBe(0);
  });

  it("refuses a PIN set by another worker", async () => {
    await setPin(PIN);
    expect((await unlock(PIN, otherToken)).status).toBe(409); // no PIN on that account
  });
});

describe("downloads require an unlocked wallet", () => {
  it("keeps working when no PIN is set (no migration needed)", async () => {
    const up = await upload();
    expect(up.status).toBe(201);
    const dl = await api.get(`/api/v1/documents/${up.body.id}/download`).set(auth(token));
    expect(dl.status).toBe(200);
  });

  it("refuses a download with no wallet token once a PIN exists", async () => {
    const up = await upload();
    await setPin();
    const dl = await api.get(`/api/v1/documents/${up.body.id}/download`).set(auth(token));
    expect(dl.status).toBe(403);
    expect(dl.body.code).toBe("wallet_locked");
  });

  it("refuses a forged or malformed wallet token", async () => {
    const up = await upload();
    await setPin();
    for (const t of ["garbage", "a.b.c", ""]) {
      const dl = await api
        .get(`/api/v1/documents/${up.body.id}/download`)
        .set(auth(token))
        .set("X-Wallet-Token", t);
      expect(dl.status).toBe(403);
    }
  });

  it("serves the bytes once the PIN has been verified", async () => {
    const up = await upload();
    await setPin();
    const { body } = await unlock(PIN);

    const dl = await api
      .get(`/api/v1/documents/${up.body.id}/download`)
      .set(auth(token))
      .set("X-Wallet-Token", body.unlock_token);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body, PNG_BYTES)).toBe(0);
  });

  it("does not let one worker's wallet token open another worker's wallet", async () => {
    const up = await upload();
    await setPin(); // worker has a PIN
    await api.post("/api/v1/documents/pin/set").set(auth(otherToken)).send({ pin: "1111" });

    // otherWorker's document, worker's valid token.
    const otherUp = await upload(otherToken);
    const { body } = await unlock(PIN);
    const dl = await api
      .get(`/api/v1/documents/${otherUp.body.id}/download`)
      .set(auth(otherToken))
      .set("X-Wallet-Token", body.unlock_token);
    expect(dl.status).toBe(403);

    // And the reverse direction is refused for the same reason.
    const otherUnlock = await unlock("1111", otherToken);
    const dl2 = await api
      .get(`/api/v1/documents/${up.body.id}/download`)
      .set(auth(token))
      .set("X-Wallet-Token", otherUnlock.body.unlock_token);
    expect(dl2.status).toBe(403);
  });

  /** A wallet token is a wallet token — not a session. */
  it("cannot be replayed as a session bearer token", async () => {
    await setPin();
    const { body } = await unlock(PIN);
    const res = await api.get("/api/v1/documents").set(auth(body.unlock_token));
    expect(res.status).toBe(401);
  });

  it("rejects an expired wallet token", async () => {
    const up = await upload();
    await setPin();
    // Sign a token that expired a second ago, with the same derived key the
    // server uses, to prove expiry is enforced rather than assumed.
    const { signWalletToken } = await import("../src/utils/crypto.js");
    const fresh = signWalletToken(worker._id, -1);
    const dl = await api
      .get(`/api/v1/documents/${up.body.id}/download`)
      .set(auth(token))
      .set("X-Wallet-Token", fresh);
    expect(dl.status).toBe(403);
  });
});
