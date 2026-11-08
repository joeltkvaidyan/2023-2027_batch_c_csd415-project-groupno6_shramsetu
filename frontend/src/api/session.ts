/**
 * The SPA's only session module.
 *
 * Before this, four separate token stores (worker, employer, citizen,
 * government) each kept a 12-hour JWT in localStorage. Any XSS read all four,
 * and sign-out was a localStorage delete that left the token valid everywhere
 * it had been copied.
 *
 * Now the browser holds no token at all: the server sets httpOnly cookies, so
 * JavaScript cannot read the access token, and the refresh token rotates and is
 * revocable server-side. What this module does:
 *
 *   - attaches credentials to every request of every instance it is given;
 *   - echoes the readable CSRF cookie in `X-CSRF-Token` for unsafe methods,
 *     which a cross-site request cannot forge;
 *   - turns a 401 `token_expired` into one shared refresh attempt and one retry;
 *   - tells the app when a session is truly over, so the UI leaves the dashboard.
 *
 * Legacy localStorage tokens are deleted on load and whenever a session starts,
 * so an upgrade cannot leave an old 12-hour token behind.
 */
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

export type SessionRole = "worker" | "employer" | "citizen" | "government";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

const CSRF_COOKIE = "st_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const UNSAFE = /^(POST|PUT|PATCH|DELETE)$/i;

const LEGACY_KEYS = ["shramsetu.token", "gov_token", "employer_token", "citizen_token"];

let role: SessionRole | null = null;
let refreshing: Promise<boolean> | null = null;
const expiryListeners = new Set<() => void>();

function purgeLegacyTokens() {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    /* storage blocked — nothing to purge */
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

purgeLegacyTokens();

/** The signed-in role, once a login response has come back in this tab. */
export function currentRole(): SessionRole | null {
  return role;
}

/**
 * Record that a login just succeeded. There is no token to pass around: the
 * cookies are already set by the response.
 */
export function declareSession(next: SessionRole): void {
  purgeLegacyTokens();
  role = next;
}

/** Forget the in-memory session marker (the server call is `signOut`). */
export function forgetSession(): void {
  role = null;
}

export function onSessionExpired(listener: () => void): () => void {
  expiryListeners.add(listener);
  return () => expiryListeners.delete(listener);
}

function notifyExpired() {
  role = null;
  purgeLegacyTokens();
  for (const listener of expiryListeners) {
    try {
      listener();
    } catch {
      /* a listener must not break sign-out */
    }
  }
}

/**
 * Trade the refresh cookie for a new pair. Concurrent callers share one request:
 * rotation is single-use, so two parallel refreshes would revoke each other's
 * chain and sign the user out for being busy.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const csrf = readCookie(CSRF_COOKIE);
    try {
      const { data } = await axios.post<{ role?: SessionRole }>(
        `${API_BASE_URL}/auth/refresh`,
        null,
        { withCredentials: true, headers: csrf ? { [CSRF_HEADER]: csrf } : {} },
      );
      // A reload forgets the in-memory role; the refresh response restores it.
      if (data && typeof data.role === "string") role = data.role;
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Revoke the session on the server and drop the marker here. */
export async function signOut(): Promise<void> {
  const csrf = readCookie(CSRF_COOKIE);
  try {
    await axios.post(`${API_BASE_URL}/auth/logout`, null, {
      withCredentials: true,
      headers: csrf ? { [CSRF_HEADER]: csrf } : {},
    });
  } catch {
    /* offline sign-out still clears the client */
  } finally {
    forgetSession();
  }
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  __retried?: boolean;
}

function isExpiredAuthError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response?.status !== 401) return false;
  const data = error.response.data as { code?: unknown } | undefined;
  const code = data && typeof data === "object" ? data.code : undefined;
  // `no_token` means there was never a session; only an expired one is worth a
  // refresh, otherwise every signed-out page load would POST /auth/refresh.
  return code === "token_expired";
}

/** Wire one axios instance into the cookie session. Idempotent per instance. */
export function attachSession(instance: AxiosInstance): AxiosInstance {
  instance.defaults.withCredentials = true;

  instance.interceptors.request.use((config) => {
    config.withCredentials = true;
    const method = config.method || "get";
    if (UNSAFE.test(method)) {
      const csrf = readCookie(CSRF_COOKIE);
      if (csrf) config.headers.set(CSRF_HEADER, csrf);
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      const config = axios.isAxiosError(error)
        ? (error.config as RetriableConfig | undefined)
        : undefined;
      if (!config || config.__retried || !isExpiredAuthError(error)) throw error;

      const ok = await refreshSession();
      if (!ok) {
        notifyExpired();
        throw error;
      }
      config.__retried = true;
      return instance.request(config);
    },
  );

  return instance;
}
