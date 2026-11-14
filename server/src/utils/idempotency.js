/**
 * Client-supplied idempotency keys.
 *
 * A worker on a patchy connection taps "File grievance", the request reaches the
 * API and creates the record, and the reply is lost. The worker taps again — and
 * now the labour office has two complaints for one incident, or two wage rows
 * for one day. The client already knows both attempts are the same intent; the
 * server just had no way to be told.
 *
 * The client generates one key per submission and reuses it for every retry of
 * that submission. The server stores the key with the record; a second request
 * carrying the same key returns the record that already exists instead of
 * creating another. Nothing is guessed from the body: two genuinely separate
 * complaints with identical text still get two records, because their keys
 * differ.
 */
import crypto from "node:crypto";

const MAX_KEY_LENGTH = 64;

/**
 * Read the key from the body (`client_request_id`) or the `Idempotency-Key`
 * header. Anything that is not a sane identifier is ignored — a malformed key
 * must not turn into a shared bucket that deduplicates unrelated submissions.
 */
export function readIdempotencyKey(req) {
  const raw = req.body?.client_request_id ?? req.get?.("idempotency-key");
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  return /^[A-Za-z0-9._:-]+$/.test(key) ? key : null;
}

/** True for a MongoDB unique-index violation. */
export function isDuplicateKeyError(err) {
  return Boolean(err) && (err.code === 11000 || err.code === 11001);
}

/**
 * Answer a replay: the stored record, marked so the client can tell it did not
 * create anything new (and so logs do not read like a silent overwrite).
 */
export function replayResponse(res, record) {
  res.set("Idempotent-Replay", "true");
  return res.status(200).json(record);
}

export function newRequestId() {
  return crypto.randomUUID();
}
