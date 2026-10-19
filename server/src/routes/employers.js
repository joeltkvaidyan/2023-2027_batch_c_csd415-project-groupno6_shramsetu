import { Router } from "express";
import mongoose from "mongoose";
import { Employer } from "../models/Employer.js";
import { WageEntry } from "../models/WageEntry.js";
import { OCCUPATIONS, employerKey } from "../utils/occupations.js";
import { authenticate, requireWorker, audit } from "../middleware/auth.js";

const router = Router();

const fail = (res, err, msg) => {
  console.error("[employers]", err);
  res.status(500).json({ detail: msg });
};

const isOid = (id) => mongoose.isValidObjectId(id);

function cleanText(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Optional phone: 10–15 digits, 422 rather than silently mangling it. */
function normalisePhone(value) {
  if (value === undefined || value === null || String(value).trim() === "") return { phone: null };
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return { error: "phone must contain 10 to 15 digits" };
  }
  return { phone: digits };
}

/**
 * Per-employer wage totals from the CALLER'S OWN entries only.
 *
 * Joining on the normalised employer name means an employer record added
 * later still picks up days logged earlier. The worker_id clause is the
 * security boundary: another worker's wage rows can never contribute.
 */
async function statsByEmployerKey(workerId) {
  const rows = await WageEntry.aggregate([
    { $match: { worker_id: new mongoose.Types.ObjectId(workerId), employer_name: { $ne: null } } },
    {
      $addFields: {
        employer_key: { $toLower: { $trim: { input: "$employer_name" } } },
      },
    },
    {
      $group: {
        _id: "$employer_key",
        days_worked: { $sum: 1 },
        total_agreed: { $sum: "$agreed_amount" },
        total_paid: { $sum: "$paid_amount" },
        last_worked_on: { $max: "$work_date" },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, r]));
}

function withStats(employer, stats) {
  const s = stats.get(employer.name_key);
  const base = employer.toJSON();
  return {
    ...base,
    stats: {
      days_worked: s?.days_worked ?? 0,
      total_agreed: s?.total_agreed ?? 0,
      total_paid: s?.total_paid ?? 0,
      total_outstanding: Math.max(0, (s?.total_agreed ?? 0) - (s?.total_paid ?? 0)),
      last_worked_on: s?.last_worked_on ?? null,
    },
  };
}

function validateBody(body) {
  const name = cleanText(body?.name, 120);
  if (!name || name.length < 2) return { error: "name must be at least 2 characters" };
  if (body?.occupation && !OCCUPATIONS.includes(body.occupation)) {
    return { error: `occupation must be one of: ${OCCUPATIONS.join(", ")}` };
  }
  const { phone, error: phoneError } = normalisePhone(body?.phone);
  if (phoneError) return { error: phoneError };

  let dailyWage = null;
  if (body?.daily_wage !== undefined && body?.daily_wage !== null && body?.daily_wage !== "") {
    dailyWage = Number(body.daily_wage);
    if (!Number.isFinite(dailyWage) || dailyWage < 0) {
      return { error: "daily_wage must be a number ≥ 0" };
    }
  }

  return {
    value: {
      name,
      occupation: body?.occupation || null,
      phone,
      work_location: cleanText(body?.work_location, 160),
      district: cleanText(body?.district, 80),
      state: cleanText(body?.state, 80),
      daily_wage: dailyWage,
      notes: cleanText(body?.notes, 500),
    },
  };
}

// ── List my recurring employers (+ wage totals) ───────────────────────
router.get("/", authenticate, requireWorker, async (req, res) => {
  try {
    const filter = { worker_id: req.userId };
    if (String(req.query.include_inactive || "") !== "true") filter.is_active = true;

    const [employers, stats] = await Promise.all([
      Employer.find(filter).sort({ name: 1 }),
      statsByEmployerKey(req.userId),
    ]);
    res.json({ employers: employers.map((e) => withStats(e, stats)) });
  } catch (err) {
    fail(res, err, "Could not load employers.");
  }
});

// ── Register (or reactivate) a recurring employer ─────────────────────
router.post("/", authenticate, requireWorker, async (req, res) => {
  try {
    const { value, error } = validateBody(req.body);
    if (error) return res.status(422).json({ detail: error });

    const key = employerKey(value.name);
    const existing = await Employer.findOne({ worker_id: req.userId, name_key: key });

    if (existing && existing.is_active) {
      return res.status(409).json({
        detail: "This employer is already in your list.",
        code: "employer_exists",
        employer_id: String(existing._id),
      });
    }

    // A soft-deleted record keeps its wage history: reactivate and refresh it
    // instead of creating a duplicate name.
    const employer = existing
      ? await Employer.findByIdAndUpdate(existing._id, { ...value, is_active: true }, { new: true })
      : await Employer.create({ ...value, name_key: key, worker_id: req.userId });

    await audit({
      actorRole: "worker",
      actorIdentifier: req.userId,
      action: "employer.create",
      resourceType: "employer",
      resourceId: String(employer._id),
      ip: req.ip,
      success: true,
    });

    const stats = await statsByEmployerKey(req.userId);
    res.status(existing ? 200 : 201).json(withStats(employer, stats));
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ detail: "This employer is already in your list.", code: "employer_exists" });
    }
    fail(res, err, "Could not save the employer.");
  }
});

// ── Update one of MY employer records ─────────────────────────────────
router.patch("/:id", authenticate, requireWorker, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Employer not found" });

    // Ownership is part of the filter: a cross-worker id is a 404, not a 403
    // (avoids confirming that another worker's record exists).
    const employer = await Employer.findOne({ _id: req.params.id, worker_id: req.userId });
    if (!employer) return res.status(404).json({ detail: "Employer not found" });

    const merged = {
      name: req.body?.name !== undefined ? req.body.name : employer.name,
      occupation: req.body?.occupation !== undefined ? req.body.occupation : employer.occupation,
      phone: req.body?.phone !== undefined ? req.body.phone : employer.phone,
      work_location: req.body?.work_location !== undefined ? req.body.work_location : employer.work_location,
      district: req.body?.district !== undefined ? req.body.district : employer.district,
      state: req.body?.state !== undefined ? req.body.state : employer.state,
      daily_wage: req.body?.daily_wage !== undefined ? req.body.daily_wage : employer.daily_wage,
      notes: req.body?.notes !== undefined ? req.body.notes : employer.notes,
    };

    const { value, error } = validateBody(merged);
    if (error) return res.status(422).json({ detail: error });

    Object.assign(employer, value);
    await employer.save();

    const stats = await statsByEmployerKey(req.userId);
    res.json(withStats(employer, stats));
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ detail: "Another saved employer already uses this name.", code: "employer_exists" });
    }
    fail(res, err, "Could not update the employer.");
  }
});

// ── Soft-delete one of MY employer records ────────────────────────────
router.delete("/:id", authenticate, requireWorker, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Employer not found" });
    const employer = await Employer.findOneAndUpdate(
      { _id: req.params.id, worker_id: req.userId },
      { is_active: false },
      { new: true }
    );
    if (!employer) return res.status(404).json({ detail: "Employer not found" });
    res.json({ detail: "Employer removed from your list" });
  } catch (err) {
    fail(res, err, "Could not remove the employer.");
  }
});

export default router;
