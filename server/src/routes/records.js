import { Router } from "express";
import { User } from "../models/User.js";
import { Engagement } from "../models/Engagement.js";
import { retainUntil } from "../models/WageSlip.js";
import { authenticate, requireEmployer, audit } from "../middleware/auth.js";
import { renderMusterHtml, resolveLanguage } from "../services/wageSlipRender.js";

const router = Router();

export const MUSTER_SOURCE_NOTE =
  "Form IX attendance-cum-muster roll, built from employer-confirmed engagements " +
  "(Wages (Central) Rules 2026). Columns we do not hold — designation, shift, place of " +
  "work, in/out times, overtime hours and tour details — are left blank rather than filled. " +
  "State rules may differ.";

/** Fields the form has and this platform does not: marked, never invented. */
const ABSENT_FIELDS = [
  "designation",
  "shift",
  "place_of_work",
  "in_out_times",
  "total_ot_hours",
  "tour_details",
  "establishment.address",
  "establishment.registration_number",
];

function monthBounds(raw) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(raw || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return {
    label: `${m[1]}-${m[2]}`,
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
    days: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

async function buildMusterRoll(employerId, bounds) {
  const employer = await User.findById(employerId).select(
    "business_name full_name current_district current_state"
  );

  // Only days that were actually confirmed as worked. An offer, an acceptance,
  // a no-show or a cancellation is not attendance and must never be counted as a
  // present day on a statutory register.
  const engagements = await Engagement.find({
    employer_account_id: employerId,
    work_date: { $gte: bounds.start, $lt: bounds.end },
    worked_at: { $ne: null },
  }).sort({ work_date: 1 });

  const rows = new Map();
  for (const e of engagements) {
    const key = String(e.worker_id);
    let row = rows.get(key);
    if (!row) {
      row = {
        worker_id: key,
        worker_code: e.worker_code ?? null,
        name: e.worker_name,
        occupation: e.occupation ?? null,
        day_marks: {},
        total_days: 0,
      };
      rows.set(key, row);
    }
    const day = new Date(e.work_date).getUTCDate();
    row.day_marks[String(day)] = {
      engagement_id: String(e._id),
      status: e.status,
      // Hours are held; in/out clock times are not, so the mark is "present"
      // plus whatever quantity we actually recorded.
      hours: e.hours ?? null,
      units: e.units ?? null,
    };
    row.total_days += 1;
  }

  const employees = [...rows.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row, idx) => ({ sl_no: idx + 1, ...row }));

  return {
    establishment: {
      name: employer?.business_name || employer?.full_name || engagements[0]?.employer_name || null,
      address: null,
      registration_number: null,
    },
    employer_locality: {
      district: employer?.current_district ?? null,
      state: employer?.current_state ?? null,
    },
    month: bounds.label,
    days_in_month: bounds.days,
    employees,
    totals: {
      employees: employees.length,
      present_days: employees.reduce((sum, e) => sum + e.total_days, 0),
    },
    absent_fields: ABSENT_FIELDS,
    form_source_note: MUSTER_SOURCE_NOTE,
    retain_until: retainUntil(bounds.start),
    generated_at: new Date(),
  };
}

// ── JSON view ────────────────────────────────────────────────────────
router.get("/muster-roll", authenticate, requireEmployer, async (req, res) => {
  try {
    const bounds = monthBounds(req.query.month);
    if (!bounds) {
      return res.status(422).json({
        detail: "month must be YYYY-MM",
        code: "invalid_month",
      });
    }
    const roll = await buildMusterRoll(req.userId, bounds);

    await audit({
      actorRole: "employer",
      actorIdentifier: String(req.userId),
      action: "muster_roll.viewed",
      resourceType: "muster_roll",
      resourceId: bounds.label,
      ip: req.ip,
      success: true,
    });

    res.json({ muster_roll: roll });
  } catch (err) {
    console.error("[records/muster-roll]", err);
    res.status(500).json({ detail: "Could not build the muster roll." });
  }
});

// ── Printable HTML ───────────────────────────────────────────────────
router.get("/muster-roll/print", authenticate, requireEmployer, async (req, res) => {
  try {
    const bounds = monthBounds(req.query.month);
    if (!bounds) {
      return res.status(422).json({ detail: "month must be YYYY-MM", code: "invalid_month" });
    }
    const roll = await buildMusterRoll(req.userId, bounds);
    const language = resolveLanguage(req.query.language);
    res.type("html").send(renderMusterHtml(roll, language));
  } catch (err) {
    console.error("[records/muster-roll/print]", err);
    res.status(500).json({ detail: "Could not render the muster roll." });
  }
});

export default router;
