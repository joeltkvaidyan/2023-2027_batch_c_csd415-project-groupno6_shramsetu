import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { config } from "../config.js";

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export const signToken = (user) =>
  jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      worker_id: user.worker_id ?? null,
      employee_id: user.employee_id ?? null,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
};

/** AES-256-GCM encrypt: returns {iv, tag, data} as base64. */
export function encryptBuffer(buf) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(buf), cipher.final()]);
  return {
    key: key.toString("base64"),
    payload: Buffer.concat([iv, cipher.getAuthTag(), data]), // iv||tag||ciphertext
  };
}

export function decryptBuffer(payload, keyB64) {
  const key = Buffer.from(keyB64, "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const data = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Document-wallet PIN digest.
 *
 * scrypt, not bcrypt or sha256: the PIN space is 10^4–10^8, so the only thing
 * standing between a dump and a wallet is per-guess cost. Parameters are stored
 * with the digest so they can be raised later without invalidating live PINs.
 * Format: scrypt:<N>:<r>:<p>:<saltBase64>:<keyBase64>
 */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
// 128 * N * r bytes are required; node's default maxmem (32 MB) is too small.
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

function scryptAsync(password, salt, keylen, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(pin), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPin(pin, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, nStr, rStr, pStr, saltB64, keyB64] = stored.split(":");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const derived = await scryptAsync(String(pin), Buffer.from(saltB64, "base64"), expected.length, {
    N: parseInt(nStr, 10),
    r: parseInt(rStr, 10),
    p: parseInt(pStr, 10),
    maxmem: SCRYPT_MAXMEM,
  });
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/**
 * Wallet-unlock token (10 minutes), distinct from an access token.
 *
 * Signed with a key DERIVED from the JWT secret rather than the secret itself,
 * so a wallet token can never be replayed as a bearer token on any other route
 * (jsonwebtoken ignores an `aud` it was not asked to check, so a separate key
 * is the only structural guarantee).
 */
const walletKey = () =>
  crypto.createHmac("sha256", config.jwtSecret).update("shramsetu:wallet-unlock:v1").digest();

export function signWalletToken(userId, ttlSeconds = 600) {
  return jwt.sign({ sub: String(userId), scope: "wallet" }, walletKey(), {
    expiresIn: ttlSeconds,
  });
}

export function verifyWalletToken(token) {
  try {
    const payload = jwt.verify(token, walletKey(), { algorithms: ["HS256"] });
    return payload && payload.scope === "wallet" ? payload : null;
  } catch {
    return null;
  }
}
export const randomOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Digest for a stored OTP. Keyed (HMAC-SHA256), not a plain hash: six digits is
 * only a million candidates, so anyone who reads an unkeyed digest out of a
 * database dump recovers the live login code instantly. The key comes from
 * OTP_PEPPER (required in production); the JWT secret is the dev fallback,
 * which is still a secret that never reaches the database.
 */
export const hashOtp = (code) =>
  crypto.createHmac("sha256", config.otp.pepper || config.jwtSecret).update(String(code)).digest("hex");
