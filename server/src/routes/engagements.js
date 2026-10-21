import { Router } from "express";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { WageEntry } from "../models/WageEntry.js";
import {
  Engagement,
  WAGE_BASES,
  PAYMENT_METHODS,
  CANCELLABLE_STATUSES,
  DISPUTABLE_STATUSES,
} from "../models/Engagement.js";
import { authenticate, requireEmployer, requireWorker, audit } from "../middleware/auth.js";

const router = Router();

const fail = (res, err, msg) => {
  console.error("[engagements]", err);
  res.status(500).json({ detail: msg });
};

const isOid = (id) => mongoose.isValidObjectId(id);
const cleanText = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** UTC calendar day → [start, end), the same convention WageEntry uses. */
function dayBounds(workDate) {
  const start = new Date(workDate);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function parseWorkDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

/** paid / partial / unpaid from money alone — never from a client field. */
function paymentStatusFor(paidAmount, agreedAmount) {
  const paid = Number(paidAmount) || 0;
  const agreed = Number(agreedAmount) || 0;
  if (paid <= 0) return "unpaid";
  return paid >= agreed ? "paid" : "partial";
}

/**
 * Validate the offer terms. `hours` and `units` are the measured quantity for
 * the bases that need one; both are optional for the others.
 */
function validateTerms(body) {
  const wage_basis = String(body?.wage_basis || "").trim();
  if (!WAGE_BASES.includes(wage_basis)) {
    return { error: `wage_basis must be one of: ${WAGE_BASES.join(", ")}` };
  }

  const agreed_wage = Number(body?.agreed_wage);
  if (!Number.isFinite(agreed_wage) || agreed_wage < 0) {
    return { error: "agreed_wage must be a number ≥ 0" };
  }

  let hours = null;
  if (body?.hours !== undefined && body?.hours !== null && body?.hours !== "") {
    hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0) return { error: "hours must be a number > 0" };
    if (hours > 24) return { error: "hours cannot exceed 24 in one work day" };
  }

  let units = null;
  if (body?.units !== undefined && body?.units !== null && body?.units !== "") {
    units = Number(body.units);
    if (!Number.isFinite(units) || units <= 0) return { error: "units must be a number > 0" };
  }

  if (wage_basis === "hour" && !hours) return { error: "hours is required when wage_basis is hour" };
  if (wage_basis === "piece" && !units) return { error: "units is required when wage_basis is piece" };

  return { value: { wage_basis, agreed_wage, hours, units } };
}

const notFound = (res) => res.status(404).json({ detail: "Engagement not found" });

const invalidTransition = (res, engagement, action) =>
  res.status(409).json({
    detail: `Cannot ${action} an engagement that is ${engagement.status}.`,
    code: "invalid_transition",
    status: engagement.status,
  });

function respond(res, code, engagement, wageEntry = null, extra = {}) {
  res.status(code).json({
    engagement: engagement.toJSON(),
    wage_entry: wageEntry ? wageEntry.toJSON() : null,
    ...extra,
  });
}

/**
 * Write the employer's confirmation into the worker's wage diary.
 *
 * Three cases, and the difference matters:
 *
 *  1. No entry for that day → create one, already employer-confirmed.
 *  2. An entry the worker self-reported → upgrade it in place. The employer's
 *     agreed figure replaces the self-reported amount because it is the figure
 *     both sides confirmed; money already recorded as RECEIVED is never
 *     reduced. Provenance becomes "mutual".
 *  3. An entry already marked fully paid → the paid-day lock wins. Provenance is
 *     attached and nothing else is touched: a settled day does not get its
 *     amounts rewritten by a later confirmation.
 *
 * Returns { conflict: true } when the day already belongs to a DIFFERENT
 * engagement. WageEntry is unique per (worker, day), so one employer's
 * confirmation cannot silently hijack another's record — the caller refuses.
 */
async function recordWorkedInWageDiary(engagement, now) {
  const expected = engagement.expectedAmount();
  const { start, end } = dayBounds(engagement.work_date);

  const existing = await WageEntry.findOne({
    worker_id: engagement.worker_id,
    work_date: { $gte: start, $lt: end },
  });

  if (
    existing &&
    existing.engagement_id &&
    String(existing.engagement_id) !== String(engagement._id)
  ) {
    return { conflict: true };
  }

  if (existing) {
    const wasPaid = existing.payment_status === "paid";

    existing.engagement_id = engagement._id;
    existing.employer_account_id = engagement.employer_account_id;
    existing.confirmed_at = now;
    existing.source = "mutual"; // worker reported it; the employer now confirms it

    if (!wasPaid) {
      existing.employer_name = engagement.employer_name;
      existing.agreed_amount = expected;
      existing.payment_status = paymentStatusFor(existing.paid_amount, existing.agreed_amount);
    }

    await existing.save();
    return { entry: existing, locked: wasPaid };
  }

  const created = await WageEntry.create({
    worker_id: engagement.worker_id,
    work_date: engagement.work_date,
    employer_name: engagement.employer_name,
    agreed_amount: expected,
    paid_amount: 0,
    payment_status: "unpaid",
    engagement_id: engagement._id,
    employer_account_id: engagement.employer_account_id,
    source: "employer_confirmed",
    confirmed_at: now,
  });

  return { entry: created, created: true };
}

