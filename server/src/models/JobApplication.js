import mongoose from "mongoose";

const { Schema } = mongoose;

export const APPLICATION_STATUSES = ["submitted", "withdrawn"];

/**
 * JobApplication — a worker's expression of interest in a JobPosting.
 *
 * Privacy: the worker's phone number is stored ONLY when the worker ticks
 * "share my number with this office" at apply time (share_contact=true). The
 * name/worker_id snapshot lets the posting office act on the application,
 * while a withdrawn application is hidden from the office list.
 */
const JobApplicationSchema = new Schema(
  {
    job_id: { type: Schema.Types.ObjectId, ref: "JobPosting", required: true, index: true },
    worker_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: "submitted" },
    note: { type: String, default: null, maxlength: 300 },
    share_contact: { type: Boolean, default: false },
    contact_phone: { type: String, default: null },
    worker_snapshot: {
      worker_code: { type: String, default: null }, // SS-XXXXXX (not the Mongo id)
      full_name: { type: String, default: null },
      occupation: { type: String, default: null },
      district: { type: String, default: null },
      state: { type: String, default: null },
    },
  },
  { timestamps: true, collection: "job_applications" }
);

JobApplicationSchema.index({ job_id: 1, worker_id: 1 }, { unique: true });

JobApplicationSchema.methods.toJSON = function () {
  return {
    id: String(this._id),
    job_id: String(this.job_id),
    status: this.status,
    note: this.note,
    share_contact: this.share_contact,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

/** Shape shown to the official who posted the job. */
JobApplicationSchema.methods.toOfficialJSON = function () {
  return {
    id: String(this._id),
    job_id: String(this.job_id),
    status: this.status,
    note: this.note,
    worker: {
      worker_code: this.worker_snapshot?.worker_code ?? null,
      full_name: this.worker_snapshot?.full_name ?? null,
      occupation: this.worker_snapshot?.occupation ?? null,
      district: this.worker_snapshot?.district ?? null,
      state: this.worker_snapshot?.state ?? null,
      // Only present when the worker explicitly consented.
      contact_phone: this.share_contact ? this.contact_phone : null,
    },
    created_at: this.createdAt,
  };
};

export const JobApplication = mongoose.model("JobApplication", JobApplicationSchema);
