/**
 * Safe-by-default configuration.
 *
 * ENV used to default to "development", so a deployment that forgot the
 * variable silently ran with terminal OTP echo, seeded demo accounts and weak
 * bootstrap credentials. Now anything other than an explicit ENV=development is
 * checked as production at boot.
 */
import { describe, it, expect, vi } from "vitest";

process.env.ENV = "production";
process.env.SEED_DEMO_DATA = "false";
process.env.OTP_ECHO_ENABLED = "false";
// Empty strings (not `delete`): dotenv only skips variables that are already
// present, so a deleted name would be re-read from server/.env.
process.env.OTP_PEPPER = "";
process.env.AI_INTERNAL_KEY = "";
delete process.env.TRUST_PROXY;

const { config, assertProductionSafe } = await import("../src/config.js");

describe("production guard", () => {
  it("treats production as the default and trusts exactly one proxy hop", () => {
    expect(config.env).toBe("production");
    expect(config.trustProxy).toBe(1);
  });

  it("refuses to boot without the OTP pepper and the AI shared secret", () => {
    let message = "";
    try {
      assertProductionSafe();
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain("Refusing to boot in production");
    expect(message).toContain("OTP_PEPPER");
    expect(message).toContain("AI_INTERNAL_KEY");
  });

  it("does not report demo conveniences that were explicitly disabled", () => {
    let message = "";
    try {
      assertProductionSafe();
    } catch (err) {
      message = err.message;
    }
    expect(message).not.toContain("OTP_ECHO_ENABLED");
    expect(message).not.toContain("SEED_DEMO_DATA");
  });
});

describe("development stays available on purpose", () => {
  it("skips the production guard only for an explicit ENV=development", async () => {
    vi.resetModules();
    process.env.ENV = "development";
    const fresh = await import("../src/config.js");
    expect(fresh.config.env).toBe("development");
    expect(() => fresh.assertProductionSafe()).not.toThrow();
  });
});
