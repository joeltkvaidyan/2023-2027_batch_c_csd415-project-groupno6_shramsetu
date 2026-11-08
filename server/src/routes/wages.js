import { Router } from "express";
import mongoose from "mongoose";
import { WageEntry } from "../models/WageEntry.js";
import { WageSlip } from "../models/WageSlip.js";
import { authenticate, requireWorker, audit } from "../middleware/auth.js";
import { isDuplicateKeyError, readIdempotencyKey, replayResponse } from "../utils/idempotency.js";

const router = Router();

function dayBounds(dateStr) {
  // Accept YYYY-MM-DD only; interpreted as a UTC calendar day.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return null;
  const t = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(t)) return null;
  return { start: new Date(t), end: new Date(t + 86_400_000) };
}

function entryJSON(e) {
  // One shape, defined by the model, so the new provenance fields
  // (source / confirmed_at / engagement_id) cannot drift between routes.
  return e.toJSON();
}

const fail = (res, err, msg) => {
  console.error("[wages]", err);
  res.status(500).json({ detail: msg });
};

// ── List my wage entries (optionally ?month=YYYY-MM) ─────────────────
router.get("/", authenticate, requireWorker, async (req, res) => {
  try {
    const filter = {
      // Aggregates don't auto-cast strings → cast explicitly so $match hits.
      worker_id: new mongoose.Types.ObjectId(req.userId),
    };

    // Optional month filter (YYYY-MM) — resolved in UTC.
    if (req.query.month) {
      const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month));
      if (!m) return res.status(422).json({ detail: "month must be YYYY-MM" });
      const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
      const end = Date.UTC(Number(m[2]) === 12 ? Number(m[1]) + 1 : Number(m[1]), Number(m[2]) % 12, 1);
      filter.work_date = { $gte: new Date(start), $lt: new Date(end) };
    }

    const entries = await WageEntry.find(filter).sort({ work_date: -1 });
    res.json({ entries: entries.map(entryJSON) });
  } catch (err) {
    fail(res, err, "Could not load wage entries.");
  }
});

// ── Unpaid-wages summary (last 90 days, or ?month=YYYY-MM) ───────────
router.get("/summary", authenticate, requireWorker, async (req, res) => {
  try {
    const filter = {
      // Aggregates don't auto-cast strings → cast explicitly so $match hits.
      worker_id: new mongoose.Types.ObjectId(req.userId),
    };
    if (req.query.month) {
      const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month));
      if (!m) return res.status(422).json({ detail: "month must be YYYY-MM" });
      const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
      const end = Date.UTC(Number(m[2]) === 12 ? Number(m[1]) + 1 : Number(m[1]), Number(m[2]) % 12, 1);
      filter.work_date = { $gte: new Date(start), $lt: new Date(end) };
    } else {
      filter.work_date = { $gte: new Date(Date.now() - 90 * 86_400_000) };
    }

    const [agg] = await WageEntry.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          days_logged: { $sum: 1 },
          total_agreed: { $sum: "$agreed_amount" },
          total_paid: { $sum: "$paid_amount" },
        },
      },
    ]);

    const total_agreed = agg?.total_agreed ?? 0;
    const total_paid = agg?.total_paid ?? 0;
    res.json({
      days_logged: agg?.days_logged ?? 0,
      total_agreed,
      total_paid,
      total_unpaid: Math.max(0, total_agreed - total_paid),
      period: req.query.month ? String(req.query.month) : "last_90_days",
    });
  } catch (err) {
    fail(res, err, "Could not compute wage summary.");
  }
});

