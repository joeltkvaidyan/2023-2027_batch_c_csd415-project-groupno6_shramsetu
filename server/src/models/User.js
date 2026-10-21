import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Users collection — both workers and government officials (role field).
 * Field names mirror the legacy SQLModel schema so the frontend types and
 * API payloads stay compatible.
 */
const UserSchema = new Schema(
  {
    worker_id: { type: String, index: true }, // SS-XXXXXX (workers only)
    employee_id: { type: String }, // officials only; unique sparse index below
    role: { type: String, enum: ["worker", "government", "employer", "citizen"], required: true, index: true },

    full_name: { type: String, required: true, trim: true },
    mobile_number: { type: String, required: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    password_hash: { type: String, default: null },

    // employer self-service fields (readable only through laboured routes)
    business_name: { type: String, default: null, trim: true, maxlength: 120 },

    // worker profile
    gender: { type: String, enum: ["male", "female", "other", null], default: null },
    date_of_birth: { type: Date, default: null },
    aadhaar_last4: { type: String, default: null }, // never store the full number
    occupation: { type: String, default: null },
    years_of_experience: { type: Number, default: null },
    preferred_language: { type: String, default: "en" },

    current_address_line: { type: String, default: null },
    current_village_or_city: { type: String, default: null },
    current_district: { type: String, default: null },
    current_state: { type: String, default: null },
    current_pincode: { type: String, default: null },

    native_state: { type: String, default: null },
    native_district: { type: String, default: null },

    emergency_contact_name: { type: String, default: null },
    emergency_contact_relation: { type: String, default: null },
    emergency_contact_number: { type: String, default: null },

    profile_photo_path: { type: String, default: null },
    qr_code: { type: String, default: null }, // data URL (worker ID QR)

    // government fields
    department: { type: String, default: null },
    designation: { type: String, default: null },
    state: { type: String, default: null },
    district: { type: String, default: null },
    is_superadmin: { type: Boolean, default: false },

    is_phone_verified: { type: Boolean, default: false },
    // Government acceptance gate: every NEW worker registration starts as
    // "pending" and a jurisdiction official must accept or reject the worker.
    // Only "accepted" workers appear in the public find-a-worker directory and
    // can apply to job listings. Existing/seeded rows default to "accepted" so
    // no account silently loses access during the schema upgrade.
    //
    // The same gate now applies to EMPLOYERS: a new employer account starts
    // "pending" and must be accepted by a labour office before it can post
    // listings publicly or rate workers. Defaults stay "accepted" for legacy
    // rows (the bootstrap backfill covers them).
    gov_approve_status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "accepted",
      index: true,
    },
    gov_approve_at: { type: Date, default: null },
    gov_approve_by: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // Account recovery: a one-time secret shown ONCE at registration (and via
    // password login). Only its sha-256 hash is stored, so a database leak
    // cannot reveal it. Losing BOTH the password and this key means the
    // account can only be recovered at a Common Service Centre / labour office.
    recovery_key_hash: { type: String, default: null },

    // Privacy notice at registration: worker consented to chat text/voice
    // being processed by third-party AI providers (see the registration UI).
    consent_ai_processing: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "users" }
);

// Sparse unique indexes: null values don't collide.
UserSchema.index({ mobile_number: 1 }, { unique: true, sparse: false });
UserSchema.index({ employee_id: 1 }, { unique: true, sparse: true });
// Worker codes (SS-XXXXXX) must be globally unique: they are printed on
// IDs, quoted in audits, and are the lookup key for account recovery — a
// collision would let one worker's recovery key target another's account.
// Partial (workers only) so officials/employers without a code never
// collide with each other.
UserSchema.index({ worker_id: 1 }, { unique: true, partialFilterExpression: { role: "worker" } });

/** Public worker shape (what the frontend Worker type expects). */
UserSchema.methods.toWorkerJSON = function () {
  return {
    id: String(this._id),
    worker_id: this.worker_id,
    full_name: this.full_name,
    mobile_number: this.mobile_number,
    email: this.email,
    role: this.role,
    profile_photo_path: this.profile_photo_path,
    preferred_language: this.preferred_language,
    qr_code: this.qr_code,
    // Acceptance is worker-visible: the dashboard shows one honest badge.
    gov_approve_status: this.gov_approve_status ?? "pending",
    recovery_key_set: Boolean(this.recovery_key_hash),
  };
};

UserSchema.methods.toEmployerJSON = function () {
  return {
    id: String(this._id),
    full_name: this.full_name,
    business_name: this.business_name,
    mobile_number: this.mobile_number,
    role: this.role,
    preferred_language: this.preferred_language,
    // Acceptance is employer-visible: the dashboard shows one honest badge and
    // gates job posting + rating on it, exactly like the worker dashboard.
    gov_approve_status: this.gov_approve_status ?? "accepted",
    current_village_or_city: this.current_village_or_city,
    current_district: this.current_district,
    current_state: this.current_state,
  };
};

/** Citizen (household) shape — minimal, no sensitive fields beyond contact. */
UserSchema.methods.toCitizenJSON = function () {
  return {
    id: String(this._id),
    full_name: this.full_name,
    mobile_number: this.mobile_number,
    role: this.role,
    preferred_language: this.preferred_language,
    recovery_key_set: Boolean(this.recovery_key_hash),
    current_village_or_city: this.current_village_or_city,
    current_district: this.current_district,
    current_state: this.current_state,
  };
};

UserSchema.methods.toGovernmentJSON = function () {
  return {
    id: String(this._id),
    employee_id: this.employee_id,
    full_name: this.full_name,
    email: this.email,
    mobile_number: this.mobile_number,
    department: this.department,
    designation: this.designation,
    state: this.state,
    district: this.district,
    is_superadmin: this.is_superadmin,
    created_at: this.createdAt,
  };
};

export const User = mongoose.model("User", UserSchema);
