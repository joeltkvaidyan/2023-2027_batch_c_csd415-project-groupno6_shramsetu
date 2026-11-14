/**
 * Cookie sessions: CSRF echo, silent refresh, and the end of token storage.
 *
 * These tests drive a real axios instance through `attachSession` with a stub
 * adapter, so the interceptors run exactly as they do in the app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

import {
  attachSession,
  declareSession,
  forgetSession,
  onSessionExpired,
  resolveSession,
} from "./session";

interface Seen {
  method: string;
  url: string;
  csrf: string | undefined;
  credentials: unknown;
}

let seen: Seen[] = [];

function response(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  return {
    data,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {},
    config,
    request: {},
  };
}

/**
 * Adapter that answers from `handler`; a non-2xx answer is rejected as an axios
 * error the way a real adapter reports it.
 */
function adapter(
  handler: (config: InternalAxiosRequestConfig) => { status: number; data: unknown },
) {
  return async (config: InternalAxiosRequestConfig) => {
    const headers = AxiosHeaders.from(config.headers);
    seen.push({
      method: (config.method || "get").toUpperCase(),
      url: config.url || "",
      csrf: headers.get("X-CSRF-Token") as string | undefined,
      credentials: config.withCredentials,
    });
    const { status, data } = handler(config);
    if (status >= 200 && status < 300) return response(config, status, data);
    throw new AxiosError(
      "request failed",
      String(status),
      config,
      {},
      response(config, status, data),
    );
  };
}

function client(
  handler: (config: InternalAxiosRequestConfig) => { status: number; data: unknown },
) {
  return attachSession(axios.create({ baseURL: "/api/v1", adapter: adapter(handler) }));
}

beforeEach(() => {
  seen = [];
  localStorage.clear();
  // The role probe is cached per page; each test starts from a cold page.
  forgetSession();
  document.cookie = "st_csrf=csrf-value";
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("credentials and CSRF", () => {
  it("sends cookies on reads and leaves the CSRF header off", async () => {
    const api = client(() => ({ status: 200, data: { ok: true } }));
    await api.get("/auth/worker/me");

    expect(seen[0].credentials).toBe(true);
    expect(seen[0].csrf).toBeUndefined();
  });

  it("echoes the CSRF cookie on unsafe methods", async () => {
    const api = client(() => ({ status: 200, data: { ok: true } }));

    await api.post("/documents/pin/set", { pin: "4821" });
    await api.delete("/documents/1");

    expect(seen[0].csrf).toBe("csrf-value");
    expect(seen[1].csrf).toBe("csrf-value");
  });

  it("omits the header when there is no CSRF cookie (server answers 403, page retries later)", async () => {
    document.cookie = "st_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    const api = client(() => ({ status: 200, data: {} }));
    await api.post("/documents/pin/set", { pin: "4821" });
    expect(seen[0].csrf).toBeUndefined();
  });
});

describe("silent refresh", () => {
  it("refreshes once on an expired access token and retries the request", async () => {
    const post = vi
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { ok: true, role: "worker" } } as never);

    let calls = 0;
    const api = client(() => {
      calls += 1;
      if (calls === 1) return { status: 401, data: { code: "token_expired" } };
      return { status: 200, data: { full_name: "Sita" } };
    });

    const res = await api.get("/auth/worker/me");

    expect(res.data.full_name).toBe("Sita");
    expect(post).toHaveBeenCalledTimes(1);
    expect(String(post.mock.calls[0][0])).toContain("/auth/refresh");
    // The retried request carries cookies too.
    expect(seen).toHaveLength(2);
    expect(seen[1].credentials).toBe(true);
  });

  it("shares one refresh between concurrent expiries — rotation is single use", async () => {
    // The refresh resolves asynchronously, so both callers are already waiting
    // when it completes — they must be waiting on the same promise.
    let refreshed = false;
    const post = vi.spyOn(axios, "post").mockImplementation((async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      refreshed = true;
      return { data: { ok: true } };
    }) as never);

    const api = client(() =>
      refreshed
        ? { status: 200, data: { ok: true } }
        : { status: 401, data: { code: "token_expired" } },
    );

    const results = await Promise.all([api.get("/one"), api.get("/two")]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a request that simply had no session", async () => {
    const post = vi.spyOn(axios, "post");
    const api = client(() => ({ status: 401, data: { code: "no_token" } }));

    await expect(api.get("/auth/worker/me")).rejects.toBeInstanceOf(AxiosError);
    expect(post).not.toHaveBeenCalled();
  });

  it("notifies the app and does not retry when the refresh itself fails", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(new Error("refresh failed"));
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);

    const api = client(() => ({ status: 401, data: { code: "token_expired" } }));

    await expect(api.get("/auth/worker/me")).rejects.toBeInstanceOf(AxiosError);
    expect(expired).toHaveBeenCalledTimes(1);
    // One attempt only: a 401 after refresh must not loop.
    expect(seen).toHaveLength(1);
    unsubscribe();
  });
});

