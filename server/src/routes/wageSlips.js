import { Router } from "express";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Engagement } from "../models/Engagement.js";
import {
  WageSlip,
  FORM_SOURCE_NOTE,
  computeTotals,
  retainUntil,
} from "../models/WageSlip.js";
import { authenticate, requireEmployer, requireWorker, audit } from "../middleware/auth.js";
import { renderSlipHtml, renderSlipText, resolveLanguage } from "../services/wageSlipRender.js";

const router = Router();

const isOid = (id) => mongoose.isValidObjectId(id);
const notFound = (res) => res.status(404).json({ detail: "Wage slip not found" });
const cleanText = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

const reject = (res, status, code, detail, extra = {}) =>
  res.status(status).json({ detail, code, ...extra });

/**
 * Read one optional money field. Returns `absent: true` when the caller did not
 * supply it, so the slip can say "not recorded" instead of inventing a zero.
 */
function readAmount(raw, field) {
  if (raw === undefined || raw === null || raw === "") return { absent: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { error: `${field} must be a number ≥ 0` };
  return { absent: false, value: Math.round(n * 100) / 100 };
}

const paidAmountOf = (engagement) => Number(engagement?.payment?.amount) || 0;

const paymentDateOf = (engagement) =>
  engagement?.payment?.paid_at || engagement?.paid_at || null;

/**
 * A slip may be issued once the engagement is paid. A dispute raised AFTER full
 * payment does not un-pay the day, so it stays issuable — the slip is evidence,
 * and evidence is most needed once something is disputed.
 */
function isIssuable(engagement) {
  if (engagement.status === "paid") return true;
  if (engagement.status !== "disputed") return false;
  return paidAmountOf(engagement) >= engagement.expectedAmount();
}

function absentPaths({ establishment, employee, earnings, deductions }) {
  const absent = [];
  if (!establishment.address) absent.push("establishment.address");
  if (!establishment.registration_number) absent.push("establishment.registration_number");
  if (!employee.father_or_mother_or_spouse_name) absent.push("employee.father_or_mother_or_spouse_name");
  if (!employee.designation) absent.push("employee.designation");
  if (!employee.uan) absent.push("employee.uan");
  if (!employee.bank_account) absent.push("employee.bank_account");
  if (earnings.da === null) absent.push("earnings.da");
  if (earnings.allowances === null) absent.push("earnings.allowances");
  if (deductions.pf === null) absent.push("deductions.pf");
  if (deductions.esi === null) absent.push("deductions.esi");
  if (deductions.other === null) absent.push("deductions.other");
  return absent;
}

/**
 * Validate the caller's slip inputs against the engagement and the arithmetic.
 * Every failure carries a specific code — nothing is silently corrected.
 */
function buildSlipPayload({ engagement, body, employer }) {
  const paid = paidAmountOf(engagement);
  const paymentDate = paymentDateOf(engagement);
  if (!paymentDate) return { error: { status: 409, code: "engagement_not_paid", detail: "This engagement has no recorded payment." } };

  /* ── Earnings: basic / DA / allowances / overtime ── */
  const e = body?.earnings ?? {};
  const basicIn = readAmount(e.basic ?? body?.basic, "earnings.basic");
  const daIn = readAmount(e.da ?? body?.da, "earnings.da");
  const allowancesIn = readAmount(e.allowances ?? body?.allowances, "earnings.allowances");
  const overtimeIn = readAmount(e.overtime ?? body?.overtime, "earnings.overtime");
  for (const part of [basicIn, daIn, allowancesIn, overtimeIn]) {
    if (part.error) return { error: { status: 422, code: "invalid_amount", detail: part.error } };
  }

  // No split supplied at all → the whole paid amount is basic wages, and DA /
  // allowances stay absent rather than being invented as zeroes.
  const anySupplied = !basicIn.absent || !daIn.absent || !allowancesIn.absent || !overtimeIn.absent;
  if (basicIn.absent && anySupplied) {
    return {
      error: {
        status: 422,
        code: "basic_required",
        detail: "Supply basic wages together with any DA / allowances, or supply no split at all.",
      },
    };
  }
  const basic = basicIn.absent ? paid : basicIn.value;

  const earnings = {
    basic,
    da: daIn.absent ? null : daIn.value,
    allowances: allowancesIn.absent ? null : allowancesIn.value,
    overtime: overtimeIn.absent ? 0 : overtimeIn.value,
  };

  /* ── Deductions ── */
  const d = body?.deductions ?? {};
  const pfIn = readAmount(d.pf ?? body?.pf, "deductions.pf");
  const esiIn = readAmount(d.esi ?? body?.esi, "deductions.esi");
  const otherIn = readAmount(d.other ?? body?.other, "deductions.other");
  for (const part of [pfIn, esiIn, otherIn]) {
    if (part.error) return { error: { status: 422, code: "invalid_amount", detail: part.error } };
  }
  const deductions = {
    pf: pfIn.absent ? null : pfIn.value,
    esi: esiIn.absent ? null : esiIn.value,
    other: otherIn.absent ? null : otherIn.value,
  };

  const totals = computeTotals({ ...earnings, ...deductions });

  // 1. gross = basic + DA + allowances + overtime, and it must equal what was paid.
  if (Math.abs(totals.gross_wages - paid) > 0.005) {
    return {
      error: {
        status: 422,
        code: "gross_mismatch",
        detail: `Gross wages (${totals.gross_wages}) must equal the amount paid (${paid}).`,
        gross_wages: totals.gross_wages,
        paid_amount: paid,
      },
    };
  }

  // 2. Deductions never exceed half the period wages.
  if (totals.total_deductions > Math.round((totals.gross_wages / 2) * 100) / 100 + 1e-6) {
    return {
      error: {
        status: 422,
        code: "deductions_exceed_half",
        detail: `Total deductions (${totals.total_deductions}) may not exceed half the period wages.`,
        max_deductions: Math.round((totals.gross_wages / 2) * 100) / 100,
      },
    };
  }

  // 3. net is never negative. Unreachable behind rule 2, kept as a hard stop so
  //    a future change to the cap cannot quietly produce a negative slip.
  if (totals.net_wages < 0) {
    return {
      error: {
        status: 422,
        code: "net_negative",
        detail: "Net wages would be negative.",
        net_wages: totals.net_wages,
      },
    };
  }

  /* ── Dates ── */
  const issueDate = body?.issue_date ? new Date(body.issue_date) : new Date(paymentDate);
  if (Number.isNaN(issueDate.getTime())) {
    return { error: { status: 422, code: "invalid_issue_date", detail: "issue_date must be a valid date." } };
  }
  // 4. A slip is never dated after the payment it evidences.
  if (issueDate.getTime() > new Date(paymentDate).getTime()) {
    return {
      error: {
        status: 422,
        code: "slip_after_payment",
        detail: "The slip cannot be dated after the payment it evidences.",
        payment_date: new Date(paymentDate).toISOString(),
      },
    };
  }

  /* ── Period and attendance ── */
  const periodDays = body?.wage_period_days === undefined ? 1 : Number(body.wage_period_days);
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 31) {
    return {
      error: {
        status: 422,
        code: "invalid_wage_period_days",
        detail: "wage_period_days must be a whole number between 1 and 31.",
      },
    };
  }

  let attendanceKind = "day";
  let attendanceValue = periodDays;
  if (engagement.wage_basis === "piece") {
    attendanceKind = "unit";
    attendanceValue = engagement.units ?? null;
  } else if (engagement.wage_basis === "hour") {
    attendanceKind = "unit";
    attendanceValue = engagement.hours ?? null;
  }
  if (body?.attendance_value !== undefined && body?.attendance_value !== null) {
    const n = Number(body.attendance_value);
    if (!Number.isFinite(n) || n < 0) {
      return { error: { status: 422, code: "invalid_attendance", detail: "attendance_value must be a number ≥ 0." } };
    }
    attendanceValue = n;
  }
  if (body?.attendance_kind) {
    if (!["day", "unit"].includes(String(body.attendance_kind))) {
      return { error: { status: 422, code: "invalid_attendance", detail: "attendance_kind must be day or unit." } };
    }
    attendanceKind = String(body.attendance_kind);
  }

  /* ── Identity blocks ── */
  const employeeIn = body?.employee ?? {};
  const employee = {
    name: engagement.worker_name,
    code: engagement.worker_code ?? null,
    father_or_mother_or_spouse_name: cleanText(
      employeeIn.father_or_mother_or_spouse_name ?? body?.father_or_mother_or_spouse_name,
      120
    ),
    designation: cleanText(employeeIn.designation ?? body?.designation, 80),
    uan: cleanText(employeeIn.uan ?? body?.uan, 20),
    bank_account: cleanText(employeeIn.bank_account ?? body?.bank_account, 40),
  };

  const establishment = {
    name: engagement.employer_name,
    address: cleanText(body?.establishment_address ?? body?.establishment?.address, 300),
    registration_number: cleanText(
      body?.establishment_registration_number ?? body?.establishment?.registration_number,
      60
    ),
  };

  const language = resolveLanguage(body?.language ?? employer?.preferred_language ?? "en");

  return {
    value: {
      language,
      issue_date: issueDate,
      establishment,
      wage_period: { from: engagement.work_date, to: engagement.work_date, days: periodDays },
      employee,
      attendance: { kind: attendanceKind, value: attendanceValue },
      earnings,
      gross_wages: totals.gross_wages,
      deductions,
      total_deductions: totals.total_deductions,
      net_wages: totals.net_wages,
      signature: {
        name: employer.business_name || employer.full_name,
        place: cleanText(body?.place, 120),
      },
      // Fixed by the platform, never caller-supplied: the sentence that says what
      // this document is (and is not) must not be replaceable by the party it
      // documents.
      form_source_note: FORM_SOURCE_NOTE,
      retain_until: retainUntil(issueDate),
      absent_fields: absentPaths({ establishment, employee, earnings, deductions }),
    },
  };
}

