import { Router } from "express";
import mongoose from "mongoose";
import { WageEntry } from "../models/WageEntry.js";
import { authenticate, requireWorker, audit } from "../middleware/auth.js";

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
