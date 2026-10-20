import mongoose from "mongoose";

const { Schema } = mongoose;

export const RATER_ROLES = ["employer", "public"];

/**
 * WorkerRating — a 1..5 star rating a worker's customers give them.
 *
 * Two honest rater types:
 *  - employer: a signed-in employer account (identity is the account itself;
 *    one rating per employer per worker, and the profile name is shown).
 *  - public: any member of the public ("common people") from the find-a-worker
 *    directory, self-identified by name + phone. One rating per phone per
 *    worker, and only the typed name is ever displayed.
 *
 * A worker can NEVER rate themselves, and nothing here verifies that the rater
 * actually hired the worker — the UI must present ratings as unverified
 * community feedback, not a credential.
 */
const WorkerRatingSchema = new Schema(
  {
    worker_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    rater_role: { type: String, enum: RATER_ROLES, required: true },
    // employer accounts: set; public raters: null
    rater_user_id: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // public raters: self-declared; employer raters: null (profile used instead)
    rater_name: { type: String, default: null, maxlength: 80 },
    // 10-15 digit contact for dedupe + abuse follow-up. Never rendered publicly.
    rater_phone: { type: String, default: null },
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: null, maxlength: 300 },
    employer_name: { type: String, default: null, maxlength: 120 }, // optional, employer-entered business/site name
  },
  { timestamps: true, collection: "worker_ratings" }
);

// Rate-limit-friendly pagination; newest first per worker.
WorkerRatingSchema.index({ worker_id: 1, createdAt: -1 });

// Dedupe: one rating per phone per worker OR per employer per worker. Two
// partial unique indexes are enforced in the route via upsert + E11000 catch
// because a single compound index cannot be conditional on rater_role.
WorkerRatingSchema.index(
  { worker_id: 1, rater_phone: 1 },
  { unique: true, partialFilterExpression: { rater_phone: { $type: "string" } } }
);
WorkerRatingSchema.index(
  { worker_id: 1, rater_user_id: 1 },
  { unique: true, partialFilterExpression: { rater_user_id: { $type: "objectId" } } }
);

WorkerRatingSchema.methods.toJSON = function () {
  return {
    id: String(this._id),
    worker_id: String(this.worker_id),
    rater_role: this.rater_role,
    rater_display_name: this.rater_role === "employer" ? this.employer_name || "Employer" : this.rater_name || "Member of the public",
    // NOTE: rater_phone is deliberately NOT exposed — it is a dedupe key.
    stars: this.stars,
    comment: this.comment,
    created_at: this.createdAt,
  };
};

export const WorkerRating = mongoose.model("WorkerRating", WorkerRatingSchema);
