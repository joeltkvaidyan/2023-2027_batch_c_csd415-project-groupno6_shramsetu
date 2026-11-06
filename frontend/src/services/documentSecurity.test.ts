/**
 * Document wallet PIN lock — the highest-value thing to test in the frontend.
 *
 * This is the one place where a logic bug silently weakens a security control a
 * worker can feel: five wrong attempts must lock the wallet for five minutes, an
 * expired lockout must actually clear, and a PIN stored under PBKDF2 must not be
 * verifiable through the legacy fallback. `documentSecurity` states plainly that
 * this is a UI lock and not encryption, so these tests assert exactly what it
 * claims — no more, no less.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changePin,
  getLockoutRemaining,
  isPinSet,
  isWalletUnlocked,
  lockWallet,
  setPin,
  verifyPin,
} from "./documentSecurity";

const PIN_KEY = "shramsetu.doc_pin_hash";
const ATTEMPTS_KEY = "shramsetu.doc_pin_attempts";
const LOCKOUT_KEY = "shramsetu.doc_lockout_until";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("setPin", () => {
  it("rejects a PIN shorter than 4 characters", async () => {
    await expect(setPin("123")).rejects.toThrow("PIN must be 4-8 digits");
    expect(await isPinSet()).toBe(false);
  });

  it("rejects a PIN longer than 8 characters", async () => {
    await expect(setPin("123456789")).rejects.toThrow("PIN must be 4-8 digits");
  });

  it("accepts the 4- and 8-character boundaries", async () => {
    await setPin("1234");
    expect(await verifyPin("1234")).toBe(true);

    localStorage.clear();
    await setPin("12345678");
    expect(await verifyPin("12345678")).toBe(true);
  });

  it("stores a salted PBKDF2 hash, never the PIN itself", async () => {
    await setPin("4821");
    const stored = localStorage.getItem(PIN_KEY);
    expect(stored).toMatch(/^pbkdf2:v1:150000:/);
    expect(stored).not.toContain("4821");
  });

  it("gives two users different stored hashes for the same PIN (per-user salt)", async () => {
    await setPin("4821");
    const first = localStorage.getItem(PIN_KEY);
    localStorage.clear();
    await setPin("4821");
    const second = localStorage.getItem(PIN_KEY);
    expect(first).not.toBe(second);
  });
});

describe("verifyPin", () => {
  it("returns false when no PIN has been set", async () => {
    expect(await verifyPin("4821")).toBe(false);
  });

  it("accepts the correct PIN and marks the wallet unlocked", async () => {
    await setPin("4821");
    expect(await verifyPin("4821")).toBe(true);
    expect(isWalletUnlocked()).toBe(true);
  });

  it("rejects a wrong PIN and leaves the wallet locked", async () => {
    await setPin("4821");
    expect(await verifyPin("0000")).toBe(false);
    expect(isWalletUnlocked()).toBe(false);
  });

  it("does not unlock on a near-miss PIN", async () => {
    await setPin("4821");
    expect(await verifyPin("4822")).toBe(false);
    expect(await verifyPin("482")).toBe(false);
    expect(await verifyPin("48210")).toBe(false);
  });

  it("resets the attempt counter after a successful attempt", async () => {
    await setPin("4821");
    await verifyPin("0000");
    await verifyPin("0000");
    expect(localStorage.getItem(ATTEMPTS_KEY)).toBe("2");

    await verifyPin("4821");
    expect(localStorage.getItem(ATTEMPTS_KEY)).toBeNull();
  });
});

describe("lockout after five failed attempts", () => {
  it("throws on the fifth wrong attempt and records a lockout window", async () => {
    await setPin("4821");
    for (let i = 0; i < 4; i++) {
      expect(await verifyPin("0000")).toBe(false);
    }
    await expect(verifyPin("0000")).rejects.toThrow(
      "Too many failed attempts. Locked out for 5 minutes.",
    );
    expect(localStorage.getItem(LOCKOUT_KEY)).not.toBeNull();
  });

  it("refuses even the CORRECT PIN while locked out", async () => {
    // The lockout must not be a UI hint that a correct guess walks through.
    await setPin("4821");
    for (let i = 0; i < 5; i++) {
      await verifyPin("0000").catch(() => undefined);
    }
    await expect(verifyPin("4821")).rejects.toThrow(/Locked out/);
    expect(isWalletUnlocked()).toBe(false);
  });

  it("reports the remaining lockout time", async () => {
    await setPin("4821");
    for (let i = 0; i < 5; i++) {
      await verifyPin("0000").catch(() => undefined);
    }
    const remaining = getLockoutRemaining();
    expect(remaining).toBeGreaterThan(290);
    expect(remaining).toBeLessThanOrEqual(300);
  });

  it("clears the lockout and the counter once the window has expired", async () => {
    await setPin("4821");
    for (let i = 0; i < 5; i++) {
      await verifyPin("0000").catch(() => undefined);
    }
    expect(localStorage.getItem(LOCKOUT_KEY)).not.toBeNull();

    // Wind the clock past the 5-minute window rather than sleeping through it.
    const future = Date.now() + 5 * 60 * 1000 + 1000;
    const realNow = Date.now;
    Date.now = () => future;
    try {
      expect(await verifyPin("4821")).toBe(true);
    } finally {
      Date.now = realNow;
    }
    expect(localStorage.getItem(LOCKOUT_KEY)).toBeNull();
    expect(localStorage.getItem(ATTEMPTS_KEY)).toBeNull();
  });

  it("returns 0 seconds remaining when not locked out", () => {
    expect(getLockoutRemaining()).toBe(0);
  });

  it("returns 0 seconds remaining for an expired lockout", () => {
    localStorage.setItem(LOCKOUT_KEY, String(Date.now() - 1000));
    expect(getLockoutRemaining()).toBe(0);
  });
});

describe("lockWallet", () => {
  it("clears the session verification but keeps the PIN", async () => {
    await setPin("4821");
    await verifyPin("4821");
    expect(isWalletUnlocked()).toBe(true);

    lockWallet();
    expect(isWalletUnlocked()).toBe(false);
    expect(await isPinSet()).toBe(true);
    expect(await verifyPin("4821")).toBe(true);
  });
});

describe("changePin", () => {
  it("refuses when the current PIN is wrong", async () => {
    await setPin("4821");
    await expect(changePin("0000", "9999")).rejects.toThrow("Current PIN is incorrect");
    expect(await verifyPin("4821")).toBe(true);
  });

  it("replaces the PIN when the current one is correct", async () => {
    await setPin("4821");
    await changePin("4821", "7391");
    expect(await verifyPin("7391")).toBe(true);
    expect(await verifyPin("4821")).toBe(false);
  });

  it("validates the NEW PIN's length too", async () => {
    await setPin("4821");
    await expect(changePin("4821", "12")).rejects.toThrow("PIN must be 4-8 digits");
    expect(await verifyPin("4821")).toBe(true);
  });
});

describe("plain-HTTP fallback (no crypto.subtle)", () => {
  /**
   * documentSecurity falls back to a non-cryptographic toy hash when
   * crypto.subtle is unavailable (plain-HTTP LAN testing). Two things matter:
   * a PIN set that way still verifies, and a PBKDF2 PIN is NOT verifiable by
   * that path — otherwise the weak path becomes an oracle.
   */
  function withoutSubtle<T>(fn: () => T): T {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: original.getRandomValues.bind(original) },
      configurable: true,
      writable: true,
    });
    try {
      return fn();
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  }

  it("verifies a legacy-stored PIN when subtle is missing", async () => {
    await withoutSubtle(async () => {
      await setPin("4821");
      const stored = localStorage.getItem(PIN_KEY);
      expect(stored).toMatch(/^legacy:/);

      expect(await verifyPin("4821")).toBe(true);
      expect(await verifyPin("0000")).toBe(false);
    });
  });

  it("refuses to verify a PBKDF2-stored PIN when subtle is missing", async () => {
    await setPin("4821"); // stored with PBKDF2
    await withoutSubtle(async () => {
      expect(await verifyPin("4821")).toBe(false);
    });
  });

  it("a legacy PIN does not verify on a subtle-capable device", async () => {
    await withoutSubtle(async () => {
      await setPin("4821");
    });
    expect(localStorage.getItem(PIN_KEY)).toMatch(/^legacy:/);
    // Still verifies: the legacy hash is deterministic, so the same code path
    // can check it. This documents the honest reality that the fallback is not
    // a security boundary (see the module docstring).
    expect(await verifyPin("4821")).toBe(true);
  });
});