/** Slip numbers are derived from the id so they are stable and collision-free. */
function slipNumberFor(id) {
  return `WS-${String(id).slice(-8).toUpperCase()}`;
}

async function loadEmployer(req, res) {
  const employer = await User.findById(req.userId);
  if (!employer || employer.role !== "employer") {
    res.status(401).json({ detail: "Not authenticated" });
    return null;
  }
  return employer;
}

// ── Issue a slip from a paid engagement ──────────────────────────────
router.post("/", authenticate, requireEmployer, async (req, res) => {
  try {
    if (!isOid(req.body?.engagement_id)) {
      return reject(res, 422, "invalid_engagement", "engagement_id must be an engagement id");
    }
    const engagement = await Engagement.findById(req.body.engagement_id);
    if (!engagement) return reject(res, 404, "engagement_not_found", "Engagement not found");
    // Only the employer party may issue: a worker cannot write the employer's own
    // statutory document for them.
    if (String(engagement.employer_account_id) !== String(req.userId)) {
      return reject(res, 404, "engagement_not_found", "Engagement not found");
    }
    if (!isIssuable(engagement)) {
      return reject(
        res,
        409,
        "engagement_not_paid",
        "A wage slip can be issued only once the engagement has been paid in full.",
        { status: engagement.status }
      );
    }

    const live = await WageSlip.findOne({ engagement_id: engagement._id, status: "issued" }).select("_id");
    if (live) {
      return reject(
        res,
        409,
        "slip_exists",
        "A slip already exists for this engagement. Issue a correction with the supersede endpoint.",
        { wage_slip_id: String(live._id) }
      );
    }

    const employer = await loadEmployer(req, res);
    if (!employer) return;

    const built = buildSlipPayload({ engagement, body: req.body, employer });
    if (built.error) {
      const { status, code, detail, ...extra } = built.error;
      return reject(res, status, code, detail, extra);
    }

    const _id = new mongoose.Types.ObjectId();
    const slip = await WageSlip.create({
      _id,
      slip_number: slipNumberFor(_id),
      status: "issued",
      engagement_id: engagement._id,
      worker_id: engagement.worker_id,
      employer_account_id: engagement.employer_account_id,
      ...built.value,
    });

    // The confirmed day now points at its slip.
    engagement.wage_slip_id = slip._id;
    await engagement.save();

    await audit({
      actorRole: "employer",
      actorIdentifier: String(req.userId),
      action: "wage_slip.issued",
      resourceType: "wage_slip",
      resourceId: String(slip._id),
      ip: req.ip,
      success: true,
    });

    res.status(201).json({ wage_slip: slip.toJSON() });
  } catch (err) {
    console.error("[wage-slips]", err);
    res.status(500).json({ detail: "Could not issue the wage slip." });
  }
});

