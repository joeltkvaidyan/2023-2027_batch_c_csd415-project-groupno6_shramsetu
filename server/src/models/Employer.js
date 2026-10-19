import mongoose from "mongoose";
import { OCCUPATIONS, employerKey } from "../utils/occupations.js";

const { Schema } = mongoose;

/**
 * Employer — a WORKER-OWNED record of an employer they work for repeatedly.
 *
 * Deliberately not a shared employer directory and not an employer account:
 * one worker may never read, edit or infer another worker's employer records.
 * Everything here is self-reported by the worker; nothing is verified against
 * the employer. Wage totals are joined from the worker's own WageEntry rows by
 * normalised employer name at read time, so they can never include another
 * worker's data.
 *
 * Deletes are soft (is_active=false) so wage history keeps a labelled record
 * instead of silently losing the employer.
 */
const EmployerSchema = new Schema(
  {
    worker_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // lowercased/whitespace-normalised name — unique per worker
    name_key: { type: String, required: true, index: true },
    occupation: { type: String, enum: [...OCCUPATIONS, null], default: null },
    phone: { type: String, default: null }, // optional, worker-entered
    work_location: { type: String, default: null, maxlength: 160 },
    district: { type: String, default: null, maxlength: 80 },
    state: { type: String, default: null, maxlength: 80 },
    daily_wage: { type: Number, default: null, min: 0 },
    notes: { type: String, default: null, maxlength: 500 },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "employers" }
);

EmployerSchema.index({ worker_id: 1, name_key: 1 }, { unique: true });

EmployerSchema.pre("validate", function (next) {
  if (this.name) this.name_key = employerKey(this.name);
  next();
});

EmployerSchema.methods.toJSON = function () {
  return {
    id: String(this._id),
    name: this.name,
    occupation: this.occupation,
    phone: this.phone,
    work_location: this.work_location,
    district: this.district,
    state: this.state,
    daily_wage: this.daily_wage,
    notes: this.notes,
    is_active: this.is_active,
    self_reported: true,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

export const Employer = mongoose.model("Employer", EmployerSchema);
