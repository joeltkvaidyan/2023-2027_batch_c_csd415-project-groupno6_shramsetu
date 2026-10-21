import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * WageSlip — the Form V wage slip for one paid Engagement.
 *
 * Issued from a `paid` engagement (or one that was paid and later disputed),
 * never edited afterwards. A correction is a NEW slip that supersedes the old
 * one: the old row keeps its figures and gains `superseded_by` + status
 * "superseded". Nothing in this collection is ever updated in place apart from
 * that supersession link.
 *
 * The field order below follows Form V of the Wages (Central) Rules 2026:
 * date of issue, establishment, wage period, employee, relation name,
 * designation, UAN, bank account, wage-period days, rate of wages split into
 * basic / DA / allowances, attendance, overtime, gross, deductions split
 * PF / ESI / other, net, and the employer's signature block.
 *
 * Fields we do not hold are stored as null and listed in `absent_fields` — a
 * blank on the slip is honest; a plausible-looking invention is not.
 *
 * Arithmetic is NOT stored from the client: the tests exercise the guards in
 * routes/wageSlips.js, and the totals here are always recomputed from the
 * components by `computeTotals`.
 */
export const WAGE_SLIP_STATUSES = ["issued", "superseded"];

export const SLIP_LANGUAGES = ["en", "hi", "ml", "ta", "te", "bn"];

export const FORM_SOURCE_NOTE =
  "Derived from the Code on Wages 2019 and the Wages (Central) Rules 2026 (Form V). " +
  "State rules may differ, and this slip is not a filing with any authority.";

/** Retention: five years, per the Rules' record-keeping requirement. */
export const RETAIN_YEARS = 5;

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * gross = basic + DA + allowances + overtime.
 * A null component contributes 0 and stays null on the document, so "not
 * recorded" is never silently turned into a zero the reader would trust.
 */
export function computeTotals({ basic, da, allowances, overtime, pf, esi, other }) {
  const gross_wages = round2(
    (Number(basic) || 0) +
      (Number(da) || 0) +
      (Number(allowances) || 0) +
      (Number(overtime) || 0)
  );
  const total_deductions = round2((Number(pf) || 0) + (Number(esi) || 0) + (Number(other) || 0));
  const net_wages = round2(gross_wages - total_deductions);
  return { gross_wages, total_deductions, net_wages };
}

/** Five years on from the issue date, in UTC. */
export function retainUntil(issueDate) {
  const d = new Date(issueDate);
  d.setUTCFullYear(d.getUTCFullYear() + RETAIN_YEARS);
  return d;
}

const WageSlipSchema = new Schema(
  {
    slip_number: { type: String, required: true, unique: true },
    status: { type: String, enum: WAGE_SLIP_STATUSES, default: "issued", index: true },

    engagement_id: { type: Schema.Types.ObjectId, ref: "Engagement", required: true, index: true },
    worker_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    employer_account_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    language: { type: String, enum: SLIP_LANGUAGES, default: "en" },
    issue_date: { type: Date, required: true },

    establishment: {
      name: { type: String, required: true, trim: true, maxlength: 160 },
      address: { type: String, default: null, maxlength: 300 },
      registration_number: { type: String, default: null, maxlength: 60 },
    },

    wage_period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      days: { type: Number, required: true, min: 0 },
    },

    employee: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      code: { type: String, default: null, maxlength: 20 },
      father_or_mother_or_spouse_name: { type: String, default: null, maxlength: 120 },
      designation: { type: String, default: null, maxlength: 80 },
      uan: { type: String, default: null, maxlength: 20 },
      bank_account: { type: String, default: null, maxlength: 40 },
    },

    attendance: {
      kind: { type: String, enum: ["day", "unit"], default: "day" },
      value: { type: Number, default: null, min: 0 },
    },

    earnings: {
      basic: { type: Number, required: true, min: 0 },
      da: { type: Number, default: null, min: 0 },
      allowances: { type: Number, default: null, min: 0 },
      overtime: { type: Number, default: 0, min: 0 },
    },

    gross_wages: { type: Number, required: true, min: 0 },

    deductions: {
      pf: { type: Number, default: null, min: 0 },
      esi: { type: Number, default: null, min: 0 },
      other: { type: Number, default: null, min: 0 },
    },
    total_deductions: { type: Number, required: true, min: 0 },
    net_wages: { type: Number, required: true, min: 0 },

    signature: {
      name: { type: String, required: true, maxlength: 120 },
      place: { type: String, default: null, maxlength: 120 },
    },

    form_source_note: { type: String, required: true },
    retain_until: { type: Date, required: true },

    /** Dotted paths of statutory fields we could not fill. Read by the renderer. */
    absent_fields: { type: [String], default: [] },

    supersedes: { type: Schema.Types.ObjectId, ref: "WageSlip", default: null },
    superseded_by: { type: Schema.Types.ObjectId, ref: "WageSlip", default: null },
  },
  { timestamps: true, collection: "wage_slips" }
);

WageSlipSchema.index({ engagement_id: 1, status: 1 });
WageSlipSchema.index({ worker_id: 1, issue_date: -1 });

WageSlipSchema.methods.toJSON = function () {
  return {
    id: String(this._id),
    slip_number: this.slip_number,
    status: this.status,
    engagement_id: String(this.engagement_id),
    worker_id: String(this.worker_id),
    employer_account_id: String(this.employer_account_id),
    language: this.language,
    issue_date: this.issue_date,
    establishment: {
      name: this.establishment?.name ?? null,
      address: this.establishment?.address ?? null,
      registration_number: this.establishment?.registration_number ?? null,
    },
    wage_period: {
      from: this.wage_period?.from ?? null,
      to: this.wage_period?.to ?? null,
      days: this.wage_period?.days ?? null,
    },
    employee: {
      name: this.employee?.name ?? null,
      code: this.employee?.code ?? null,
      father_or_mother_or_spouse_name: this.employee?.father_or_mother_or_spouse_name ?? null,
      designation: this.employee?.designation ?? null,
      uan: this.employee?.uan ?? null,
      bank_account: this.employee?.bank_account ?? null,
    },
    attendance: { kind: this.attendance?.kind ?? "day", value: this.attendance?.value ?? null },
    earnings: {
      basic: this.earnings?.basic ?? null,
      da: this.earnings?.da ?? null,
      allowances: this.earnings?.allowances ?? null,
      overtime: this.earnings?.overtime ?? 0,
    },
    gross_wages: this.gross_wages,
    deductions: {
      pf: this.deductions?.pf ?? null,
      esi: this.deductions?.esi ?? null,
      other: this.deductions?.other ?? null,
    },
    total_deductions: this.total_deductions,
    net_wages: this.net_wages,
    signature: { name: this.signature?.name ?? null, place: this.signature?.place ?? null },
    form_source_note: this.form_source_note,
    retain_until: this.retain_until,
    absent_fields: this.absent_fields ?? [],
    supersedes: this.supersedes ? String(this.supersedes) : null,
    superseded_by: this.superseded_by ? String(this.superseded_by) : null,
    created_at: this.createdAt,
    updated_at: this.updatedAt,
  };
};

export const WageSlip = mongoose.model("WageSlip", WageSlipSchema);
