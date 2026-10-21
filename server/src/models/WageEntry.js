import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * WageEntry — one "day sheet" row per worker per day (unique per worker +
 * work_date; re-submitting the same date updates instead of duplicating).
 *
 * An entry starts SELF-REPORTED by the worker. It can be corroborated by an
 * Engagement (models/Engagement.js): when the employer account that hired the
 * worker confirms the shift, the row gains `engagement_id`,
 * `employer_account_id`, `confirmed_at` and a `source` of "employer_confirmed"
 * (created by the employer's confirmation) or "mutual" (the worker reported it
 * first and the employer then confirmed it).
 *
 * What survives confirmation is the paid-day lock: an entry already marked
 * "paid" never has its amounts rewritten. The unpaid total feeds the pre-filled
 * unpaid_wages grievance (docs/FEATURE_PARITY.md, proposal 3).
 */
export const WAGE_ENTRY_SOURCES = ["worker_reported", "employer_confirmed", "mutual"];
const WageEntrySchema = new Schema(
  {
    worker_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    work_date: { type: Date, required: true },
    employer_name: { type: String, default: null },
    agreed_amount: { type: Number, required: true, min: 0 },
    paid_amount: { type: Number, default: 0, min: 0 },
    payment_status: { type: String, enum: ["paid", "unpaid", "partial"], default: "unpaid" },

    // Provenance. All four stay null/worker_reported for a row the worker typed
    // in; they are filled by routes/engagements.js when an employer corroborates
    // the day. `employer_account_id` is the employer's USER account — never the
    // worker-private Employer contact book.
    engagement_id: { type: Schema.Types.ObjectId, ref: "Engagement", default: null, index: true },
    employer_account_id: { type: Schema.Types.ObjectId, ref: "User", default: null },
    source: { type: String, enum: WAGE_ENTRY_SOURCES, default: "worker_reported" },
    confirmed_at: { type: Date, default: null },
  },
  { timestamps: true, collection: "wage_entries" }
);

WageEntrySchema.index({ worker_id: 1, work_date: 1 }, { unique: true });

WageEntrySchema.methods.toJSON = function () {
  return {
    id: String(this._id),
    work_date: this.work_date,
    employer_name: this.employer_name,
    agreed_amount: this.agreed_amount,
    paid_amount: this.paid_amount,
    payment_status: this.payment_status,
    source: this.source ?? "worker_reported",
    employer_confirmed: (this.source ?? "worker_reported") !== "worker_reported",
    engagement_id: this.engagement_id ? String(this.engagement_id) : null,
    employer_account_id: this.employer_account_id ? String(this.employer_account_id) : null,
    confirmed_at: this.confirmed_at ?? null,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

export const WageEntry = mongoose.model("WageEntry", WageEntrySchema);