// ── Issue a correction that supersedes a slip ────────────────────────
router.post("/:id/supersede", authenticate, requireEmployer, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return notFound(res);
    const previous = await WageSlip.findById(req.params.id);
    if (!previous) return notFound(res);
    if (String(previous.employer_account_id) !== String(req.userId)) return notFound(res);
    if (previous.status === "superseded") {
      return reject(res, 409, "slip_superseded", "This slip has already been superseded.");
    }

    const engagement = await Engagement.findById(previous.engagement_id);
    if (!engagement) return reject(res, 404, "engagement_not_found", "Engagement not found");
    if (!isIssuable(engagement)) {
      return reject(res, 409, "engagement_not_paid", "The engagement is no longer in a paid state.", {
        status: engagement.status,
      });
    }

    const employer = await loadEmployer(req, res);
    if (!employer) return;

    const built = buildSlipPayload({ engagement, body: req.body, employer });
    if (built.error) {
      const { status, code, detail, ...extra } = built.error;
      return reject(res, status, code, detail, extra);
    }

    const _id = new mongoose.Types.ObjectId();
    const slip = await WageSlip.create({
      _id,
      slip_number: slipNumberFor(_id),
      status: "issued",
      engagement_id: engagement._id,
      worker_id: engagement.worker_id,
      employer_account_id: engagement.employer_account_id,
      supersedes: previous._id,
      ...built.value,
    });

    // The ONLY write a issued slip ever takes: the supersession link. Its
    // figures are never touched, which is what makes the correction auditable.
    previous.status = "superseded";
    previous.superseded_by = slip._id;
    await previous.save();

    engagement.wage_slip_id = slip._id;
    await engagement.save();

    await audit({
      actorRole: "employer",
      actorIdentifier: String(req.userId),
      action: "wage_slip.superseded",
      resourceType: "wage_slip",
      resourceId: String(slip._id),
      ip: req.ip,
      success: true,
    });

    res.status(201).json({ wage_slip: slip.toJSON(), superseded: previous.toJSON() });
  } catch (err) {
    console.error("[wage-slips/supersede]", err);
    res.status(500).json({ detail: "Could not supersede the wage slip." });
  }
});

