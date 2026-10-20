import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Document wallet metadata. File bytes live on disk (uploads/) named by the
 * Mongo ObjectId; the AES-256-GCM encryption key is stored in the DB row,
 * separated from the ciphertext on disk (defense in depth for the demo).
 */
const DocumentSchema = new Schema(
  {
    owner_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    display_name: { type: String, required: true, trim: true },
    original_filename: { type: String, required: true },
    content_type: { type: String, required: true },
    size_bytes: { type: Number, required: true },
    storage_key: { type: String, required: true }, // filename in uploads/
    encryption_key: { type: String, required: true }, // base64 AES-256-GCM key
  },
  { timestamps: true, collection: "documents" }
);

DocumentSchema.methods.toJSON = function () {
  return {
    id: String(this._id),
    display_name: this.display_name,
    original_filename: this.original_filename,
    content_type: this.content_type,
    size_bytes: this.size_bytes,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

export const Document = mongoose.model("Document", DocumentSchema);

// ── OTP codes (terminal-delivered in dev) ─────────────────────────────
const OtpCodeSchema = new Schema(
  {
    mobile_number: { type: String, required: true, index: true },
    code_hash: { type: String, required: true }, // sha256 — never store the raw OTP
    purpose: { type: String, enum: ["register", "login", "recovery"], default: "login" },
    attempts: { type: Number, default: 0 },
    expires_at: { type: Date, required: true },
    consumed_at: { type: Date, default: null },
    last_sent_at: { type: Date, default: null },
  },
  { timestamps: true, collection: "otp_codes" }
);

OtpCodeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup

export const OtpCode = mongoose.model("OtpCode", OtpCodeSchema);

// ── Audit log (government superadmin views) ───────────────────────────
const AuditLogSchema = new Schema(
  {
    actor_role: { type: String, index: true },
    actor_identifier: String,
    action: { type: String, index: true },
    resource_type: String,
    resource_id: String,
    ip_address: String,
    success: { type: Boolean, default: true },
    failure_reason: String,
  },
  { timestamps: true, collection: "audit_logs" }
);

AuditLogSchema.methods.toJSON = function () {
  return {
    id: String(this._id),
    timestamp: this.createdAt,
    actor_role: this.actor_role,
    actor_identifier: this.actor_identifier,
    action: this.action,
    resource_type: this.resource_type,
    resource_id: this.resource_id,
    ip_address: this.ip_address,
    success: this.success,
    failure_reason: this.failure_reason,
  };
};

export const AuditLog = mongoose.model("AuditLog", AuditLogSchema);

// ── Chat history (AI assistant) ───────────────────────────────────────
const ChatMessageSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    language: { type: String, default: "en" },
    meta: { type: Schema.Types.Mixed, default: null }, // ChatAnswer for assistant rows
  },
  { timestamps: true, collection: "chat_messages" }
);

ChatMessageSchema.methods.toJSON = function () {
  return {
    role: this.role,
    content: this.content,
    language: this.language,
    created_at: this.createdAt,
    meta: this.meta,
  };
};

export const ChatMessage = mongoose.model("ChatMessage", ChatMessageSchema);
