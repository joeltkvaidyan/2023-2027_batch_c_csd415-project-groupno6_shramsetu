import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const bool = (v, dflt = false) =>
  v === undefined || v === "" ? dflt : ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
const int = (v, dflt) => {
  const n = v !== undefined && v !== "" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

// Safe by default: a missing ENV is treated as production, so the demo
// conveniences (terminal OTP echo, seeded accounts, verbose errors) have to be
// switched ON explicitly. Every one of these was previously on by default,
// which meant a deploy that forgot a variable ran in demo mode.
const envName = process.env.ENV || "production";

/**
 * Express's `trust proxy` setting decides what req.ip is, and every rate limit
 * keys off req.ip. Behind one reverse proxy (Render, nginx, Fly) the socket
 * address is the proxy's, so without this a single noisy client throttles the
 * whole platform — and with `true` a client can spoof X-Forwarded-For and evade
 * the limit entirely. Hence a hop COUNT (1), not a boolean, and only when the
 * deployment says it is behind a proxy. `TRUST_PROXY` accepts a hop count, a
 * boolean, or any value Express itself understands ("loopback", CIDR list).
 */
function parseTrustProxy(env) {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw.trim() === "") return env === "production" ? 1 : false;
  const value = raw.trim();
  const lowered = value.toLowerCase();
  if (["false", "0", "no", "off"].includes(lowered)) return false;
  if (["true", "1", "yes", "on"].includes(lowered)) return 1;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  return value; // e.g. "loopback" or a CIDR list
}

// MONGODB_URI wins whole (docker-compose sets it). On Render the blueprint
// only supplies the private host — render.yaml cannot interpolate a full URI
// (no variable interpolation), so assemble it from parts:
//   MONGO_HOST (required, via fromService property: host) + optional
//   MONGO_USER / MONGO_PASSWORD / MONGO_PORT / MONGO_DB.
// Falls back to "memory" (dev) when neither is set.
function resolveMongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const host = process.env.MONGO_HOST;
  if (!host) return "memory";
  const user = process.env.MONGO_USER || "root";
  const pass = process.env.MONGO_PASSWORD || "";
  const port = process.env.MONGO_PORT || "27017";
  const db = process.env.MONGO_DB || "shramsetu";
  const auth = pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : "";
  return `mongodb://${auth}${host}:${port}/${db}?authSource=admin`;
}

export const config = {
  env: envName,
  debug: bool(process.env.DEBUG, false),
  port: int(process.env.PORT, 8000),
  // Hop count (or Express value) for X-Forwarded-For; see parseTrustProxy.
  trustProxy: parseTrustProxy(envName),

  // "memory" = embedded MongoDB for development (no install needed).
  // Production: MONGODB_URI (full) or MONGO_HOST (+ parts) — see
  // resolveMongoUri() above, e.g. mongodb://user:pass@host:27017/shramsetu.
  mongodbUri: resolveMongoUri(),
  seedDemoData: bool(process.env.SEED_DEMO_DATA, false),

  jwtSecret: process.env.JWT_SECRET_KEY,
  // Short-lived tokens: a stolen token expires fast, and the /authenticate
  // re-check (see middleware/auth.js) catches disabled users sooner.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",

  otp: {
    echoEnabled: bool(process.env.OTP_ECHO_ENABLED, false), // DEV ONLY
    // HMAC key for stored OTP digests. A 6-digit code has only a million
    // possible values, so an UNKEYED sha256 in a database dump is reversible in
    // milliseconds; the pepper lives in the environment, never in the DB.
    pepper: process.env.OTP_PEPPER || "",
    expireSeconds: int(process.env.OTP_EXPIRE_SECONDS, 300),
    resendCooldownSeconds: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    maxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
  },

  bootstrapAdmin: {
    employeeId: process.env.BOOTSTRAP_ADMIN_EMPLOYEE_ID || "ADMIN001",
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  },

  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"),
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 10),

  aiServiceUrl: process.env.AI_SERVICE_URL || "http://127.0.0.1:8100",
  // Budget for one Node→AI call. A warm /ask answers in ~1-2s, but the first
  // one after a service restart can legitimately spend a minute loading the
  // embedding model, FAISS index and (for Indic voice) Whisper on a 4-core
  // box. 60s aborted those mid-load and surfaced as "ai-service unavailable:
  // This operation was aborted", so the budget is generous on purpose; the UI
  // already shows a thinking state for the wait.
  aiTimeoutMs: int(process.env.AI_TIMEOUT_MS, 120000),
  // Shared secret sent as X-Internal-Key on every Node→AI call. Empty in dev
  // (AI service accepts unauthenticated /ask,/speak,/transcribe only when
  // AI_INTERNAL_KEY is unset on ITS side too).
  aiInternalKey: process.env.AI_INTERNAL_KEY || "",

  // Document-wallet master key (32 bytes, base64). Wraps per-file AES keys.
  docMasterKeyRaw: process.env.DOC_MASTER_KEY,

  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Rate limits (requests per window). Configurable via env.
  rateLimits: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    api: int(process.env.RATE_LIMIT_API, 300),
    otpRequest: int(process.env.RATE_LIMIT_OTP_REQUEST, 5),
    otpVerify: int(process.env.RATE_LIMIT_OTP_VERIFY, 10),
    workerLogin: int(process.env.RATE_LIMIT_WORKER_LOGIN, 10),
    governmentLogin: int(process.env.RATE_LIMIT_GOV_LOGIN, 10),
    register: int(process.env.RATE_LIMIT_REGISTER, 5),
  },
};

