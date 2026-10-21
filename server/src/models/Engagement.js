import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Engagement — one employer account hiring one worker for one work date.
 *
 * This is NOT the worker-private `Employer` contact book (models/Employer.js):
 * that collection belongs to a single worker and records people they have
 * worked for. An engagement binds two ACCOUNTS — a User with role "employer"
 * (carrying business_* fields) and a User with role "worker" — so both sides
 * can confirm the same day independently. Nothing here is visible to anyone
 * outside those two accounts.
 *
 * The purpose is provenance. A WageEntry is self-reported by the worker; an
 * engagement lets the employer corroborate it, which is what turns "I worked
 * seven days" into a record two parties agree on. See docs/SOCIAL_IMPACT.md.
 *
 * Lifecycle (enforced in routes/engagements.js, not here):
 *
 *   offered ──accept──> accepted ──confirm shift──> worked ──paid in full──> paid
 *      │                   │                         │
 *      │                   ├──no_show──> no_show     └──partial payment stays worked
 *      └──cancel──> cancelled <──cancel──┘
 *
 *   accepted | worked | paid | no_show ──dispute──> disputed   (terminal)
 *
 * paid, cancelled and disputed are terminal: money and provenance stop moving.
 *
 * Deliberately absent: no wage-slip document (Phase 2), no muster roll, no
 * compliance rules. `wage_slip_id` is reserved so Phase 2 can attach a slip
 * without migrating this collection.
 */
export const ENGAGEMENT_STATUSES = [
  "offered",
  "accepted",
  "worked",
  "paid",
  "no_show",
  "cancelled",
  "disputed",
];

/** Statuses a party may still cancel / withdraw from. */
export const CANCELLABLE_STATUSES = ["offered", "accepted"];

/** Statuses a dispute may be raised from. */
export const DISPUTABLE_STATUSES = ["accepted", "worked", "paid", "no_show"];

/**
 * Wage basis. `agreed_wage` is the rate for ONE unit of the basis:
 *   day   → per day        hour → per hour      piece → per piece
 *   week  → per week       month → per month
 *
 * `week`/`month` on a single work date are deliberately allowed (the plan's
 * enum includes them) but the amount owed for one date is the period rate.
 * Allocating a period rate across dates is Phase 2's wage-slip rule; this
 * model does not pretend to know it.
 */
export const WAGE_BASES = ["day", "hour", "piece", "week", "month"];

export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "other"];

/** Bases whose total depends on a measured quantity. */
const QUANTITY_BASES = { hour: "hours", piece: "units" };

const EngagementSchema = new Schema(
  {
    employer_account_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Snapshot of business_name || full_name at offer time: the wage record
    // must stay readable even if the employer later renames the business.
    employer_name: { type: String, required: true, trim: true, maxlength: 120 },

    worker_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    worker_code: { type: String, default: null }, // SS-XXXXXX snapshot
    worker_name: { type: String, required: true, trim: true, maxlength: 120 },
    occupation: { type: String, default: null, maxlength: 40 },

    // UTC calendar day, stored at midnight like WageEntry.work_date.
    work_date: { type: Date, required: true, index: true },

    wage_basis: { type: String, enum: WAGE_BASES, required: true },
    agreed_wage: { type: Number, required: true, min: 0 },
    hours: { type: Number, default: null, min: 0 }, // required for basis "hour"
    units: { type: Number, default: null, min: 0 }, // required for basis "piece"

    status: { type: String, enum: ENGAGEMENT_STATUSES, default: "offered", index: true },

    // Each side's own confirmation, kept separate on purpose: the worker
    // confirms they accepted the terms, the employer confirms the shift was
    // actually worked. Neither timestamp stands in for the other.
    worker_confirmed_at: { type: Date, default: null },
    employer_confirmed_at: { type: Date, default: null },

    offered_at: { type: Date, default: Date.now },
    accepted_at: { type: Date, default: null },
    worked_at: { type: Date, default: null },
    paid_at: { type: Date, default: null },
    cancelled_at: { type: Date, default: null },
    disputed_at: { type: Date, default: null },

    payment: {
      amount: { type: Number, default: null, min: 0 },
      method: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
      paid_at: { type: Date, default: null },
      reference: { type: String, default: null, maxlength: 80 },
    },

    // Reserved for Phase 2 (Form V wage slip). Never written this pass.
    wage_slip_id: { type: Schema.Types.ObjectId, ref: "WageSlip", default: null },

    dispute: {
      raised_by: { type: String, enum: ["employer", "worker", null], default: null },
      reason: { type: String, default: null, maxlength: 500 },
      opened_at: { type: Date, default: null },
    },

    note: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true, collection: "engagements" }
);

// One engagement per employer per worker per day. Two different employers may
// each engage the same worker on the same date; WageEntry's (worker, date)
// uniqueness is what forces that edge to be resolved at confirmation time.
EngagementSchema.index(
  { employer_account_id: 1, worker_id: 1, work_date: 1 },
  { unique: true }
);
EngagementSchema.index({ worker_id: 1, work_date: -1 });
EngagementSchema.index({ employer_account_id: 1, status: 1, work_date: -1 });

/** Amount owed for this engagement under its own agreed basis. */
EngagementSchema.methods.expectedAmount = function () {
  const rate = Number(this.agreed_wage) || 0;
  const quantityField = QUANTITY_BASES[this.wage_basis];
  const total = quantityField ? rate * (Number(this[quantityField]) || 0) : rate;
  return Math.round(total * 100) / 100;
};

/** True once the recorded payment covers the agreed amount. */
EngagementSchema.methods.isFullyPaid = function () {
  return (Number(this.payment?.amount) || 0) >= this.expectedAmount();
};

/**
 * Both parties read the same record — they are the only two people allowed to
 * see it. No phone numbers are included: contact already travelled through the
 * job listing / house request that produced the hire, and this record exists
 * for the money, not the introduction.
 */
EngagementSchema.methods.toJSON = function () {
  const expected = this.expectedAmount();
  return {
    id: String(this._id),
    employer: { id: String(this.employer_account_id), name: this.employer_name },
    worker: {
      id: String(this.worker_id),
      code: this.worker_code,
      name: this.worker_name,
    },
    occupation: this.occupation,
    work_date: this.work_date,
    wage_basis: this.wage_basis,
    agreed_wage: this.agreed_wage,
    hours: this.hours,
    units: this.units,
    expected_amount: expected,
    status: this.status,
    worker_confirmed_at: this.worker_confirmed_at,
    employer_confirmed_at: this.employer_confirmed_at,
    offered_at: this.offered_at,
    accepted_at: this.accepted_at,
    worked_at: this.worked_at,
    paid_at: this.paid_at,
    cancelled_at: this.cancelled_at,
    disputed_at: this.disputed_at,
    payment: {
      amount: this.payment?.amount ?? null,
      method: this.payment?.method ?? null,
      paid_at: this.payment?.paid_at ?? null,
      reference: this.payment?.reference ?? null,
      shortfall: Math.max(0, Math.round((expected - (this.payment?.amount ?? 0)) * 100) / 100),
    },
    wage_slip_id: this.wage_slip_id ? String(this.wage_slip_id) : null,
    dispute: {
      raised_by: this.dispute?.raised_by ?? null,
      reason: this.dispute?.reason ?? null,
      opened_at: this.dispute?.opened_at ?? null,
    },
    note: this.note,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

export const Engagement = mongoose.model("Engagement", EngagementSchema);
