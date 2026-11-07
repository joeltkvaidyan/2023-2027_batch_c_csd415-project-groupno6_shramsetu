/**
 * Document wallet PIN — verified server-side, held in memory here.
 *
 * The PIN itself never touches this file's storage. `POST /documents/pin/verify`
 * checks it against an scrypt digest on the user row, counts the attempt and
 * enforces the lockout there, and returns a 10-minute wallet token. Downloads
 * are refused without that token, so the lock is a real access control rather
 * than a screen that hides a list the API would still hand over.
 *
 * Two client-side timers remain, and both only ever make access shorter:
 *   - 2 minutes of no interaction locks the wallet (`WALLET_IDLE_MS`);
 *   - the token itself expires 10 minutes after verification.
 *
 * Everything that used to live in localStorage (`shramsetu.doc_pin_hash`,
 * attempts, lockout) is deleted on every touch of this module: it was readable
 * and writable by anyone with the device, so it protected nothing.
 */
import { api, apiErrorDetail, httpStatus } from "../api/client";

export const WALLET_IDLE_MS = 2 * 60 * 1000;

const LEGACY_KEYS = [
  "shramsetu.doc_pin_hash",
  "shramsetu.doc_pin_verified",
  "shramsetu.doc_pin_attempts",
  "shramsetu.doc_lockout_until",
];

export interface PinStatus {
  isSet: boolean;
  locked: boolean;
  lockedUntil: number | null;
  attemptsRemaining: number;
}

let unlockToken: string | null = null;
let tokenExpiresAt = 0;
// Needed to derive the offline-cache key, so it lives here and dies with the
// token. It is never written to storage.
let sessionPin: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lockoutUntil = 0;
const lockListeners = new Set<() => void>();

function purgeLegacyStorage() {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode) — nothing to purge */
  }
}

purgeLegacyStorage();

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function notifyLock() {
  for (const listener of lockListeners) {
    try {
      listener();
    } catch {
      /* a listener must not break the lock */
    }
  }
}

/** Lock the wallet: drop the token, the idle timer and any legacy leftovers. */
export function lockWallet(): void {
  unlockToken = null;
  tokenExpiresAt = 0;
  sessionPin = null;
  clearIdleTimer();
  purgeLegacyStorage();
}

function armIdleTimer() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    const wasUnlocked = unlockToken !== null;
    lockWallet();
    if (wasUnlocked) notifyLock();
  }, WALLET_IDLE_MS);
}

/**
 * The PIN the worker just proved, for deriving the offline-cache key. Null
 * whenever the wallet is locked — cached bytes stay unreadable then.
 */
export function getSessionPin(): string | null {
  if (!isWalletUnlocked()) return null;
  return sessionPin;
}

function acceptToken(token: string, expiresInSeconds: number, pin: string) {
  sessionPin = pin;
  unlockToken = token;
  tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  armIdleTimer();
}

/**
 * Report an interaction so the idle lock does not fire mid-read. Call this on
 * pointer/key events; it is a no-op while the wallet is locked.
 */
export function touchWallet(): void {
  if (unlockToken && Date.now() < tokenExpiresAt) armIdleTimer();
}

/** Subscribe to automatic locks (idle or expiry). Returns an unsubscribe fn. */
export function onWalletLock(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

/** The wallet token for an authorised request, or null when locked. */
export function getWalletToken(): string | null {
  if (!unlockToken) return null;
  if (Date.now() >= tokenExpiresAt) {
    const wasUnlocked = true;
    lockWallet();
    if (wasUnlocked) notifyLock();
    return null;
  }
  return unlockToken;
}

/** Is the wallet open right now (token present and not expired)? */
export function isWalletUnlocked(): boolean {
  return getWalletToken() !== null;
}

/** Is a PIN set on this account? */
export async function isPinSet(): Promise<boolean> {
  return (await getPinStatus()).isSet;
}

export async function getPinStatus(): Promise<PinStatus> {
  try {
    const res = await api.get<{
      is_set: boolean;
      locked: boolean;
      locked_until: string | null;
      attempts_remaining: number;
    }>("/documents/pin/status");
    const until = res.data.locked_until ? Date.parse(res.data.locked_until) : null;
    lockoutUntil = res.data.locked && until ? until : 0;
    return {
      isSet: res.data.is_set,
      locked: res.data.locked,
      lockedUntil: until,
      attemptsRemaining: res.data.attempts_remaining,
    };
  } catch {
    // Offline: report "no PIN" rather than inventing one, and keep the wallet
    // closed — the caller decides what to show.
    return { isSet: false, locked: false, lockedUntil: null, attemptsRemaining: 0 };
  }
}

/**
 * Set (or change) the PIN. Changing requires `currentPin`, which the server
 * verifies — a session alone must not be able to re-key the wallet.
 */
export async function setPin(pin: string, currentPin?: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error("PIN must be 4-8 digits");
  }
  try {
    const res = await api.post<{ unlock_token: string; expires_in: number }>(
      "/documents/pin/set",
      currentPin === undefined ? { pin } : { pin, current_pin: currentPin },
    );
    lockoutUntil = 0;
    acceptToken(res.data.unlock_token, res.data.expires_in, pin);
  } catch (err) {
    throw new Error(apiErrorDetail(err) || "Could not save PIN");
  }
}

export async function changePin(currentPin: string, newPin: string): Promise<void> {
  await setPin(newPin, currentPin);
}

/**
 * Verify a PIN. Returns false for a wrong guess; throws for a lockout (the
 * message carries the remaining minutes) so the UI can start its countdown.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  if (lockoutUntil > Date.now()) {
    throw new Error(lockoutMessage(lockoutUntil));
  }
  try {
    const res = await api.post<{ unlock_token: string; expires_in: number }>(
      "/documents/pin/verify",
      { pin },
    );
    lockoutUntil = 0;
    acceptToken(res.data.unlock_token, res.data.expires_in, pin);
    return true;
  } catch (err) {
    const status = httpStatus(err);
    if (status === 423) {
      const retryAfter = Number(
        (err as { response?: { data?: { retry_after?: number } } }).response?.data?.retry_after,
      );
      lockoutUntil =
        Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 300) * 1000;
      throw new Error(lockoutMessage(lockoutUntil));
    }
    if (status === 401) return false;
    if (status === 409) throw new Error("No PIN is set");
    throw new Error(apiErrorDetail(err) || "Could not verify PIN");
  }
}

function lockoutMessage(until: number): string {
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return `Too many failed attempts. Locked out for ${minutes} minutes.`;
}

/** Seconds left in a server-side lockout, or 0. */
export function getLockoutRemaining(): number {
  if (lockoutUntil <= 0) return 0;
  return Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
}
