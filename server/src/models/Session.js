import mongoose from "mongoose";

/**
 * One refresh-token session per sign-in.
 *
 * Only the SHA-256 of the token is stored: a leaked database cannot be replayed
 * against `/auth/refresh`. `family_id` links every rotation of one sign-in, so a
 * token presented after it was already rotated (the classic stolen-cookie
 * signature: two clients holding the same chain) revokes the whole chain instead
 * of quietly issuing another one.
 */
const sessionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    role: { type: String, required: true },
    token_hash: { type: String, required: true, unique: true },
    family_id: { type: String, required: true, index: true },
    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    revoked_reason: { type: String, default: null },
    replaced_by: { type: String, default: null },
    ip: { type: String, default: null },
    user_agent: { type: String, default: null },
  },
  { timestamps: true }
);

// Mongo drops expired sessions on its own; the TTL index keeps the collection
// from growing without bound (revocation is still checked explicitly).
sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model("Session", sessionSchema);
