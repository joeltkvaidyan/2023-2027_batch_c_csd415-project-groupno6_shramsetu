import mongoose from "mongoose";

const { Schema } = mongoose;

export const GRIEVANCE_CATEGORIES = [
  "unpaid_wages",
  "workplace_safety",
  "harassment_abuse",
  "illegal_termination",
  "document_issue",
  "employer_dispute",
  "insurance_claim",
  "accommodation",
  "other",
];

export const GRIEVANCE_STATUSES = ["submitted", "under_review", "resolved", "rejected", "withdrawn"];

/**
 * Grievances. Timeline entries and comments are embedded arrays — they are
 * always loaded together with the grievance, and MongoDB documents cap at
 * 16 MB which is far beyond any realistic timeline.
 */
const GrievanceSchema = new Schema(
  {
    complaint_number: { type: String, index: true }, // GR-XXXXXXXX
    owner_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Denormalised jurisdiction snapshot (where the grievance was FILED).
    // Lets government officials query their scope without joining users, and
    // preserves the filing district even if the worker later moves. Set at
    // creation; legacy rows may be null (scope falls back to the live
    // worker set — see utils/scope.js).
    owner_state: { type: String, default: null, index: true },
    owner_district: { type: String, default: null, index: true },

    category: { type: String, enum: GRIEVANCE_CATEGORIES, required: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    status: { type: String, enum: GRIEVANCE_STATUSES, default: "submitted", index: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },

    employer_name: { type: String, default: null },
    incident_location: { type: String, default: null },
    incident_date: { type: Date, default: null },

    sla_deadline: { type: Date, default: null },
    escalated: { type: Boolean, default: false },
    resolved_at: { type: Date, default: null },

    worker_rating: { type: Number, min: 1, max: 5, default: null },
    worker_feedback: { type: String, default: null },
    feedback_at: { type: Date, default: null },

    // One array, two kinds of evidence. `kind: "file"` is an uploaded and
    // encrypted document (the original path). `kind: "wage_slip"` and
    // `kind: "engagement"` are references to records the platform already holds,
    // so a wage complaint can cite employer-confirmed days without the worker
    // having to photograph anything. Existing rows have no `kind` and read as
    // "file".
    attachments: [
      {
        _id: false,
        id: String, // subdoc string id for the frontend
        kind: { type: String, default: "file" },
        ref_id: { type: String, default: null },
        label: { type: String, default: null },
        original_filename: String,
        content_type: String,
        size_bytes: Number,
        created_at: Date,
      },
    ],
    timeline: [
      {
        _id: false,
        status: String,
        note: String,
        changed_by: String,
        created_at: Date,
      },
    ],
    comments: [
      {
        _id: false,
        id: String,
        author_name: String,
        author_role: String,
        content: String,
        is_internal: { type: Boolean, default: false },
        created_at: Date,
      },
    ],
  },
  { timestamps: true, collection: "grievances" }
);

GrievanceSchema.methods.toJSON = function () {
  const base = {
    id: String(this._id),
    complaint_number: this.complaint_number,
    category: this.category,
    subject: this.subject,
    description: this.description,
    status: this.status,
    priority: this.priority,
    escalated: this.escalated,
    sla_deadline: this.sla_deadline,
    employer_name: this.populateRef?.worker ?? null, // filled by toListJSON when joined
    incident_location: this.incident_location,
    incident_date: this.incident_date,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
    resolved_at: this.resolved_at,
    worker_rating: this.worker_rating,
    worker_feedback: this.worker_feedback,
    feedback_at: this.feedback_at,
  };
  return base;
};

export const Grievance = mongoose.model("Grievance", GrievanceSchema);
 Grievance.prototype.toListJSON = function () {
  return this.toJSON();
};
