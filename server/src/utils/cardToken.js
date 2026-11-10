import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Public verification token for a worker ID card.
 *
 * Why this exists: worker codes are sequential (`SS-000123`), so a verify URL
 * of the form /verify/SS-000123 would let anyone walk the whole registry and
 * read every accepted worker's name and district one request at a time. The
 * token is a keyed digest of the worker code, which is:
 *   - unguessable without JWT_SECRET_KEY (the server's existing secret), and
 *   - stateless: no column to add, migrate or backfill, so an existing
 *     registration can be printed onto a card immediately.
 *
 * The QR/card therefore encodes `<worker_id>.<token>`. Verification recomputes
 * the digest and compares it in constant time before touching the database.
 *
 * Rotation: changing JWT_SECRET_KEY invalidates every printed card (they would
 * stop verifying) and every session — the two are already coupled, and rotating
 * the secret is already an incident response step.
 */
const PREFIX = "shramsetu:id-card:v1:";

/** 16 base64url chars ≈ 96 bits — short enough for a QR, far past guessing. */
export function cardToken(workerId) {
  const digest = crypto
    .createHmac("sha256", config.jwtSecret || "")
    .update(`${PREFIX}${String(workerId).trim().toUpperCase()}`)
    .digest("base64url");
  return digest.slice(0, 16);
}

/** Constant-time compare; length differences fail without leaking timing. */
export function tokenMatches(workerId, presented) {
  const expected = Buffer.from(cardToken(workerId), "utf8");
  const given = Buffer.from(String(presented || ""), "utf8");
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

/** `<worker_id>.<token>` — what the QR image encodes and the URL carries. */
export function cardCode(workerId) {
  return `${workerId}.${cardToken(workerId)}`;
}

export const WORKER_ID_RE = /^SS-\d{6}$/;

/**
 * Split a presented code into its parts, or null when it is malformed.
 * Splits on the LAST dot so a future id format containing dots still works.
 */
export function parseCardCode(raw) {
  const code = String(raw || "").trim();
  const at = code.lastIndexOf(".");
  if (at <= 0 || at === code.length - 1) return null;
  const workerId = code.slice(0, at).toUpperCase();
  const token = code.slice(at + 1);
  if (!WORKER_ID_RE.test(workerId)) return null;
  return { workerId, token };
}
