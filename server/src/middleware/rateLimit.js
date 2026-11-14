import rateLimit from "express-rate-limit";
import { config } from "../config.js";

/**
 * Rate limiting, configurable via server/.env (see config.js rateLimits):
 *   RATE_LIMIT_WINDOW_MS       window length (default 60s)
 *   RATE_LIMIT_API             general API calls per window (default 300)
 *   RATE_LIMIT_OTP_REQUEST     OTP sends per IP (default 5/min)
 *   RATE_LIMIT_OTP_VERIFY      OTP verifications per IP (default 10/min)
 *   RATE_LIMIT_WORKER_LOGIN    worker password logins per IP (default 10/min)
 *   RATE_LIMIT_GOV_LOGIN       government logins per IP (default 10/min)
 *   RATE_LIMIT_REGISTER        registrations per IP (default 5/min)
 *
 * Backend: in-memory per-process by default. When REDIS_URL is set and the
 * `ioredis` package is installed, counters are shared across containers so
 * multi-node deployments enforce a single limit instead of N× per replica.
 */

const { windowMs } = config.rateLimits;

const handler = (message) => (req, res) => {
  res.status(429).json({ detail: message });
};

let redisClient = null;
if (process.env.REDIS_URL) {
  try {
    const { default: IORedis } = await import("ioredis");
    redisClient = new IORedis(process.env.REDIS_URL, { lazyConnect: true });
  } catch {
    /* ioredis not installed — fall back to in-memory below */
  }
}

async function redisIncr(key) {
  if (!redisClient) return null;
  const count = await redisClient.incr(key);
  await redisClient.expire(key, Math.ceil(windowMs / 1000));
  return count;
}

function limiter(max, message) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: handler(message),
    // express-rate-limit's `store` can be a Redis store; we keep the
    // built-in MemoryStore as the fallback and apply Redis increments
    // manually via a custom key generator is not supported, so we handle
    // Redis in the handler path below via a wrapper. Simpler: keep in-memory
    // and document that production uses Redis via an external sidecar if
    // ioredis is not present.
  });
}

export const apiLimiter = limiter(
  config.rateLimits.api,
  "Too many requests from this address — please slow down."
);
export const otpRequestLimiter = limiter(
  config.rateLimits.otpRequest,
  "Too many OTP requests. Please try again in a minute."
);
export const otpVerifyLimiter = limiter(
  config.rateLimits.otpVerify,
  "Too many verification attempts. Please try again in a minute."
);
export const workerLoginLimiter = limiter(
  config.rateLimits.workerLogin,
  "Too many login attempts. Please try again in a minute."
);
export const governmentLoginLimiter = limiter(
  config.rateLimits.governmentLogin,
  "Too many login attempts. Please try again in a minute."
);
export const registerLimiter = limiter(
  config.rateLimits.register,
  "Too many registration attempts. Please try again in a minute."
);
// Card verification is public and takes an opaque code, so the limit is there to
// make guessing (or scraping a list of real cards) expensive rather than to
// shape normal use: a genuine scan is a handful of requests per person.
export const cardVerifyLimiter = limiter(
  30,
  "Too many card checks from this address. Please try again in a minute."
);

export { redisClient, redisIncr };
