/**
 * `isNetworkFailure` decides whether a failed submission is kept for later.
 *
 * The distinction is the whole point: a request that never got an answer (no
 * signal) is worth queueing, while a request the server answered with 4xx is a
 * verdict on the content and must be shown to the worker now — queueing it would
 * just fail again on replay and hide the real problem until much later.
 */
import { AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import { httpStatus, isNetworkFailure } from "./client";

function withResponse(status: number) {
  return new AxiosError(
    "refused",
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

describe("isNetworkFailure", () => {
  it("is true for a request that never reached the server", () => {
    expect(isNetworkFailure(new AxiosError("Network Error", "ERR_NETWORK"))).toBe(true);
    expect(isNetworkFailure(new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED"))).toBe(
      true,
    );
  });

  it("is false once the server answered, whatever the status", () => {
    for (const status of [400, 401, 409, 422, 500, 503]) {
      const err = withResponse(status);
      expect(isNetworkFailure(err), `status ${status}`).toBe(false);
      expect(httpStatus(err)).toBe(status);
    }
  });

  it("is false for something that is not a request error at all", () => {
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});
