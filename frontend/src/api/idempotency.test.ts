/**
 * The replay property, tested at the unit that a page actually uses: a retry
 * after a lost reply must carry the SAME key, and a fresh submission after a
 * success must carry a new one. Both directions matter — reusing a key too long
 * would make a worker's second, genuine complaint silently resolve to the first.
 */
import { describe, expect, it, vi } from "vitest";
import { newSubmissionKey, submitOnce } from "./idempotency";

describe("newSubmissionKey", () => {
  it("looks like a UUID and differs every time", () => {
    const first = newSubmissionKey();
    const second = newSubmissionKey();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(second);
  });
});

describe("submitOnce", () => {
  it("sends a key with the payload", async () => {
    const send = vi.fn().mockResolvedValue({ id: "g1" });
    const holder = { current: null as string | null };

    await submitOnce(holder, { subject: "unpaid" }, send);

    const body = send.mock.calls[0][0];
    expect(body.subject).toBe("unpaid");
    expect(typeof body.client_request_id).toBe("string");
    expect(body.client_request_id).toBeTruthy();
  });

  it("reuses the key after a failure, so the retry cannot duplicate the record", async () => {
    const holder = { current: null as string | null };
    const failing = vi.fn().mockRejectedValue(new Error("network"));

    await expect(submitOnce(holder, { subject: "unpaid" }, failing)).rejects.toThrow("network");
    expect(holder.current).toBeTruthy();

    const retry = vi.fn().mockResolvedValue({ id: "g1" });
    await submitOnce(holder, { subject: "unpaid" }, retry);

    expect(retry.mock.calls[0][0].client_request_id).toBe(
      failing.mock.calls[0][0].client_request_id,
    );
  });

  it("keeps the key across several failed attempts", async () => {
    const holder = { current: null as string | null };
    const send = vi.fn().mockRejectedValue(new Error("offline"));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(submitOnce(holder, {}, send)).rejects.toThrow();
    }

    const keys = new Set(send.mock.calls.map((call) => call[0].client_request_id));
    expect(keys.size).toBe(1);
  });

  it("uses a fresh key for the next submission after a success", async () => {
    const holder = { current: null as string | null };
    const send = vi.fn().mockResolvedValue({ id: "g1" });

    await submitOnce(holder, { subject: "first" }, send);
    await submitOnce(holder, { subject: "second" }, send);

    expect(holder.current).toBeNull();
    expect(send.mock.calls[1][0].client_request_id).not.toBe(
      send.mock.calls[0][0].client_request_id,
    );
  });

  it("does not overwrite a payload field the caller already set deliberately", async () => {
    // The key is ours to set; everything else in the body is the caller's.
    const holder = { current: null as string | null };
    const send = vi.fn().mockResolvedValue({ id: "w1" });

    await submitOnce(holder, { work_date: "2026-03-02", paid_amount: 500 }, send);

    expect(send.mock.calls[0][0]).toMatchObject({ work_date: "2026-03-02", paid_amount: 500 });
  });
});
