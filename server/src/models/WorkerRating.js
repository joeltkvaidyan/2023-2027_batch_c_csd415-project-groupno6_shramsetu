import mongoose from "mongoose";

const { Schema } = mongoose;

export const RATER_ROLES = ["employer", "public"];

/**
 * How much a rating's author is actually known to have hired the worker.
 *
 *  - confirmed_engagement: a signed-in employer account with a confirmed
 *    engagement with this worker. The only path we can call corroborated.
 *  - public_self_declared:  a member of the public who typed a name and a
 *    phone number. No account, no engagement, no verification — every surface
 *    must label it as such.
 */
export const RATING_VERIFICATIONS = ["confirmed_engagement", "public_self_declared"];

/** Days the rated worker has to reply before the record is final. */
export const REPLY_WINDOW_DAYS = 14;

/**
 * WorkerRating — a 1..5 star rating a worker's customers give them.
 *
 * Two rater types, and the difference now matters:
 *  - employer: requires a confirmed engagement between that employer account and
 *    this worker, and carries its `engagement_id`. One rating per employer per
 *    worker.
 *  - public: any member of the public, self-declared by name + phone. One rating
 *    per phone per worker, labelled unverified everywhere it appears.
 *
 * Two-sided release: the rated worker has REPLY_WINDOW_DAYS to reply. Until they
 * do (or the window closes) the rating is not final — the rater may still amend
 * it — and it carries `released: false`. Both facts are computed at read time
 * from `createdAt` and the presence of a reply; nothing about release is stored.
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

    // The engagement that entitles this rater to rate. Null for the public path.
    engagement_id: { type: Schema.Types.ObjectId, ref: "Engagement", default: null, index: true },
    verification: {
      type: String,
      enum: RATING_VERIFICATIONS,
      default: "public_self_declared",
      index: true,
    },

    // The worker's right of reply. One reply; it is part of the record.
    response: {
      text: { type: String, default: null, maxlength: 500 },
      responded_at: { type: Date, default: null },
    },
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

/** When the worker's reply window closes. Derived, never stored. */
WorkerRatingSchema.methods.replyWindowClosesAt = function () {
  return new Date(new Date(this.createdAt).getTime() + REPLY_WINDOW_DAYS * 86_400_000);
};

/** Final once the worker has replied, or once the window has run out. */
WorkerRatingSchema.methods.isReleased = function (now = new Date()) {
  if (this.response?.text) return true;
  return now.getTime() >= this.replyWindowClosesAt().getTime();
};

WorkerRatingSchema.methods.toJSON = function () {
  const released = this.isReleased();
  const employer = this.rater_role === "employer";
  return {
    id: String(this._id),
    worker_id: String(this.worker_id),
    rater_role: this.rater_role,
    rater_display_name: employer ? this.employer_name || "Employer" : this.rater_name || "Member of the public",
    // NOTE: rater_phone is deliberately NOT exposed — it is a dedupe key.
    stars: this.stars,
    comment: this.comment,
    verification: this.verification ?? "public_self_declared",
    // One honest label per path, so a UI never has to guess which is which.
    rater_label: employer ? "verified_employer" : "unverified_public",
    rater_verified: employer,
    engagement_id: this.engagement_id ? String(this.engagement_id) : null,
    response: {
      text: this.response?.text ?? null,
      responded_at: this.response?.responded_at ?? null,
    },
    released,
    reply_window_closes_at: this.replyWindowClosesAt(),
    created_at: this.createdAt,
  };
};

export const WorkerRating = mongoose.model("WorkerRating", WorkerRatingSchema);
