/**
 * `trust proxy` — the rate limiters key off req.ip, so this setting decides
 * whether they protect the API or throttle the whole platform at once.
 *
 * Behind a reverse proxy (Render, nginx) the socket address belongs to the
 * proxy. With `trust proxy` off, every caller shares one bucket and a single
 * noisy client locks out everyone; with it set to one hop, express reads the
 * right-most X-Forwarded-For entry the proxy appended, so each client gets its
 * own bucket and a client cannot pick its own key.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Must be set before app.js (and config.js) are imported.
process.env.TRUST_PROXY = "1";
process.env.RATE_LIMIT_API = "3";
process.env.RATE_LIMIT_WINDOW_MS = "60000";

const { default: app } = await import("../src/app.js");
const { config } = await import("../src/config.js");
const { default: supertest } = await import("supertest");

const api = supertest(app);

// Any unknown /api path still passes the API limiter and then 404s, so the
// counter can be exercised without touching the database.
const probe = (ip) => api.post("/api/v1/__rate_probe").set("X-Forwarded-For", ip).send({});

let server;
beforeAll(() => {
  server = app.listen(0);
});
afterAll(async () => {
  await server.close();
});

describe("with TRUST_PROXY=1", () => {
  it("is configured from the environment, not hard-coded", () => {
    expect(config.trustProxy).toBe(1);
  });

  it("gives each forwarded client its own budget", async () => {
    const a = "203.0.113.7";
    for (let i = 0; i < 3; i += 1) {
      const r = await probe(a);
      expect(r.status).toBe(404); // under the limit
    }
    const blocked = await probe(a);
    expect(blocked.status).toBe(429);

    // A different real client is unaffected by the first one's spending.
    const other = await probe("203.0.113.8");
    expect(other.status).toBe(404);
  });

  it("keys on the address the proxy appended, not one the client supplied", async () => {
    // Same right-most hop (the proxy's client) with a rotated left-hand entry:
    // a client that appends its own X-Forwarded-For must not mint new buckets.
    const r1 = await probe("198.51.100.9");
    expect(r1.status).toBe(404);
    for (let i = 0; i < 2; i += 1) await probe("198.51.100.9");
    expect((await probe("198.51.100.9")).status).toBe(429);
  });
});