/**
 * Mirror the payment into the wage diary. The paid-day lock is respected the
 * same way it is on the worker's own POST /wages: a day already marked paid is
 * never rewritten.
 */
async function recordPaymentInWageDiary(engagement) {
  const { start, end } = dayBounds(engagement.work_date);
  const entry = await WageEntry.findOne({
    worker_id: engagement.worker_id,
    work_date: { $gte: start, $lt: end },
  });

  if (!entry) return { entry: null };
  if (String(entry.engagement_id ?? "") !== String(engagement._id)) {
    return { entry, conflict: true };
  }
  if (entry.payment_status === "paid") return { entry, locked: true };

  entry.paid_amount = engagement.payment.amount;
  entry.payment_status = paymentStatusFor(engagement.payment.amount, entry.agreed_amount);
  await entry.save();
  return { entry };
}

// ── Employer offers an engagement ────────────────────────────────────
//
// Deliberately NOT behind requireGovAcceptedEmployer. That gate exists for
// actions that earn public visibility (posting a listing, rating a worker).
// An engagement is a private record between two accounts, and refusing to let a
// pending employer corroborate a worker's day would leave the worker without
// the evidence — the exact problem this feature exists to fix.
router.post("/", authenticate, requireEmployer, async (req, res) => {
  try {
    if (!isOid(req.body?.worker_id)) {
      return res.status(422).json({ detail: "worker_id must be a worker account id" });
    }
    const workDate = parseWorkDate(req.body?.work_date);
    if (!workDate) {
      return res.status(422).json({ detail: "work_date must be YYYY-MM-DD" });
    }
    const { value, error } = validateTerms(req.body);
    if (error) return res.status(422).json({ detail: error });

    const employer = await User.findById(req.userId);
    if (!employer || employer.role !== "employer") {
      return res.status(401).json({ detail: "Not authenticated" });
    }

    const worker = await User.findById(req.body.worker_id).select(
      "role full_name worker_id occupation is_active"
    );
    if (!worker || worker.role !== "worker" || worker.is_active === false) {
      return res.status(422).json({ detail: "worker_id must be an active worker account" });
    }

    const engagement = await Engagement.create({
      employer_account_id: employer._id,
      employer_name: employer.business_name || employer.full_name,
      worker_id: worker._id,
      worker_code: worker.worker_id ?? null,
      worker_name: worker.full_name,
      occupation: worker.occupation ?? null,
      work_date: workDate,
      ...value,
      status: "offered",
      offered_at: new Date(),
      note: cleanText(req.body?.note, 300),
    });

    await audit({
      actorRole: "employer",
      actorIdentifier: String(employer._id),
      action: "engagement.offered",
      resourceType: "engagement",
      resourceId: String(engagement._id),
      ip: req.ip,
      success: true,
    });

    respond(res, 201, engagement);
  } catch (err) {
    // Unique (employer, worker, date): one engagement per pair per day.
    if (err?.code === 11000) {
      return res.status(409).json({
        detail: "You already have an engagement with this worker on that date.",
        code: "engagement_exists",
      });
    }
    fail(res, err, "Could not create the engagement.");
  }
});

// ── Both parties: my engagements ─────────────────────────────────────
router.get("/mine", authenticate, async (req, res) => {
  try {
    let filter;
    if (req.userRole === "employer") filter = { employer_account_id: req.userId };
    else if (req.userRole === "worker") filter = { worker_id: req.userId };
    else return res.status(403).json({ detail: "Employer or worker access required" });

    const engagements = await Engagement.find(filter).sort({ work_date: -1, createdAt: -1 }).limit(200);
    res.json({
      role: req.userRole,
      engagements: engagements.map((e) => e.toJSON()),
    });
  } catch (err) {
    fail(res, err, "Could not load engagements.");
  }
});

// ── Both parties: one engagement ─────────────────────────────────────
router.get("/:id", authenticate, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return notFound(res);
    const engagement = await Engagement.findById(req.params.id);
    if (!engagement) return notFound(res);

    const isParty =
      String(engagement.employer_account_id) === String(req.userId) ||
      String(engagement.worker_id) === String(req.userId);
    // A non-party gets the same 404 as a missing record: neither the existence
    // nor the terms of someone else's hire are disclosed.
    if (!isParty) return notFound(res);

    res.json({ role: req.userRole, engagement: engagement.toJSON() });
  } catch (err) {
    fail(res, err, "Could not load the engagement.");
  }
});

