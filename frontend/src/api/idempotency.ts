/**
 * One submission, one key.
 *
 * A worker on a patchy connection taps "File grievance"; the request reaches the
 * API and the reply is lost. They tap again. Without a key that is two
 * complaints for one incident — and for a wage day, the retry hits the paid-day
 * lock and the worker is told their entry is frozen when they only tried again.
 *
 * The rule is simple and lives here so no page can get it wrong:
 *
 *   - a key is created the first time a submission is attempted;
 *   - every retry of that same submission reuses it;
 *   - only a successful reply clears it, so the next submission is a new intent
 *     with a new key.
 *
 * The server honours the key (see server/src/utils/idempotency.js): a second
 * request carrying it returns the record that already exists.
 */

/** Anything with a mutable `current`; a `useRef` satisfies this. */
export interface KeyHolder {
  current: string | null;
}

export function newSubmissionKey(): string {
  // randomUUID is unavailable on older Android WebViews, which is exactly the
  // device this app targets, so fall back to raw randomness with the same shape.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Send `payload` with a stable idempotency key, reusing the key on retry.
 * Throws whatever `send` throws, leaving the key in place for the retry.
 */
export async function submitOnce<T>(
  holder: KeyHolder,
  payload: Record<string, unknown>,
  send: (body: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  if (!holder.current) holder.current = newSubmissionKey();
  const result = await send({ ...payload, client_request_id: holder.current });
  holder.current = null;
  return result;
}
