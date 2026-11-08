/**
 * Browser sessions: an httpOnly access cookie, a rotating refresh cookie and a
 * double-submit CSRF token.
 *
 * The SPA used to keep a 12-hour JWT in localStorage, so any XSS (or anyone with
 * the device) held a bearer token for half a day and no server-side list of live
 * sessions existed to revoke. Here:
 *
 *   st_access   15-minute JWT, httpOnly, never readable by JavaScript
 *   st_refresh  30-day opaque token, httpOnly, rotated on every use, stored
 *               only as sha256, revocable, and scoped to /api/v1/auth
 *   st_csrf     readable random value; every unsafe request must echo it in
 *               X-CSRF-Token (double submit), which a cross-site form cannot do
 *
 * Bearer tokens keep working for API clients and the test suite — they are not
 * exposed to a browser page, and a bearer request cannot be forged cross-site,
 * so CSRF only applies to cookie-authenticated requests.
 */
import crypto from "node:crypto";
import { config } from "../config.js";
import { Session } from "../models/Session.js";
import { signToken, sha256 } from "./crypto.js";

export const ACCESS_COOKIE = "st_access";
export const REFRESH_COOKIE = "st_refresh";
export const CSRF_COOKIE = "st_csrf";
export const CSRF_HEADER = "x-csrf-token";

// The refresh token is only ever needed by the two auth endpoints, so its path
// keeps it off every other request.
const REFRESH_PATH = "/api/v1/auth";
const ACCESS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // the JWT itself expires sooner
const REFRESH_MAX_AGE_MS = config.refreshTtlDays * 24 * 60 * 60 * 1000;

/** Parse one cookie out of a Cookie header (no cookie-parser dependency). */
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function baseCookie(maxAge) {
  const options = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    maxAge,
  };
  if (config.cookieDomain) options.domain = config.cookieDomain;
  return options;
}

function setCookies(res, { accessToken, refreshToken, csrfToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie(ACCESS_MAX_AGE_MS), path: "/" });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookie(REFRESH_MAX_AGE_MS),
    path: REFRESH_PATH,
  });
  // Readable by design: the SPA has to send it back in a header.
  res.cookie(CSRF_COOKIE, csrfToken, { ...baseCookie(REFRESH_MAX_AGE_MS), httpOnly: false, path: "/" });
}

export function clearSessionCookies(res) {
  for (const [name, path] of [
    [ACCESS_COOKIE, "/"],
    [REFRESH_COOKIE, REFRESH_PATH],
    [CSRF_COOKIE, "/"],
  ]) {
    res.clearCookie(name, { ...baseCookie(0), path });
  }
}

const newRefreshToken = () => crypto.randomBytes(32).toString("base64url");
const hashRefreshToken = (token) => sha256(token);
const newCsrfToken = () => crypto.randomBytes(24).toString("base64url");

/**
 * Start a session for a fresh sign-in and set its cookies. Returns the access
 * token so callers can also answer non-browser clients.
 */
export async function startSession(req, res, user) {
  const refreshToken = newRefreshToken();
  const familyId = crypto.randomUUID();
  const accessToken = signToken(user);
  const csrfToken = newCsrfToken();

  await Session.create({
    user_id: user._id,
    role: user.role,
    token_hash: hashRefreshToken(refreshToken),
    family_id: familyId,
    expires_at: new Date(Date.now() + REFRESH_MAX_AGE_MS),
    ip: req.ip ?? null,
    user_agent: (req.headers["user-agent"] || "").slice(0, 200) || null,
  });

  setCookies(res, { accessToken, refreshToken, csrfToken });
  return accessToken;
}

/** Revoke every live session in a chain — used on reuse detection and logout-all. */
export async function revokeFamily(familyId, reason = "reuse_detected") {
  await Session.updateMany(
    { family_id: familyId, revoked_at: null },
    { $set: { revoked_at: new Date(), revoked_reason: reason } }
  );
}

/**
 * Exchange a refresh token for a new pair. The old token is marked revoked and
 * replaced atomically ($set on the still-revoked-null filter), so two clients
 * racing with the same token cannot both win: the loser sees a revoked record
 * and the chain is dropped.
 */
export async function rotateSession(req, res, token) {
  if (!token) return { ok: false, reason: "missing" };
  const tokenHash = hashRefreshToken(token);
  const session = await Session.findOne({ token_hash: tokenHash });

  if (!session) return { ok: false, reason: "unknown" };
  if (session.revoked_at) {
    await revokeFamily(session.family_id, "reuse_detected");
    return { ok: false, reason: "reused" };
  }
  if (session.expires_at.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const nextToken = newRefreshToken();
  const claimed = await Session.findOneAndUpdate(
    { _id: session._id, revoked_at: null },
    { $set: { revoked_at: new Date(), revoked_reason: "rotated", replaced_by: hashRefreshToken(nextToken) } },
    { new: false }
  );
  if (!claimed) {
    // Someone rotated this session between our read and our write.
    await revokeFamily(session.family_id, "reuse_detected");
    return { ok: false, reason: "reused" };
  }

  const user = { _id: session.user_id, role: session.role };
  const accessToken = signToken(user);
  setCookies(res, { accessToken, refreshToken: nextToken, csrfToken: newCsrfToken() });

  await Session.create({
    user_id: session.user_id,
    role: session.role,
    token_hash: hashRefreshToken(nextToken),
    family_id: session.family_id,
    expires_at: new Date(Date.now() + REFRESH_MAX_AGE_MS),
    ip: req.ip ?? null,
    user_agent: (req.headers["user-agent"] || "").slice(0, 200) || null,
  });

  return { ok: true, userId: session.user_id, role: session.role, accessToken };
}

/** Revoke the session a logout presented, without treating it as reuse. */
export async function revokeSession(token) {
  if (!token) return;
  await Session.updateOne(
    { token_hash: hashRefreshToken(token) },
    { $set: { revoked_at: new Date(), revoked_reason: "logout" } }
  );
}

/**
 * Double-submit check for cookie-authenticated unsafe requests. Constant-time
 * compare so a mismatched token cannot be discovered byte by byte.
 */
export function csrfValid(req) {
  const cookie = readCookie(req.headers.cookie, CSRF_COOKIE);
  const header = req.headers[CSRF_HEADER];
  if (!cookie || typeof header !== "string" || header.length !== cookie.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
}

/** Unsafe verbs need the CSRF token; reads do not. */
export const isUnsafeMethod = (method) => !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase());