// ── Worker accepts the terms ─────────────────────────────────────────
router.post("/:id/accept", authenticate, requireWorker, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return notFound(res);
    const engagement = await Engagement.findById(req.params.id);
    if (!engagement) return notFound(res);
    // Only the worker who was offered the engagement may accept it.
    if (String(engagement.worker_id) !== String(req.userId)) return notFound(res);
    if (engagement.status !== "offered") return invalidTransition(res, engagement, "accept");

    const now = new Date();
    engagement.status = "accepted";
    engagement.accepted_at = now;
    engagement.worker_confirmed_at = now;
    await engagement.save();

    await audit({
      actorRole: "worker",
      actorIdentifier: engagement.worker_code || String(req.userId),
      action: "engagement.accepted",
      resourceType: "engagement",
      resourceId: String(engagement._id),
      ip: req.ip,
      success: true,
    });

    respond(res, 200, engagement);
  } catch (err) {
    fail(res, err, "Could not accept the engagement.");
  }
});

// ── Employer confirms the shift was worked ───────────────────────────
// This is the step that writes the wage diary. The employer may refine the
// measured quantity (actual hours on site, pieces produced) — an estimate at
// offer time is not a record of what happened.
router.post("/:id/worked", authenticate, requireEmployer, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return notFound(res);
    const engagement = await Engagement.findById(req.params.id);
    if (!engagement) return notFound(res);
    if (String(engagement.employer_account_id) !== String(req.userId)) return notFound(res);
    if (engagement.status !== "accepted") return invalidTransition(res, engagement, "confirm");

    if (req.body?.hours !== undefined || req.body?.units !== undefined) {
      const { value, error } = validateTerms({
        wage_basis: engagement.wage_basis,
        agreed_wage: engagement.agreed_wage,
        hours: req.body?.hours ?? engagement.hours,
        units: req.body?.units ?? engagement.units,
      });
      if (error) return res.status(422).json({ detail: error });
      engagement.hours = value.hours;
      engagement.units = value.units;
    }

    const now = new Date();
    // Write the diary row first: if saving the engagement then fails, the entry
    // is already linked to THIS engagement, so retrying is idempotent instead
    // of leaving a worked day with no record.
    const synced = await recordWorkedInWageDiary(engagement, now);
    if (synced.conflict) {
      return res.status(409).json({
        detail:
          "That work date is already recorded against a different engagement. One day has one wage record — sort the other engagement out first.",
        code: "wage_entry_conflict",
      });
    }

    engagement.status = "worked";
    engagement.worked_at = now;
    engagement.employer_confirmed_at = now;
    await engagement.save();

    await audit({
      actorRole: "employer",
      actorIdentifier: String(req.userId),
      action: "engagement.worked",
      resourceType: "engagement",
      resourceId: String(engagement._id),
      ip: req.ip,
      success: true,
    });

    respond(res, 200, engagement, synced.entry, {
      wage_entry_created: Boolean(synced.created),
      wage_entry_locked: Boolean(synced.locked),
    });
  } catch (err) {
    fail(res, err, "Could not confirm the shift.");
  }
});

// ── Employer records payment ─────────────────────────────────────────
router.post("/:id/payment", authenticate, requireEmployer, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return notFound(res);
    const engagement = await Engagement.findById(req.params.id);
    if (!engagement) return notFound(res);
    if (String(engagement.employer_account_id) !== String(req.userId)) return notFound(res);
    if (engagement.status !== "worked") return invalidTransition(res, engagement, "record payment for");

    const expected = engagement.expectedAmount();
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(422).json({ detail: "amount must be a number ≥ 0" });
    }
    // Payment cannot exceed what the agreed basis says is owed.
    if (amount > expected) {
      return res.status(422).json({
        detail: `amount (${amount}) exceeds what the agreed basis owes (${expected}).`,
        code: "payment_exceeds_agreed",
        expected_amount: expected,
      });
    }

    const method = cleanText(req.body?.method, 20) || "cash";
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(422).json({ detail: `method must be one of: ${PAYMENT_METHODS.join(", ")}` });
    }

    const previous = Number(engagement.payment?.amount) || 0;
    // A recorded payment can be topped up, never walked back.
    if (amount < previous) {
      return res.status(409).json({
        detail: `A recorded payment cannot be reduced (${previous} already recorded).`,
        code: "payment_cannot_decrease",
      });
    }

    const now = new Date();
    const paidAt = req.body?.paid_at ? new Date(req.body.paid_at) : now;
    if (Number.isNaN(paidAt.getTime())) {
      return res.status(422).json({ detail: "paid_at must be a valid date" });
    }

    engagement.payment = {
      amount,
      method,
      paid_at: paidAt,
      reference: cleanText(req.body?.reference, 80),
    };
    // Full settlement is the only way out of `worked`; a shortfall is recorded
    // and left visible rather than called "paid".
    if (amount >= expected) {
      engagement.status = "paid";
      engagement.paid_at = paidAt;
    }

    const synced = await recordPaymentInWageDiary(engagement);
    await engagement.save();

    await audit({
      actorRole: "employer",
      actorIdentifier: String(req.userId),
      action: "engagement.payment",
      resourceType: "engagement",
      resourceId: String(engagement._id),
      ip: req.ip,
      success: true,
    });

    respond(res, 200, engagement, synced.entry, {
      wage_entry_locked: Boolean(synced.locked),
    });
  } catch (err) {
    fail(res, err, "Could not record the payment.");
  }
});

