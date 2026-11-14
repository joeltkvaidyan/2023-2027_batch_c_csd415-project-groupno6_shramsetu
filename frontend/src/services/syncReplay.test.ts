/**
 * Replay decisions are about not losing a worker's complaint — and not filing it
 * twice. Each test pins one answer:
 *
 *   success            → removed from the queue
 *   permanent 4xx      → removed, because retrying can never succeed
 *   network / 5xx      → kept for the next reconnect
 *   401 / 403          → stop, keep everything (the session is gone)
 *   create with no key → never sent (a duplicate is worse than a delay)
 */
import { AxiosError } from "axios";
import { describe, expect, it, vi } from "vitest";
import { replayQueue, targetFor } from "./syncReplay";
import type { PendingSyncItem } from "./offlineStorage";

function item(over: Partial<PendingSyncItem> = {}): PendingSyncItem {
  return {
    id: "grievance-create-1",
    type: "grievance",
    action: "create",
    data: { client_request_id: "key-1", subject: "unpaid wages" },
    timestamp: 1,
    ...over,
  };
}

function httpError(status: number) {
  return new AxiosError(
    "nope",
    String(status),
    undefined,
    {},
    {
      status,
      statusText: "error",
      headers: {},
      config: {} as never,
      data: { detail: "refused" },
    },
  );
}

describe("targetFor", () => {
  it("maps the two replayable creates and refuses the rest", () => {
    expect(targetFor(item())).toEqual({ method: "POST", url: "/grievances" });
    expect(targetFor(item({ type: "wage", id: "w" }))).toEqual({ method: "POST", url: "/wages" });
    expect(targetFor(item({ action: "update" }))).toBeNull();
    expect(targetFor(item({ type: "chat" }))).toBeNull();
    expect(targetFor(item({ type: "document" }))).toBeNull();
  });
});

describe("replayQueue", () => {
  it("sends the queued body unchanged and reports it sent", async () => {
    const send = vi.fn().mockResolvedValue({ id: "g1" });
    const outcome = await replayQueue([item()], send);

    expect(send).toHaveBeenCalledWith({ method: "POST", url: "/grievances" }, item().data);
    expect(outcome.sent).toEqual(["grievance-create-1"]);
    expect(outcome.kept).toEqual([]);
  });

  it("keeps everything and stops when the session has ended", async () => {
    const send = vi.fn().mockRejectedValue(httpError(401));
    const items = [item(), item({ id: "grievance-create-2" })];

    const outcome = await replayQueue(items, send);

    expect(outcome.signedOut).toBe(true);
    expect(outcome.sent).toEqual([]);
    expect(outcome.kept).toEqual(["grievance-create-1", "grievance-create-2"]);
    // Stopped after the first: the remaining items were never attempted.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("drops a write the server refused on its merits instead of retrying forever", async () => {
    const send = vi.fn().mockRejectedValue(httpError(422));
    const outcome = await replayQueue([item()], send);

    expect(outcome.dropped).toEqual(["grievance-create-1"]);
    expect(outcome.kept).toEqual([]);
  });

  it("keeps a write that failed for a reason that may not recur", async () => {
    for (const status of [500, 503, 429, 408]) {
      const send = vi.fn().mockRejectedValue(httpError(status));
      const outcome = await replayQueue([item()], send);
      expect(outcome.kept, `status ${status}`).toEqual(["grievance-create-1"]);
      expect(outcome.dropped, `status ${status}`).toEqual([]);
    }
  });

  it("keeps a write when the phone is still offline", async () => {
    const send = vi.fn().mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    const outcome = await replayQueue([item()], send);
    expect(outcome.kept).toEqual(["grievance-create-1"]);
    expect(outcome.signedOut).toBe(false);
  });

  it("continues past a refused item so one bad write does not block the rest", async () => {
    const send = vi.fn().mockRejectedValueOnce(httpError(422)).mockResolvedValueOnce({ id: "w1" });
    const items = [
      item(),
      item({ id: "wage-create-2", type: "wage", data: { client_request_id: "k2" } }),
    ];

    const outcome = await replayQueue(items, send);

    expect(outcome.dropped).toEqual(["grievance-create-1"]);
    expect(outcome.sent).toEqual(["wage-create-2"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("never sends a create that lost its key, and says it is still queued", async () => {
    const send = vi.fn();
    const outcome = await replayQueue([item({ data: { subject: "unpaid" } })], send);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.kept).toEqual(["grievance-create-1"]);
  });

  it("reports a queued item that has no replayable endpoint", async () => {
    const send = vi.fn();
    const outcome = await replayQueue([item({ id: "chat-create-1", type: "chat" })], send);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.dropped).toEqual(["chat-create-1"]);
  });

  it("is a no-op for an empty queue", async () => {
    const send = vi.fn();
    const outcome = await replayQueue([], send);
    expect(outcome).toEqual({ sent: [], dropped: [], kept: [], signedOut: false });
  });
});