describe("no tokens in storage", () => {
  it("deletes the four legacy token keys when a session starts", () => {
    localStorage.setItem("shramsetu.token", "worker-jwt");
    localStorage.setItem("gov_token", "gov-jwt");
    localStorage.setItem("employer_token", "employer-jwt");
    localStorage.setItem("citizen_token", "citizen-jwt");

    declareSession("worker");

    expect(localStorage.getItem("shramsetu.token")).toBeNull();
    expect(localStorage.getItem("gov_token")).toBeNull();
    expect(localStorage.getItem("employer_token")).toBeNull();
    expect(localStorage.getItem("citizen_token")).toBeNull();
  });
});

/**
 * The role probe behind RoleRoute. It is the only source of the answer "which
 * role is this session?", so it must ask once, recover from an expired access
 * cookie exactly once, and never confuse "nobody is signed in" with "the server
 * could not be reached" — the first is a redirect, the second is a retry.
 */
describe("resolveSession", () => {
  it("asks once per page and shares the answer with every guard", async () => {
    const get = vi.spyOn(axios, "get").mockResolvedValue({ data: { role: "employer" } } as never);

    const [first, second] = await Promise.all([resolveSession(), resolveSession()]);
    const third = await resolveSession();

    expect(first?.role).toBe("employer");
    expect(second?.role).toBe("employer");
    expect(third?.role).toBe("employer");
    expect(get).toHaveBeenCalledTimes(1);
    expect(String(get.mock.calls[0][0])).toContain("/auth/session");
  });

  it("carries the worker profile, so booting a dashboard is not a second call", async () => {
    vi.spyOn(axios, "get").mockResolvedValue({
      data: { role: "worker", worker: { worker_id: "W-9", full_name: "Sita" } },
    } as never);

    const session = await resolveSession();
    expect(session?.role).toBe("worker");
    expect(session?.worker?.worker_id).toBe("W-9");
  });

  it("refreshes once for an expired access cookie, then answers", async () => {
    const expired = new AxiosError(
      "expired",
      "401",
      undefined,
      {},
      {
        status: 401,
        data: { code: "token_expired" },
        statusText: "Unauthorized",
        headers: {},
        config: {} as never,
      },
    );
    const get = vi
      .spyOn(axios, "get")
      .mockRejectedValueOnce(expired)
      .mockResolvedValueOnce({ data: { role: "government" } } as never);
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { ok: true } } as never);

    const session = await resolveSession();
    expect(session?.role).toBe("government");
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reports no session for an anonymous visitor without trying to refresh", async () => {
    const anon = new AxiosError(
      "anon",
      "401",
      undefined,
      {},
      {
        status: 401,
        data: { code: "no_token" },
        statusText: "Unauthorized",
        headers: {},
        config: {} as never,
      },
    );
    vi.spyOn(axios, "get").mockRejectedValue(anon);
    const post = vi.spyOn(axios, "post");

    expect(await resolveSession()).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("throws rather than reporting 'signed out' when the server is unreachable", async () => {
    // A guard that redirected here would log a signed-in user out on a flaky
    // train connection. The caller must be able to offer retry instead.
    const get = vi
      .spyOn(axios, "get")
      .mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));

    await expect(resolveSession()).rejects.toBeInstanceOf(AxiosError);
    // Not cached: the next call tries again.
    vi.mocked(get).mockResolvedValue({ data: { role: "citizen" } } as never);
    expect((await resolveSession())?.role).toBe("citizen");
  });
});
