/**
 * The other half of the trust-proxy story: when nothing is in front of the API
 * (development, or TRUST_PROXY=0), X-Forwarded-For must be IGNORED. Otherwise
 * any client could send a random header value per request and never be
 * rate-limited — the header is client-controlled input until a proxy you
 * operate appends it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// No TRUST_PROXY here: the test environment is not production, so the default
// is "trust nothing".
process.env.RATE_LIMIT_API = "3";
process.env.RATE_LIMIT_WINDOW_MS = "60000";

const { default: app } = await import("../src/app.js");
const { config } = await import("../src/config.js");
const { default: supertest } = await import("supertest");

const api = supertest(app);
const probe = (ip) => api.post("/api/v1/__rate_probe").set("X-Forwarded-For", ip).send({});

let server;
beforeAll(() => {
  server = app.listen(0);
});
afterAll(async () => {
  await server.close();
});

describe("without trust proxy", () => {
  it("is off by default outside production", () => {
    expect(config.trustProxy).toBe(false);
  });

  it("does not let a forged X-Forwarded-For mint fresh buckets", async () => {
    // Three different spoofed addresses, one socket: the fourth request is
    // over the limit because the limiter counted the real connection.
    expect((await probe("203.0.113.1")).status).toBe(404);
    expect((await probe("203.0.113.2")).status).toBe(404);
    expect((await probe("203.0.113.3")).status).toBe(404);
    expect((await probe("203.0.113.4")).status).toBe(429);
  });
});