// ── The worker's own slips ───────────────────────────────────────────
router.get("/mine", authenticate, requireWorker, async (req, res) => {
  try {
    const slips = await WageSlip.find({ worker_id: req.userId })
      .sort({ issue_date: -1, createdAt: -1 })
      .limit(100);
    res.json({ wage_slips: slips.map((s) => s.toJSON()) });
  } catch (err) {
    console.error("[wage-slips/mine]", err);
    res.status(500).json({ detail: "Could not load your wage slips." });
  }
});

async function loadParty(req, res) {
  if (!isOid(req.params.id)) {
    notFound(res);
    return null;
  }
  const slip = await WageSlip.findById(req.params.id);
  if (!slip) {
    notFound(res);
    return null;
  }
  const isParty =
    String(slip.worker_id) === String(req.userId) ||
    String(slip.employer_account_id) === String(req.userId);
  if (!isParty) {
    notFound(res);
    return null;
  }
  return slip;
}

// ── One slip (JSON) ──────────────────────────────────────────────────
router.get("/:id", authenticate, async (req, res) => {
  try {
    const slip = await loadParty(req, res);
    if (!slip) return;
    res.json({ wage_slip: slip.toJSON() });
  } catch (err) {
    console.error("[wage-slips/get]", err);
    res.status(500).json({ detail: "Could not load the wage slip." });
  }
});

// ── Printable HTML (the browser makes the PDF) ───────────────────────
router.get("/:id/print", authenticate, async (req, res) => {
  try {
    const slip = await loadParty(req, res);
    if (!slip) return;
    const language = req.query.language ? String(req.query.language) : slip.language;
    res.type("html").send(renderSlipHtml(slip.toJSON(), resolveLanguage(language)));
  } catch (err) {
    console.error("[wage-slips/print]", err);
    res.status(500).json({ detail: "Could not render the wage slip." });
  }
});

// ── Plain text for WhatsApp / SMS ────────────────────────────────────
router.get("/:id/text", authenticate, async (req, res) => {
  try {
    const slip = await loadParty(req, res);
    if (!slip) return;
    const requested = req.query.language ? String(req.query.language) : slip.language;
    const language = resolveLanguage(requested);
    // The body is plain text, so the language actually rendered is echoed in a
    // header (an unsupported ?language= falls back to en, silently otherwise).
    res.type("text/plain; charset=utf-8");
    res.set("X-Slip-Language", language);
    res.send(renderSlipText(slip.toJSON(), language));
  } catch (err) {
    console.error("[wage-slips/text]", err);
    res.status(500).json({ detail: "Could not render the wage slip." });
  }
});

export default router;
