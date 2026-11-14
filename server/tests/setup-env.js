/**
 * Test environment — MUST run before any module imports config.js.
 * Vitest runs setup files before importing test files, and dotenv (in
 * config.js) never overrides already-set process.env values, so these
 * win over server/.env.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.env.ENV = "test";
process.env.JWT_SECRET_KEY = "test-secret-key-for-vitest-only-0123456789abcdef";
// Fixed 32-byte test master key for the document-wallet wrapping.
process.env.DOC_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.OTP_ECHO_ENABLED = "false";
process.env.OTP_PEPPER = "test-otp-pepper-0123456789abcdef0123456789abcdef";
process.env.SEED_DEMO_DATA = "false";
process.env.UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-uploads");

// Generous limits everywhere EXCEPT OTP request — that one stays strict so
// the rate-limit test can assert a real 429 against the shipped default.
process.env.RATE_LIMIT_WINDOW_MS = "60000";
process.env.RATE_LIMIT_API = "1000000";
process.env.RATE_LIMIT_OTP_REQUEST = "5";
process.env.RATE_LIMIT_OTP_VERIFY = "1000";
process.env.RATE_LIMIT_WORKER_LOGIN = "1000";
process.env.RATE_LIMIT_GOV_LOGIN = "1000";
process.env.RATE_LIMIT_REGISTER = "1000";

// Use the machine's real mongod when present (MongoDB Server 8.0 on this
// Windows box) to avoid a download per run; on machines/CI runners without
// it, mongodb-memory-server falls back to downloading its own binary.
const systemMongod = "C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe";
if (process.platform === "win32" && existsSync(systemMongod)) {
  process.env.MONGOMS_SYSTEM_BINARY = systemMongod;
}
