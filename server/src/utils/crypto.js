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
