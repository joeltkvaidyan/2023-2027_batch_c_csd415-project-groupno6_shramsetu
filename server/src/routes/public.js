import { Router } from "express";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { WorkerRating } from "../models/WorkerRating.js";
import { OCCUPATIONS } from "../utils/occupations.js";
import { engagementSignalsFor } from "../utils/engagementSignals.js";

/**
 * Public "find a worker" directory — the open surface for people who are NOT
 * on the platform ("common people") to locate accepted, government-approved
 * workers by NAME or PLACE and approach them for work directly.
 *
 * Privacy is structural: only the fields a worker's own registration already
 * made public-by-nature are returned (name, trade, experience years, state,
 * district) plus the community rating summary. Phone numbers, street
 * addresses, documents, wages and QR codes are NEVER exposed here.
 */
const router = Router();

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /public/workers?name=&place=&occupation=&page=&page_size=
router.get("/workers", async (req, res) => {
  try {
    const name = String(req.query?.name || "").trim();
    const place = String(req.query?.place || "").trim();
    const occupation = String(req.query?.occupation || "").trim();

    // Visibility is decided by TWO facts only: the worker is active, and a
    // labour office accepted them. Ratings are never part of this filter, and
    // an employer's opinion must never be able to remove a worker from the
    // directory — that is the whole reason the objective signals below exist.
    // `tests/evidenceLoop.test.js` fails if a rating ever creeps in here.
    const filter = {
      role: "worker",
      is_active: true,
      is_phone_verified: true,
      gov_approve_status: "accepted",
    };
    if (name) filter.full_name = new RegExp(escapeRegex(name), "i");
    if (occupation && OCCUPATIONS.includes(occupation)) filter.occupation = occupation;
    if (place) {
      const rx = new RegExp(escapeRegex(place), "i");
      filter.$or = [{ current_district: rx }, { current_state: rx }, { current_village_or_city: rx }];
    }

    const page = Math.max(1, Number.parseInt(String(req.query?.page ?? "1"), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query?.page_size ?? "20"), 10) || 20));

    const [total, workers] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .select("_id full_name occupation years_of_experience current_state current_district current_village_or_city worker_id"),
    ]);

    const ratingRows = await WorkerRating.aggregate([
      { $match: { worker_id: { $in: workers.map((w) => w._id) } } },
      { $group: { _id: "$worker_id", average: { $avg: "$stars" }, count: { $sum: 1 } } },
    ]);
    const ratingMap = new Map(
      ratingRows.map((r) => [String(r._id), { average: Math.round(r.average * 10) / 10, count: r.count }])
    );

    // Objective signals, computed at read time from confirmed engagements. A
    // new worker with no ratings can still show three corroborated shifts.
    const signalsMap = await engagementSignalsFor(workers.map((w) => w._id));

    res.json({
      total,
      page,
      page_size: pageSize,
      workers: workers.map((w) => ({
        id: String(w._id),
        worker_code: w.worker_id,
        full_name: w.full_name,
        occupation: w.occupation,
        years_of_experience: w.years_of_experience,
        place: [w.current_village_or_city, w.current_district, w.current_state].filter(Boolean).join(", ") || null,
        current_district: w.current_district,
        current_state: w.current_state,
        rating: ratingMap.get(String(w._id)) ?? { average: null, count: 0 },
        signals: signalsMap.get(String(w._id)) ?? null,
        gov_accepted: true,
      })),
      notice:
        "Only government-accepted workers are listed, with just their name, trade and place visible. Approach them for work directly — ShramSetu never shares phone numbers here. Ratings are community feedback, not verification; the shift counts and paid-on-time figures come from employer-confirmed engagements. A low rating never removes anyone from this list.",
    });
  } catch (err) {
    console.error("[public/workers]", err);
    res.status(500).json({ detail: "Could not load workers." });
  }
});

// GET /public/occupations — trades list for the directory filter.
router.get("/occupations", (_req, res) => {
  res.json({ occupations: OCCUPATIONS });
});

export default router;