// ── Doc master key parsing + validation ───────────────────────────────
function parseDocMasterKey() {
  const raw = config.docMasterKeyRaw;
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `DOC_MASTER_KEY must be 32 bytes of base64 (got ${buf.length} bytes). Generate one with:\n` +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  return buf;
}
config.docMasterKey = parseDocMasterKey();

if (!config.jwtSecret) {
  throw new Error(
    "JWT_SECRET_KEY is not set — refusing to boot without a signing secret. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

// ── Production startup guard: fail loud, fail early ─────────────────
// Every one of these settings is a dev/demo convenience that would be a
// real vulnerability in production. Refusing to boot beats failing open.
export function assertProductionSafe() {
  // Only an EXPLICIT ENV=development opts out. An unset or mistyped ENV is
  // checked as production, so a missing variable can never silently downgrade
  // a deployment to demo mode.
  if (config.env === "development") return;
  const problems = [];
  if (!process.env.JWT_SECRET_KEY) problems.push("JWT_SECRET_KEY is empty (ephemeral secret would invalidate sessions on restart)");
  if (!process.env.BOOTSTRAP_ADMIN_PASSWORD || config.bootstrapAdmin.password === "Admin@123") {
    problems.push("BOOTSTRAP_ADMIN_PASSWORD is unset or the default 'Admin@123'");
  }
  if (config.otp.echoEnabled) problems.push("OTP_ECHO_ENABLED=true would print login codes to the server terminal");
  if (config.seedDemoData) problems.push("SEED_DEMO_DATA=true would create demo workers with known passwords");
  if (config.mongodbUri === "memory") problems.push("MONGODB_URI=memory (in-process MongoDB — data is lost on restart)");
  if (!config.docMasterKey) problems.push("DOC_MASTER_KEY is unset — document-wallet keys would be unwrapped in the DB");
  if (!config.otp.pepper || config.otp.pepper.length < 32) {
    problems.push("OTP_PEPPER is unset or shorter than 32 characters — stored OTP digests would be brute-forceable");
  }
  if (!config.aiInternalKey) {
    problems.push("AI_INTERNAL_KEY is unset — the AI service would answer unauthenticated requests");
  }
  if (problems.length) {
    throw new Error(
      "Refusing to boot in production:\n  - " + problems.join("\n  - ") +
        "\nFix these in server/.env, or run with ENV=development for local demo mode."
    );
  }
}
