import mongoose from "mongoose";

/**
 * A worker's accident / health cover, as a verifiable record rather than a
 * sentence in a profile.
 *
 * Why a separate document and not four fields on User: a worker changes jobs
 * and schemes, and a household checking a card today needs to know the policy
 * that was live today. Keeping every policy as its own row with validity dates
 * means the answer is always derived from dates, never from somebody having
 * remembered to flip a "has insurance" flag. It also gives the labour office
 * something to verify and the audit log something to point at.
 *
 * Two levels of trust, and the difference is shown to whoever scans the card:
 *   - self_declared: the worker typed it in. Useful, but unproven.
 *   - office_verified: a labour-office official checked it against the insurer
 *     or the scheme's enrolment list. This is the one a household can rely on.
 *
 * Nothing here is public in full: the public verify endpoint exposes the
 * provider, the cover, the sum insured and the end date, and only the last four
 * digits of the policy number (see utils/insurance.js).
 */
const COVERAGES = ["accident", "hospitalisation", "disability", "death"];

const insurancePolicySchema = new mongoose.Schema(
  {
    worker_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    provider: { type: String, required: true, trim: true, maxlength: 120 },
    policy_number: { type: String, required: true, trim: true, maxlength: 64 },

    /** What the policy pays for. The card only ever claims this one thing. */
    coverage: { type: String, enum: COVERAGES, default: "accident" },

    /** Rupees. Integer, because a CSV of "₹2,00,000" is not sortable. */
    sum_insured: { type: Number, required: true, min: 1, max: 100000000 },

    valid_from: { type: Date, required: true },
    valid_to: { type: Date, required: true },

    verification: {
      type: String,
      enum: ["self_declared", "office_verified"],
      default: "self_declared",
    },
    verified_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    verified_at: { type: Date, default: null },
  },
  { timestamps: true, collection: "insurance_policies" },
);

insurancePolicySchema.index({ worker_id: 1, valid_to: -1 });
insurancePolicySchema.index({ verification: 1, valid_to: -1 });

export const InsurancePolicy = mongoose.model("InsurancePolicy", insurancePolicySchema);
export { COVERAGES };
