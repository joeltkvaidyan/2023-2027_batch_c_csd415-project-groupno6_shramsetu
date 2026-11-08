import { verifyToken } from "../utils/crypto.js";
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  csrfValid,
  isUnsafeMethod,
  readCookie,
} from "../utils/session.js";
import { User } from "../models/User.js";
import { AuditLog } from "../models/Document.js";

/**
 * Short in-memory cache of user liveness (exists + is_active) so the
 * per-request DB re-check costs at most one query per user per TTL window.
 * Disabled users therefore lose access within ~30s even with a valid JWT.
 */
const USER_TTL_MS = 30_000;
const userCache = new Map(); // userId -> { ok: boolean, at: number }

async function userIsLive(userId) {
  if (!userId) return false;
  const hit = userCache.get(userId);
  const now = Date.now();
  if (hit && now - hit.at < USER_TTL_MS) return hit.ok;
  const user = await User.findById(userId).select("_id is_active").lean();
  const ok = Boolean(user && user.is_active);
  userCache.set(userId, { ok, at: now });
  if (userCache.size > 5000) {
    // rudimentary size bound: drop expired entries
    for (const [k, v] of userCache) {
      if (now - v.at > USER_TTL_MS) userCache.delete(k);
    }
  }
  return ok;
}

/** Test hook: clear the liveness cache (e.g. after deactivating a user). */
export function clearUserCache() {
  userCache.clear();
}

/**
 * Authenticate from either an Authorization bearer token (API clients, tests,
 * scripts) or the httpOnly access cookie (the browser).
 *
 * A cookie-authenticated unsafe request must also carry the double-submit CSRF
 * header: cookies are attached by the browser automatically, so without this a
 * page on another origin could drive the API with the worker's session. Bearer
 * requests need no such check — a cross-site form cannot set that header.
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  const cookieToken = bearer ? null : readCookie(req.headers.cookie, ACCESS_COOKIE);
  const payload = verifyToken(bearer || cookieToken || "");
  if (!payload) {
    if (cookieToken) clearSessionCookies(res);
    return res
      .status(401)
      .json({ detail: "Not authenticated", code: cookieToken ? "token_expired" : "no_token" });
  }
  if (cookieToken && isUnsafeMethod(req.method) && !csrfValid(req)) {
    return res.status(403).json({ detail: "CSRF token missing or invalid", code: "csrf_failed" });
  }
  try {
    if (!(await userIsLive(payload.sub))) {
      if (cookieToken) clearSessionCookies(res);
      return res.status(401).json({ detail: "Account disabled or removed." });
    }
  } catch (err) {
    console.error("[auth] liveness check failed:", err.message);
    return res.status(503).json({ detail: "Auth service unavailable." });
  }
  req.userId = payload.sub;
  req.userRole = payload.role;
  req.user = { id: payload.sub, role: payload.role };
  next();
}

export function requireWorker(req, res, next) {
  if (req.userRole !== "worker") {
    return res.status(403).json({ detail: "Worker access required" });
  }
  next();
}

export function requireGovernment(req, res, next) {
  if (req.userRole !== "government") {
    return res.status(403).json({ detail: "Government access required" });
  }
  next();
}

export function requireEmployer(req, res, next) {
  if (req.userRole !== "employer") {
    return res.status(403).json({ detail: "Employer access required" });
  }
  next();
}

export function requireCitizen(req, res, next) {
  if (req.userRole !== "citizen") {
    return res.status(403).json({ detail: "Citizen access required" });
  }
  next();
}

/**
 * Employer actions that earn public visibility (posting job listings,
 * rating workers) require the employer account to have been ACCEPTED by a
 * labour office — the same gate workers face before they can apply or be
 * listed. Fresh from the DB, not from the JWT (approval state changes).
 */
export async function requireGovAcceptedEmployer(req, res, next) {
  if (req.userRole !== "employer") {
    return res.status(403).json({ detail: "Employer access required" });
  }
  try {
    const employer = await User.findById(req.userId).select("gov_approve_status is_active").lean();
    if (!employer || !employer.is_active) {
      return res.status(401).json({ detail: "Account disabled or removed." });
    }
    if ((employer.gov_approve_status ?? "accepted") !== "accepted") {
      return res.status(403).json({
        detail:
          "Your employer registration is pending government acceptance. Once a labour office accepts your account, you can post jobs publicly and rate workers.",
        code: "gov_approval_pending",
      });
    }
    next();
  } catch (err) {
    console.error("[auth/acceptedEmployer]", err.message);
    return res.status(503).json({ detail: "Auth service unavailable." });
  }
}

/** Best-effort audit logging — never blocks the request. */
export async function audit({ actorRole, actorIdentifier, action, resourceType, resourceId = null, ip = null, success = true, failureReason = null }) {
  try {
    await AuditLog.create({
      actor_role: actorRole,
      actor_identifier: actorIdentifier,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      ip_address: ip,
      success,
      failure_reason: failureReason,
    });
  } catch (err) {
    console.warn("[audit] log write failed:", err.message);
  }
}