// ── Pre-filled unpaid-wages grievance ────────────────────────────────
//
// The draft the worker lands on when they tap "file a complaint" from the wage
// diary. Every day states its own evidential weight: an employer-confirmed day
// cites the engagement, the employer account, the confirmed wage and the wage
// slip if one was issued; a self-reported day says plainly that it is only the
// worker's account. The draft never lets the record overstate itself.
router.get("/grievance-prefill", authenticate, requireWorker, async (req, res) => {
  try {
    const filter = { worker_id: new mongoose.Types.ObjectId(req.userId) };
    let period = "last_90_days";

    if (req.query.month) {
      const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month));
      if (!m) return res.status(422).json({ detail: "month must be YYYY-MM" });
      const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
      const end = Date.UTC(
        Number(m[2]) === 12 ? Number(m[1]) + 1 : Number(m[1]),
        Number(m[2]) % 12,
        1
      );
      filter.work_date = { $gte: new Date(start), $lt: new Date(end) };
      period = String(req.query.month);
    } else {
      filter.work_date = { $gte: new Date(Date.now() - 90 * 86_400_000) };
    }

    const entries = await WageEntry.find(filter).sort({ work_date: 1 });
    const unpaid = entries.filter((e) => Number(e.agreed_amount) > Number(e.paid_amount));

    const engagementIds = unpaid.map((e) => e.engagement_id).filter(Boolean);
    const slips = engagementIds.length
      ? await WageSlip.find({
          worker_id: req.userId,
          engagement_id: { $in: engagementIds },
          status: "issued",
        }).select("slip_number engagement_id issue_date")
      : [];
    const slipByEngagement = new Map(slips.map((s) => [String(s.engagement_id), s]));

    const days = unpaid.map((e) => {
      const source = e.source ?? "worker_reported";
      const confirmed = source !== "worker_reported";
      const slip = e.engagement_id ? slipByEngagement.get(String(e.engagement_id)) : null;
      return {
        work_date: e.work_date,
        agreed_amount: e.agreed_amount,
        paid_amount: e.paid_amount,
        unpaid_amount: Math.round((Number(e.agreed_amount) - Number(e.paid_amount)) * 100) / 100,
        // The single field a reader should trust: is this corroborated or not?
        evidence: confirmed ? "employer_confirmed" : "self_reported",
        source,
        engagement_id: e.engagement_id ? String(e.engagement_id) : null,
        employer_account_id: e.employer_account_id ? String(e.employer_account_id) : null,
        confirmed_at: e.confirmed_at ?? null,
        wage_slip: slip ? { id: String(slip._id), slip_number: slip.slip_number } : null,
        employer_name: e.employer_name ?? null,
      };
    });

    const confirmedDays = days.filter((d) => d.evidence === "employer_confirmed");
    const selfDays = days.filter((d) => d.evidence === "self_reported");
    const sumOf = (rows) => Math.round(rows.reduce((n, d) => n + d.unpaid_amount, 0) * 100) / 100;
    const totalUnpaid = sumOf(days);
    const monetary = (n) =>
      `Rs ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const day = (d) => new Date(d).toISOString().slice(0, 10);
    const listDates = (rows) =>
      `${rows.slice(0, 31).map((d) => day(d.work_date)).join(", ")}${
        rows.length > 31 ? ` and ${rows.length - 31} more` : ""
      }`;

    const strength =
      days.length === 0
        ? "none"
        : confirmedDays.length === 0
          ? "self_reported_only"
          : selfDays.length === 0
            ? "confirmed_only"
            : "mixed";

    const lines = [];
    if (days.length === 0) {
      lines.push(`I have no unpaid wage days recorded on ShramSetu for ${period}.`);
    } else {
      lines.push(
        `I am claiming ${monetary(totalUnpaid)} in unpaid wages for ${days.length} day(s) — ${period}.`
      );
      if (confirmedDays.length) {
        lines.push("");
        lines.push(
          `Employer-confirmed days (${confirmedDays.length} day(s), ${monetary(sumOf(confirmedDays))}): ${listDates(confirmedDays)}.`
        );
        lines.push(
          "These days carry the employer's own confirmation on ShramSetu, with an engagement reference for each."
        );
        const slipNumbers = confirmedDays.filter((d) => d.wage_slip).map((d) => d.wage_slip.slip_number);
        if (slipNumbers.length) lines.push(`Wage slips issued: ${slipNumbers.join(", ")}.`);
      }
      if (selfDays.length) {
        lines.push("");
        lines.push(
          `Days recorded only by me (${selfDays.length} day(s), ${monetary(sumOf(selfDays))}): ${listDates(selfDays)}.`
        );
        lines.push("These are my own record. The employer has not confirmed them.");
      }
      lines.push("");
      lines.push(
        confirmedDays.length
          ? "I ask that the employer-confirmed days be treated as corroborated by the employer's own record, and the self-recorded days as my account pending verification."
          : "I ask that these days be treated as my account; no employer has confirmed them yet."
      );
    }

    const suggested = [];
    for (const d of confirmedDays) {
      if (d.wage_slip) {
        suggested.push({
          kind: "wage_slip",
          ref_id: d.wage_slip.id,
          label: `Wage slip ${d.wage_slip.slip_number} (${day(d.work_date)})`,
        });
      } else if (d.engagement_id) {
        suggested.push({
          kind: "engagement",
          ref_id: d.engagement_id,
          label: `Employer-confirmed day ${day(d.work_date)}`,
        });
      }
    }

    const employers = [...new Set(unpaid.map((e) => e.employer_name).filter(Boolean))];

    res.json({
      category: "unpaid_wages",
      subject:
        days.length === 0
          ? `Unpaid wages — ${period}`
          : `Unpaid wages ${monetary(totalUnpaid)} — ${days.length} day(s)${
              confirmedDays.length ? `, ${confirmedDays.length} employer-confirmed` : ""
            }`,
      description: lines.join("\n"),
      employer_name: employers.length === 1 ? employers[0] : null,
      incident_date: days.length ? day(days[0].work_date) : "",
      period,
      days,
      evidence_summary: {
        total_unpaid: totalUnpaid,
        days: days.length,
        confirmed_days: confirmedDays.length,
        confirmed_unpaid: sumOf(confirmedDays),
        self_reported_days: selfDays.length,
        self_reported_unpaid: sumOf(selfDays),
        strength,
      },
      suggested_evidence: suggested,
      notice:
        "Employer-confirmed days are corroborated by the employer's own record and can be cited as such. " +
        "Days marked self_reported are only your own account — this draft never presents them as verified."
    });
  } catch (err) {
    fail(res, err, "Could not build the grievance draft.");
  }
});

// ── Create or update the entry for one date (upsert day sheet) ───────
router.post("/", authenticate, requireWorker, async (req, res) => {
  try {
    const { work_date, employer_name, agreed_amount, paid_amount, payment_status } = req.body || {};
    const bounds = dayBounds(work_date);
    if (!bounds) {
      return res.status(422).json({ detail: "work_date must be YYYY-MM-DD" });
    }
    const agreed = Number(agreed_amount);
    if (!Number.isFinite(agreed) || agreed < 0) {
      return res.status(422).json({ detail: "agreed_amount must be a number ≥ 0" });
    }
    const paid = paid_amount === undefined || paid_amount === null ? 0 : Number(paid_amount);
    if (!Number.isFinite(paid) || paid < 0) {
      return res.status(422).json({ detail: "paid_amount must be a number ≥ 0" });
    }
    if (paid > agreed) {
      return res.status(422).json({ detail: "paid_amount cannot exceed agreed_amount" });
    }
    const status =
      payment_status ||
      (paid <= 0 ? "unpaid" : paid >= agreed ? "paid" : "partial");

    // A retried submission must not hit the locks below: the first attempt may
    // already have written a paid, employer-confirmed day, and the retry would
    // then be refused for a change it is not actually making.
    const requestKey = readIdempotencyKey(req);
    if (requestKey) {
      const previous = await WageEntry.findOne({ worker_id: req.userId, client_request_id: requestKey });
      if (previous) return replayResponse(res, entryJSON(previous));
    }

    // Lock paid days: an entry already recorded as fully paid can no longer
    // be edited (wage fix: salary already settled). Unpaid/partial stay open.
    const existing = await WageEntry.findOne({
      worker_id: req.userId,
      work_date: { $gte: bounds.start, $lt: bounds.end },
    });
    if (existing && existing.payment_status === "paid") {
      return res.status(409).json({
        detail: "This day is fully paid and can no longer be edited.",
        code: "wage_paid_locked",
      });
    }

    // An employer-confirmed day is a two-party record. The worker may still
    // correct WHAT WAS PAID, but not rewrite the agreed figure the employer
    // signed off on — that is what a dispute is for. Without this, "confirmed"
    // would be cosmetic: the worker could quietly drop the amount afterwards.
    const confirmed = Boolean(existing) && (existing.source ?? "worker_reported") !== "worker_reported";
    if (confirmed && Math.abs(agreed - existing.agreed_amount) > 0.005) {
      return res.status(409).json({
        detail:
          "This day was confirmed by the employer, so the agreed amount can no longer be changed. Record what was paid, or raise a dispute.",
        code: "wage_confirmed_locked",
      });
    }

    const entry = await WageEntry.findOneAndUpdate(
      { worker_id: req.userId, work_date: { $gte: bounds.start, $lt: bounds.end } },
      {
        worker_id: req.userId,
        work_date: bounds.start,
        employer_name: confirmed ? existing.employer_name : employer_name || null,
        agreed_amount: agreed,
        paid_amount: paid,
        payment_status: status,
        client_request_id: requestKey ?? undefined,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await audit({
      actorRole: "worker",
      actorIdentifier: req.userId,
      action: "wage.upsert",
      resourceType: "wage_entry",
      resourceId: String(entry._id),
      ip: req.ip,
      success: true,
    });
    res.status(201).json(entryJSON(entry));
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const key = readIdempotencyKey(req);
      const previous = key && (await WageEntry.findOne({ worker_id: req.userId, client_request_id: key }));
      if (previous) return replayResponse(res, entryJSON(previous));
    }
    fail(res, err, "Could not save the wage entry.");
  }
});

// ── Delete one of MY entries ─────────────────────────────────────────
router.delete("/:id", authenticate, requireWorker, async (req, res) => {
  try {
    // Ownership-scoped: the worker_id clause makes cross-worker deletes a no-op.
    const entry = await WageEntry.findOneAndDelete({ _id: req.params.id, worker_id: req.userId });
    if (!entry) return res.status(404).json({ detail: "Entry not found" });
    res.json({ detail: "Entry deleted" });
  } catch (err) {
    fail(res, err, "Could not delete the wage entry.");
  }
});

export default router;
