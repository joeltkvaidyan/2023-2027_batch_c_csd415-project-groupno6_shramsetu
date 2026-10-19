import mongoose from "mongoose";
import { JOB_OCCUPATIONS } from "../utils/occupations.js";

const { Schema } = mongoose;

export const JOB_STATUSES = ["open", "closed"];
export const WORK_TYPES = ["daily", "part_time", "full_time", "seasonal"];
export const WAGE_PERIODS = ["day", "week", "month"];

/**
 * JobPosting — a job listing created by a government/partner official inside
 * their own jurisdiction.
 *
 * Honesty constraints baked into the schema:
 *  - there is no employer self-service account, so `posted_by` is always an
 *    authenticated official and `posted_by_department` is snapshotted;
 *  - `verification` is always "unverified": ShramSetu cannot verify that a
 *    third-party employer will honour the listed wage. The UI must show this.
 *  - contact details are optional; if absent the UI tells workers to apply
 *    through the portal instead of inventing a phone number.
 */
const JobPostingSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    employer_name: { type: String, required: true, trim: true, maxlength: 120 },
    occupation: { type: String, enum: JOB_OCCUPATIONS, required: true, index: true },

    state: { type: String, required: true, index: true },
    district: { type: String, default: null, index: true },
    work_location: { type: String, default: null, maxlength: 160 },

    wage_min: { type: Number, default: null, min: 0 },
    wage_max: { type: Number, default: null, min: 0 },
    wage_period: { type: String, enum: WAGE_PERIODS, default: "day" },
    work_type: { type: String, enum: WORK_TYPES, default: "daily" },
    openings: { type: Number, default: 1, min: 1, max: 500 },

    contact_phone: { type: String, default: null },
    status: { type: String, enum: JOB_STATUSES, default: "open", index: true },

    posted_by: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    posted_by_department: { type: String, default: null },
    // Never claim a listing is verified — see model comment.
    verification: { type: String, enum: ["unverified"], default: "unverified" },
  },
  { timestamps: true, collection: "job_postings" }
);

JobPostingSchema.index({ status: 1, state: 1, occupation: 1, createdAt: -1 });

JobPostingSchema.methods.toJSON = function () {
  return {
    id: String(this._id),
    title: this.title,
    description: this.description,
    employer_name: this.employer_name,
    occupation: this.occupation,
    state: this.state,
    district: this.district,
    work_location: this.work_location,
    wage_min: this.wage_min,
    wage_max: this.wage_max,
    wage_period: this.wage_period,
    work_type: this.work_type,
    openings: this.openings,
    contact_phone: this.contact_phone,
    status: this.status,
    posted_by_department: this.posted_by_department,
    verification: this.verification,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

export const JobPosting = mongoose.model("JobPosting", JobPostingSchema);