// ── Employer marks a no-show ─────────────────────────────────────────
router.post("/:id/no-show", authenticate, requireEmployer, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return notFound(res);
    const engagement = await Engagement.findById(req.params.id);
    if (!engagement) return notFound(res);
    if (String(engagement.employer_account_id) !== String(req.userId)) return notFound(res);
    if (engagement.status !== "accepted") return invalidTransition(res, engagement, "mark a no-show for");

    engagement.status = "no_show";
    engagement.worked_at = null;
    await engagement.save();

    await audit({
      actorRole: "employer",
      actorIdentifier: String(req.userId),
      action: "engagement.no_show",
      resourceType: "engagement",
      resourceId: String(engagement._id),
      ip: req.ip,
      success: true,
    });

    respond(res, 200, engagement);
  } catch (err) {
    fail(res, err, "Could not record the no-show.");
  }
});

// ── Either party cancels / withdraws ─────────────────────────────────
// A worker withdrawing from an offer is recorded as `cancelled`: there is no
// separate "declined" status, and inventing one would split the same fact.
router.post("/:id/cancel", authenticate, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return notFound(res);
    const engagement = await Engagement.findById(req.params.id);
    if (!engagement) return notFound(res);

    const isEmployer = String(engagement.employer_account_id) === String(req.userId);
    const isWorker = String(engagement.worker_id) === String(req.userId);
    if (!isEmployer && !isWorker) return notFound(res);

    if (!CANCELLABLE_STATUSES.includes(engagement.status)) {
      return invalidTransition(res, engagement, "cancel");
    }

    engagement.status = "cancelled";
    engagement.cancelled_at = new Date();
    await engagement.save();

    await audit({
      actorRole: isEmployer ? "employer" : "worker",
      actorIdentifier: String(req.userId),
      action: "engagement.cancelled",
      resourceType: "engagement",
      resourceId: String(engagement._id),
      ip: req.ip,
      success: true,
    });

    respond(res, 200, engagement);
  } catch (err) {
    fail(res, err, "Could not cancel the engagement.");
  }
});

// ── Either party raises a dispute ────────────────────────────────────
// Disputing does not move money: the wage entry stays exactly as it is. The
// dispute is a labelled flag on the record, and it is terminal here — resolving
// it is a later phase's problem, not something this route pretends to do.
router.post("/:id/dispute", authenticate, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return notFound(res);
    const engagement = await Engagement.findById(req.params.id);
    if (!engagement) return notFound(res);

    const isEmployer = String(engagement.employer_account_id) === String(req.userId);
    const isWorker = String(engagement.worker_id) === String(req.userId);
    if (!isEmployer && !isWorker) return notFound(res);

    if (!DISPUTABLE_STATUSES.includes(engagement.status)) {
      return invalidTransition(res, engagement, "dispute");
    }

    const reason = cleanText(req.body?.reason, 500);
    if (!reason || reason.length < 5) {
      return res.status(422).json({ detail: "reason must describe the problem in at least 5 characters" });
    }

    const now = new Date();
    engagement.status = "disputed";
    engagement.disputed_at = now;
    engagement.dispute = {
      raised_by: isEmployer ? "employer" : "worker",
      reason,
      opened_at: now,
    };
    await engagement.save();

    await audit({
      actorRole: isEmployer ? "employer" : "worker",
      actorIdentifier: String(req.userId),
      action: "engagement.disputed",
      resourceType: "engagement",
      resourceId: String(engagement._id),
      ip: req.ip,
      success: true,
    });

    respond(res, 200, engagement);
  } catch (err) {
    fail(res, err, "Could not raise the dispute.");
  }
});

export default router;
