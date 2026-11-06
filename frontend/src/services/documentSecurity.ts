/**
 * Document wallet PIN — a CONVENIENCE UI LOCK, not encryption.
 *
 * What this is: a screen lock so a phone handed to someone else can't
 * casually open the document wallet. It gates UI access only.
 * What this is NOT: encryption. The real protection for stored documents is
 * server-side AES-256-GCM with wrapped keys (see docs/SECURITY.md); anyone
 * with the worker's API token can fetch documents through the API
 * regardless of this PIN.
 *
 * Hashing: PBKDF2-SHA256, 150,000 iterations, per-user random salt, via
 * Web Crypto. Stored format:
 *     "pbkdf2:v1:<iterations>:<saltBase64>:<hashBase64>"
 * Fallback for plain-HTTP LAN testing (crypto.subtle is unavailable there):
 * the earlier toy hash, stored as "legacy:<hex>" — still just a UI lock.
 * A PIN set in one mode verifies only in that mode.
 */

const PIN_STORAGE_KEY = "shramsetu.doc_pin_hash";
const PIN_VERIFIED_KEY = "shramsetu.doc_pin_verified";
const PIN_ATTEMPTS_KEY = "shramsetu.doc_pin_attempts";
const LOCKOUT_KEY = "shramsetu.doc_lockout_until";
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const PBKDF2_ITERATIONS = 150_000;

function subtleAvailable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** Legacy toy hash kept ONLY for plain-HTTP fallback (not cryptographic). */
function legacyHash(message: string): string {
  const salted = message + "shramsetu_salt_v2";
  const data = new TextEncoder().encode(salted);
  let hash = 0;
  let hash2 = 0x12345678;
  let hash3 = 0x9abcdef0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    hash = ((hash << 5) - hash + byte) | 0;
    hash2 = ((hash2 << 7) + hash2 + byte * 31) | 0;
    hash3 = ((hash3 << 11) ^ (hash3 + byte * 17)) | 0;
  }
  let h4 = 0;
  for (let i = 0; i < data.length; i++) {
    h4 = ((h4 << 3) ^ h4 ^ data[i]) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(hash) + hex(hash2) + hex(hash3) + hex(h4);
}

async function pbkdf2Hash(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    keyMaterial,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** Hash a PIN for storage, choosing the strongest available scheme. */
async function hashPin(pin: string, salt?: Uint8Array): Promise<string> {
  if (subtleAvailable()) {
    const useSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2Hash(pin, useSalt, PBKDF2_ITERATIONS);
    return `pbkdf2:v1:${PBKDF2_ITERATIONS}:${toBase64(useSalt)}:${hash}`;
  }
  return `legacy:${legacyHash(pin)}`;
}

async function verifyHash(pin: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2:")) {
    const [, , iterStr, saltB64, hashB64] = stored.split(":");
    if (!subtleAvailable()) return false; // PIN was set with PBKDF2; can't verify here
    const derived = await pbkdf2Hash(pin, fromBase64(saltB64), parseInt(iterStr, 10));
    return derived === hashB64;
  }
  if (stored.startsWith("legacy:")) {
    return `legacy:${legacyHash(pin)}` === stored;
  }
  // Pre-migration plain hash (no prefix) — treat as legacy toy hash.
  return legacyHash(pin) === stored;
}

/**
 * Check if a PIN is set for the document wallet.
 */
export async function isPinSet(): Promise<boolean> {
  const hash = localStorage.getItem(PIN_STORAGE_KEY);
  return hash !== null && hash.length > 0;
}

/**
 * Set a new PIN for the document wallet.
 */
export async function setPin(pin: string): Promise<void> {
  if (pin.length < 4 || pin.length > 8) {
    throw new Error("PIN must be 4-8 digits");
  }
  localStorage.setItem(PIN_STORAGE_KEY, await hashPin(pin));
  localStorage.removeItem(PIN_ATTEMPTS_KEY);
  localStorage.removeItem(LOCKOUT_KEY);
}

/**
 * Verify a PIN against the stored hash.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  // Check lockout
  const lockoutUntil = localStorage.getItem(LOCKOUT_KEY);
  if (lockoutUntil) {
    const until = parseInt(lockoutUntil, 10);
    if (Date.now() < until) {
      throw new Error(
        `Locked out. Try again in ${Math.ceil((until - Date.now()) / 60000)} minutes.`,
      );
    }
    // Lockout expired
    localStorage.removeItem(LOCKOUT_KEY);
    localStorage.removeItem(PIN_ATTEMPTS_KEY);
  }

  const stored = localStorage.getItem(PIN_STORAGE_KEY);
  if (!stored) return false;

  const isValid = await verifyHash(pin, stored);

  if (isValid) {
    localStorage.setItem(PIN_VERIFIED_KEY, "true");
    localStorage.removeItem(PIN_ATTEMPTS_KEY);
    return true;
  }

  // Track attempts
  const attempts = parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) || "0", 10) + 1;
  localStorage.setItem(PIN_ATTEMPTS_KEY, attempts.toString());

  if (attempts >= MAX_ATTEMPTS) {
    localStorage.setItem(LOCKOUT_KEY, (Date.now() + LOCKOUT_DURATION_MS).toString());
    throw new Error("Too many failed attempts. Locked out for 5 minutes.");
  }

  return false;
}

/**
 * Check if the document wallet is currently verified (session-based).
 */
export function isWalletUnlocked(): boolean {
  return localStorage.getItem(PIN_VERIFIED_KEY) === "true";
}

/**
 * Lock the document wallet (clear session verification).
 */
export function lockWallet(): void {
  localStorage.removeItem(PIN_VERIFIED_KEY);
}

/**
 * Change the PIN.
 */
export async function changePin(oldPin: string, newPin: string): Promise<void> {
  const isValid = await verifyPin(oldPin);
  if (!isValid) {
    throw new Error("Current PIN is incorrect");
  }
  await setPin(newPin);
}

/**
 * Get remaining lockout time in seconds, or 0 if not locked out.
 */
export function getLockoutRemaining(): number {
  const lockoutUntil = localStorage.getItem(LOCKOUT_KEY);
  if (!lockoutUntil) return 0;
  const until = parseInt(lockoutUntil, 10);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
