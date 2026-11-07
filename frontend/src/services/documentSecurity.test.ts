/**
 * Document wallet PIN — client half.
 *
 * The security boundary now lives on the server (scrypt digest, attempt counter,
 * lockout, 10-minute wallet token), so these tests assert what the browser is
 * still responsible for: it must never write a PIN or a "verified" flag to
 * storage, it must stop reporting "unlocked" when the token expires or after two
 * idle minutes, and it must surface a server lockout instead of retrying.
 *
 * The old suite tested a localStorage PBKDF2 hash. That code is gone on purpose:
 * a lock whose secret and attempt counter sit in localStorage is advisory only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("../api/client", () => ({
  api: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args) },
  httpStatus: (err: unknown) => (err as { status?: number }).status,
  apiErrorDetail: (err: unknown) => (err as { detail?: string }).detail,
}));

type ServerError = Error & {
  status?: number;
  detail?: string;
  response?: { data?: { retry_after?: number } };
};

function serverError(status: number, detail: string, retryAfter?: number): ServerError {
  return Object.assign(new Error(detail), {
    status,
    detail,
    response: retryAfter === undefined ? undefined : { data: { retry_after: retryAfter } },
  });
}

async function loadModule() {
  vi.resetModules();
  return import("./documentSecurity");
}

beforeEach(() => {
  localStorage.clear();
  get.mockReset();
  post.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("storage", () => {
  it("deletes the legacy localStorage PIN on load", async () => {
    localStorage.setItem("shramsetu.doc_pin_hash", "pbkdf2:v1:150000:abc:def");
    localStorage.setItem("shramsetu.doc_pin_verified", "true");
    localStorage.setItem("shramsetu.doc_pin_attempts", "3");
    localStorage.setItem("shramsetu.doc_lockout_until", "9999999999999");

    await loadModule();

    expect(localStorage.getItem("shramsetu.doc_pin_hash")).toBeNull();
    expect(localStorage.getItem("shramsetu.doc_pin_verified")).toBeNull();
    expect(localStorage.getItem("shramsetu.doc_pin_attempts")).toBeNull();
    expect(localStorage.getItem("shramsetu.doc_lockout_until")).toBeNull();
  });

  it("never writes anything to storage when a PIN is set or verified", async () => {
    const mod = await loadModule();
    post.mockResolvedValue({ data: { unlock_token: "tok", expires_in: 600 } });

    await mod.setPin("4821");
    await mod.verifyPin("4821");

    expect(localStorage.length).toBe(0);
  });
});

describe("setPin", () => {
  it("refuses a PIN that is not 4-8 digits without calling the API", async () => {
    const mod = await loadModule();
    await expect(mod.setPin("123")).rejects.toThrow("PIN must be 4-8 digits");
    await expect(mod.setPin("123456789")).rejects.toThrow("PIN must be 4-8 digits");
    await expect(mod.setPin("abcd")).rejects.toThrow("PIN must be 4-8 digits");
    expect(post).not.toHaveBeenCalled();
  });

  it("posts the PIN and unlocks with the returned token", async () => {
    const mod = await loadModule();
    post.mockResolvedValue({ data: { unlock_token: "tok-1", expires_in: 600 } });

    await mod.setPin("4821");

    expect(post).toHaveBeenCalledWith("/documents/pin/set", { pin: "4821" });
    expect(mod.isWalletUnlocked()).toBe(true);
    expect(mod.getWalletToken()).toBe("tok-1");
  });

  it("sends the current PIN when changing", async () => {
    const mod = await loadModule();
    post.mockResolvedValue({ data: { unlock_token: "tok-2", expires_in: 600 } });

    await mod.changePin("4821", "7391");

    expect(post).toHaveBeenCalledWith("/documents/pin/set", {
      pin: "7391",
      current_pin: "4821",
    });
  });

  it("surfaces the server's rejection reason", async () => {
    const mod = await loadModule();
    post.mockRejectedValue(serverError(401, "Current PIN is incorrect"));
    await expect(mod.changePin("0000", "7391")).rejects.toThrow("Current PIN is incorrect");
  });
});

describe("verifyPin", () => {
  it("returns true and unlocks on the correct PIN", async () => {
    const mod = await loadModule();
    post.mockResolvedValue({ data: { unlock_token: "tok", expires_in: 600 } });

    await expect(mod.verifyPin("4821")).resolves.toBe(true);
    expect(mod.isWalletUnlocked()).toBe(true);
  });

  it("returns false (not throws) for a wrong PIN, leaving the wallet locked", async () => {
    const mod = await loadModule();
    post.mockRejectedValue(serverError(401, "Incorrect PIN", undefined));

    await expect(mod.verifyPin("0000")).resolves.toBe(false);
    expect(mod.isWalletUnlocked()).toBe(false);
  });

  it("throws a lockout message and counts down when the server says 423", async () => {
    const mod = await loadModule();
    post.mockRejectedValue(serverError(423, "Locked out", 300));

    await expect(mod.verifyPin("0000")).rejects.toThrow(
      "Too many failed attempts. Locked out for 5 minutes.",
    );
    expect(mod.getLockoutRemaining()).toBe(300);
    expect(mod.isWalletUnlocked()).toBe(false);
  });

  it("refuses to even call the API while a lockout is running, even with the right PIN", async () => {
    const mod = await loadModule();
    post.mockRejectedValueOnce(serverError(423, "Locked out", 300));
    await expect(mod.verifyPin("0000")).rejects.toThrow(/Locked out/);

    post.mockClear();
    await expect(mod.verifyPin("4821")).rejects.toThrow(/Locked out/);
    expect(post).not.toHaveBeenCalled();
  });

  it("reports no PIN set as a distinct error", async () => {
    const mod = await loadModule();
    post.mockRejectedValue(serverError(409, "No PIN is set."));
    await expect(mod.verifyPin("4821")).rejects.toThrow("No PIN is set");
  });
});

describe("PIN status", () => {
  it("reports whether a PIN exists on the account", async () => {
    const mod = await loadModule();
    get.mockResolvedValue({
      data: { is_set: true, locked: false, locked_until: null, attempts_remaining: 5 },
    });
    await expect(mod.isPinSet()).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith("/documents/pin/status");
  });

  it("treats an unreachable server as 'no PIN' and keeps the wallet closed", async () => {
    const mod = await loadModule();
    get.mockRejectedValue(serverError(500, "boom"));
    await expect(mod.isPinSet()).resolves.toBe(false);
    expect(mod.isWalletUnlocked()).toBe(false);
  });

  it("carries a server lockout into the countdown", async () => {
    const mod = await loadModule();
    const until = new Date(Date.now() + 120_000).toISOString();
    get.mockResolvedValue({
      data: { is_set: true, locked: true, locked_until: until, attempts_remaining: 0 },
    });
    await mod.getPinStatus();
    expect(mod.getLockoutRemaining()).toBe(120);
  });
});

describe("the wallet closes on its own", () => {
  async function unlocked() {
    const mod = await loadModule();
    post.mockResolvedValue({ data: { unlock_token: "tok", expires_in: 600 } });
    await mod.verifyPin("4821");
    expect(mod.isWalletUnlocked()).toBe(true);
    return mod;
  }

  it("locks after two idle minutes and notifies listeners", async () => {
    const mod = await unlocked();
    const onLock = vi.fn();
    mod.onWalletLock(onLock);

    vi.advanceTimersByTime(mod.WALLET_IDLE_MS - 1000);
    expect(mod.isWalletUnlocked()).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(mod.isWalletUnlocked()).toBe(false);
    expect(onLock).toHaveBeenCalledOnce();
    expect(mod.getWalletToken()).toBeNull();
  });

  it("keeps the wallet open while the worker is interacting", async () => {
    const mod = await unlocked();

    // Three idle-length stretches, each interrupted by a touch.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(mod.WALLET_IDLE_MS - 1000);
      mod.touchWallet();
    }
    vi.advanceTimersByTime(mod.WALLET_IDLE_MS - 1000);
    expect(mod.isWalletUnlocked()).toBe(true);
  });

  it("closes when the 10-minute token expires, even while active", async () => {
    const mod = await unlocked();
    const onLock = vi.fn();
    mod.onWalletLock(onLock);

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(60_000);
      mod.touchWallet();
    }

    expect(mod.isWalletUnlocked()).toBe(false);
    expect(mod.getWalletToken()).toBeNull();
    expect(onLock).toHaveBeenCalled();
  });

  it("lockWallet drops the token immediately and stops notifying", async () => {
    const mod = await unlocked();
    const onLock = vi.fn();
    const unsubscribe = mod.onWalletLock(onLock);

    mod.lockWallet();
    unsubscribe();
    vi.advanceTimersByTime(mod.WALLET_IDLE_MS + 1000);

    expect(mod.isWalletUnlocked()).toBe(false);
    expect(onLock).not.toHaveBeenCalled(); // manual lock is not an idle lock
  });
});
