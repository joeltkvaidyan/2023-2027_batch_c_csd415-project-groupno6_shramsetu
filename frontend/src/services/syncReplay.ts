/**
 * Replaying writes that were queued while the phone had no signal.
 *
 * The queue existed but its processor only logged and deleted — replaying a
 * write is what the idempotency keys (api/idempotency.ts) made safe, so this is
 * the second half of that change: send the item, and only remove it once the
 * server has answered.
 *
 * The hard part is not sending. It is deciding what to do with each answer, and
 * every choice here is about not losing a worker's complaint:
 *
 *   - success            → remove. Done.
 *   - 401 / 403          → stop the whole run. The session is gone; hammering
 *                          the rest would only fail the same way, and the queue
 *                          must survive for after the next sign-in.
 *   - 4xx except 408/429 → remove. The server refused this write on its merits
 *                          (bad field, unknown category). Keeping it would
 *                          retry forever and never succeed; the outcome reports
 *                          it as dropped so it is visible, not silent.
 *   - 408 / 429 / 5xx /  → keep, and stop. Transient by definition: retrying
 *     network error        the rest would likely fail the same way and we would
 *                          rather retry once than stampede.
 *
 * A queued create without its key is never sent: sending it would risk exactly
 * the duplicate the key exists to prevent, so it stays queued and is reported.
 */
import { httpStatus } from "../api/client";
import type { PendingSyncItem } from "./offlineStorage";

export type ReplayMethod = "POST" | "PATCH" | "DELETE";

export interface ReplayTarget {
  method: ReplayMethod;
  url: string;
}

export type ReplaySend = (target: ReplayTarget, body: Record<string, unknown>) => Promise<unknown>;

export interface ReplayOutcome {
  /** Items the server accepted (or replayed) — removed from the queue. */
  sent: string[];
  /** Items the server refused permanently, or that cannot be replayed at all. */
  dropped: string[];
  /** Items still queued for the next attempt. */
  kept: string[];
  /** True when the run stopped because the session ended. */
  signedOut: boolean;
}

/** Only the two endpoints that accept an idempotency key can be replayed. */
export function targetFor(item: PendingSyncItem): ReplayTarget | null {
  if (item.action !== "create") return null;
  if (item.type === "grievance") return { method: "POST", url: "/grievances" };
  if (item.type === "wage") return { method: "POST", url: "/wages" };
  return null;
}

function isPermanentRefusal(status: number | undefined): boolean {
  if (status === undefined) return false; // network: not the server's verdict
  if (status === 408 || status === 429) return false; // explicitly retryable
  return status >= 400 && status < 500 && status !== 401 && status !== 403;
}

export async function replayQueue(
  items: PendingSyncItem[],
  send: ReplaySend,
): Promise<ReplayOutcome> {
  const outcome: ReplayOutcome = { sent: [], dropped: [], kept: [], signedOut: false };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const target = targetFor(item);

    if (!target) {
      // chat/document/update items have no endpoint that can take them; they were
      // never replayable, so they are reported rather than retried forever.
      outcome.dropped.push(item.id);
      continue;
    }
    if (!item.data.client_request_id) {
      // Without its key a retry could duplicate the record. Leave it and say so.
      outcome.kept.push(item.id);
      continue;
    }

    try {
      await send(target, item.data);
      outcome.sent.push(item.id);
    } catch (err) {
      const status = httpStatus(err);
      if (status === 401 || status === 403) {
        outcome.signedOut = true;
        outcome.kept.push(...items.slice(index).map((rest) => rest.id));
        return outcome;
      }
      if (isPermanentRefusal(status)) {
        outcome.dropped.push(item.id);
        continue;
      }
      outcome.kept.push(...items.slice(index).map((rest) => rest.id));
      return outcome;
    }
  }

  return outcome;
}
