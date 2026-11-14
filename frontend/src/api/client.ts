import axios from "axios";
import i18n from "../i18n";
import { API_BASE_URL, attachSession } from "./session";

/**
 * Every request carries the cookie session, never a token.
 *
 * The three instances below exist because different screens were built at
 * different times; they are now the same session with the same interceptors
 * from `./session`, which also owns CSRF and the silent refresh. Nothing here
 * reads or writes a token, so there is no longer anywhere in this app for a JWT
 * to be stolen from.
 */
export { API_BASE_URL };

export const api = attachSession(
  axios.create({
    // Absolute on Render static sites (VITE_API_BASE_URL is baked at build
    // time, e.g. https://shramsetu-api.onrender.com/api/v1); relative behind
    // the docker-compose nginx proxy where /api is same-origin.
    baseURL: API_BASE_URL,
  }),
);

/** Signed-in employer screens. Same cookie session. */
export const employerApi = attachSession(axios.create({ baseURL: API_BASE_URL }));

/** Citizen (general public / household) screens. Same cookie session. */
export const citizenApi = attachSession(axios.create({ baseURL: API_BASE_URL }));

/**
 * Normalize an error into a display-safe string.
 *
 * Handles FastAPI/Pydantic 422 array-shaped `detail` (rendering that raw
 * would white-screen React), maps 429 to a friendly localised message via
 * the i18n `errors.rateLimited` key, and network failures to
 * `errors.network`. Every error handler should go through this.
 */
/** HTTP status of a rejected request, or undefined for network failures. */
export function httpStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

/**
 * True when the request never got an answer — the phone had no signal, or the
 * connection dropped. This is the only failure that is worth queueing offline:
 * a 4xx is the server's verdict on the content, and retrying it later would
 * fail the same way.
 */
export function isNetworkFailure(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response;
}

/** `code` field the server puts on a refused request (e.g. gov_approval_pending). */
export function apiErrorCode(err: unknown): string | undefined {
  const data: unknown = axios.isAxiosError(err) ? err.response?.data : undefined;
  if (data && typeof data === "object" && "code" in data) {
    const code = (data as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Server-supplied human message, when the error carries one. */
export function apiErrorDetail(err: unknown): string | undefined {
  const data: unknown = axios.isAxiosError(err) ? err.response?.data : undefined;
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return undefined;
}

/** Pydantic/FastAPI 422 detail entries are `{loc: string[], msg: string}`. */
interface ValidationIssue {
  loc?: unknown;
  msg?: unknown;
}

export function apiErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const status = httpStatus(err);
  if (status === 429) {
    // Imported lazily to avoid a circular import with the i18n module.
    const translated = safeT("errors.rateLimited");
    if (translated) return translated;
  }
  const networkFailure = axios.isAxiosError(err) && !err.response && err.code === "ERR_NETWORK";
  if (networkFailure) {
    const translated = safeT("errors.network");
    if (translated) return translated;
  }
  const data: unknown = axios.isAxiosError(err) ? err.response?.data : undefined;
  const detail =
    data && typeof data === "object" && "detail" in data
      ? (data as { detail?: unknown }).detail
      : undefined;
  if (Array.isArray(detail)) {
    return (
      (detail as ValidationIssue[])
        .map((issue) => {
          const where = Array.isArray(issue.loc)
            ? issue.loc.filter((part) => part !== "body").join(".")
            : "";
          const message = typeof issue.msg === "string" ? issue.msg : "Invalid input";
          return where ? `${where}: ${message}` : message;
        })
        .join("; ") || fallback
    );
  }
  if (typeof detail === "string" && detail) return detail;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** i18n lookup that survives i18n not being initialised yet (returns null). */
function safeT(key: string): string | null {
  try {
    const translated = i18n.t(key);
    return typeof translated === "string" && translated && translated !== key ? translated : null;
  } catch {
    return null;
  }
}

// A 401 is handled in two places on purpose: `./session` refreshes an expired
// access cookie and retries once, and AuthContext drops the signed-in worker
// when the refresh itself fails. Nothing here deletes a token, because the page
// no longer holds one.
