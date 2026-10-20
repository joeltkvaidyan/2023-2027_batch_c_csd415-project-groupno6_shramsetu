import { Router } from "express";
import mongoose from "mongoose";
import { WorkerRating } from "../models/WorkerRating.js";
import { User } from "../models/User.js";
import { authenticate, audit } from "../middleware/auth.js";

const router = Router();

const fail = (res, err, msg) => {
  console.error("[ratings]", err);
  res.status(500).json({ detail: msg });
};

const isOid = (id) => mongoose.isValidObjectId(id);

function cleanText(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Public rating summary for one worker: honest aggregate + latest comments.
 * Only display-safe fields are returned (the rater's phone is a dedupe key,
 * never a public field).
 */
async function ratingSummary(workerId) {
  const [agg, latest] = await Promise.all([
    WorkerRating.aggregate([
      { $match: { worker_id: new mongoose.Types.ObjectId(workerId) } },
      { $group: { _id: null, average: { $avg: "$stars" }, count: { $sum: 1 } } },
    ]),
    WorkerRating.find({ worker_id: workerId }).sort({ createdAt: -1 }).limit(5),
  ]);
  return {
    average: agg[0] ? Math.round(agg[0].average * 10) / 10 : null,
    count: agg[0]?.count ?? 0,
    latest: latest.map((r) => r.toJSON()),
  };
}

/**
 * POST /ratings/worker/:id — rate a worker.
 *
 * Two rater paths, enforced by authentication state:
 *  - employer account   (Bearer token, role=employer): identity = account;
 *    one rating per employer per worker.
 *  - member of the public ("common people", no session): must declare
 *    rater_name + rater_phone; one rating per phone per worker.
 * A worker can never rate themselves, and unrated identificators are 404s.
 */
router.post("/worker/:id", async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Worker not found" });
    const worker = await User.findById(req.params.id).select(
      "role is_active gov_approve_status mobile_number"
    );
    if (!worker || worker.role !== "worker" || !worker.is_active || worker.gov_approve_status !== "accepted") {
      return res.status(404).json({ detail: "Worker not found" });
    }

    const stars = Number(req.body?.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(422).json({ detail: "stars must be an integer from 1 to 5" });
    }
    const comment = cleanText(req.body?.comment, 300);
    const employerName = cleanText(req.body?.employer_name, 120);

    // Determine the rater identity.
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    let authenticatedUser = null;
    if (token) {
      try {
        const { verifyToken } = await import("../utils/crypto.js");
        const payload = verifyToken(token);
        if (payload?.sub) authenticatedUser = await User.findById(payload.sub).select("role is_active full_name");
      } catch {
        authenticatedUser = null; // an invalid/expired token degrades to "public"
      }
    }
    // A signed-in worker can never rate themselves — whichever rater path the
    // token would otherwise fall into.
    if (authenticatedUser && String(authenticatedUser._id) === String(worker._id)) {
      return res.status(403).json({ detail: "A worker cannot rate themselves." });
    }
    const isEmployerRater = authenticatedUser?.role === "employer" && authenticatedUser?.is_active;

    let raterRole, raterUserId, raterName, raterPhone;
    if (isEmployerRater) {
      raterRole = "employer";
      raterUserId = authenticatedUser._id;
      raterName = null;
      raterPhone = null;
    } else {
      // Public rater: self-declared name + phone, deduped on the phone.
      raterName = cleanText(req.body?.rater_name, 80);
      const phoneDigits = String(req.body?.rater_phone || "").replace(/\D/g, "");
      if (!raterName || raterName.length < 2 || phoneDigits.length < 10 || phoneDigits.length > 15) {
        return res.status(422).json({
          detail: "Enter your name and a mobile number (10-15 digits) so each person can rate a worker once.",
        });
      }
      raterRole = "public";
      raterUserId = null;
      raterPhone = phoneDigits;
    }

    const query =
      raterRole === "employer"
        ? { worker_id: worker._id, rater_user_id: raterUserId }
        : { worker_id: worker._id, rater_phone: raterPhone };

    // Public raters are unverified self-declared people: they get exactly one
    // rating per worker (deduped on phone) and cannot overwrite it later.
    if (raterRole === "public") {
      const existing = await WorkerRating.findOne(query).select("_id");
      if (existing) return res.status(409).json({ detail: "You have already rated this worker." });
    }

    const rating = await WorkerRating.findOneAndUpdate(
      query,
      {
        worker_id: worker._id,
        rater_role: raterRole,
        rater_user_id: raterUserId,
        rater_name: raterName,
        rater_phone: raterPhone,
        stars,
        comment,
        employer_name: raterRole === "employer" ? employerName ?? authenticatedUser.full_name : null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await audit({
      actorRole: raterRole,
      actorIdentifier: raterRole === "employer" ? String(raterUserId) : raterPhone,
      action: "worker.rate",
      resourceType: "worker_rating",
      resourceId: String(rating._id),
      ip: req.ip,
      success: true,
    });

    res.status(200).json({ rating: rating.toJSON(), summary: await ratingSummary(worker._id) });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ detail: "You have already rated this worker." });
    }
    fail(res, err, "Could not save the rating.");
  }
});

/**
 * GET /ratings/worker/:id — public rating summary (no auth needed).
 */
router.get("/worker/:id", async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Worker not found" });
    const worker = await User.findById(req.params.id).select("role is_active gov_approve_status");
    if (!worker || worker.role !== "worker" || !worker.is_active || worker.gov_approve_status !== "accepted") {
      return res.status(404).json({ detail: "Worker not found" });
    }
    res.json(await ratingSummary(worker._id));
  } catch (err) {
    fail(res, err, "Could not load ratings.");
  }
});

export default router;
