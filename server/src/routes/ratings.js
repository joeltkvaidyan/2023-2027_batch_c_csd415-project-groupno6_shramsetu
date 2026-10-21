import { Router } from "express";
import mongoose from "mongoose";
import { WorkerRating, REPLY_WINDOW_DAYS } from "../models/WorkerRating.js";
import { Engagement } from "../models/Engagement.js";
import { User } from "../models/User.js";
import { authenticate, requireWorker, audit } from "../middleware/auth.js";
import { engagementSignals } from "../utils/engagementSignals.js";

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
 * The engagement that entitles an employer account to rate this worker.
 * Requires a shift the employer actually confirmed as worked — an offer, an
 * acceptance, a no-show or a cancellation proves nothing about the work.
 */
function findConfirmedEngagement(employerId, workerId, engagementId) {
  const query = {
    employer_account_id: employerId,
    worker_id: workerId,
    worked_at: { $ne: null },
  };
  if (engagementId !== undefined && engagementId !== null && engagementId !== "") {
    if (!isOid(engagementId)) return null;
    query._id = engagementId;
  }
  return Engagement.findOne(query).sort({ work_date: -1 });
}

/**
 * Public rating summary for one worker: honest aggregate, the latest comments,
 * and the objective signals that do not depend on anyone's opinion.
 *
 * Counts include every rating (a rating is public the moment it is written);
 * `released` on each row says whether it is still open to the worker's reply or
 * to amendment by its author.
 */
async function ratingSummary(workerId) {
  const [agg, latest, signals] = await Promise.all([
    WorkerRating.aggregate([
      { $match: { worker_id: new mongoose.Types.ObjectId(workerId) } },
      { $group: { _id: null, average: { $avg: "$stars" }, count: { $sum: 1 } } },
    ]),
    WorkerRating.find({ worker_id: workerId }).sort({ createdAt: -1 }).limit(5),
    engagementSignals(workerId),
  ]);

  const rows = latest.map((r) => r.toJSON());
  return {
    average: agg[0] ? Math.round(agg[0].average * 10) / 10 : null,
    count: agg[0]?.count ?? 0,
    // How many of the latest are corroborated by an actual engagement.
    confirmed_count: rows.filter((r) => r.rater_verified).length,
    reply_window_days: REPLY_WINDOW_DAYS,
    signals,
    latest: rows,
    notice:
      "Ratings labelled verified_employer come from an employer account with a confirmed engagement with this worker. " +
      "Ratings labelled unverified_public are community feedback from someone we cannot identify. " +
      "Shifts confirmed and paid-on-time are computed from employer-confirmed engagements, not from ratings.",
  };
}

/**
 * POST /ratings/worker/:id — rate a worker.
 *
 * Two rater paths:
 *  - employer account (Bearer token, role=employer): requires a CONFIRMED
 *    engagement between that account and this worker; one rating per employer
 *    per worker; amendable only until the worker's reply window closes.
 *  - member of the public (no session): self-declared name + phone, one rating
 *    per phone per worker, always labelled unverified.
 * A worker can never rate themselves, and unknown/unaccepted workers are 404s.
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
        if (payload?.sub) authenticatedUser = await User.findById(payload.sub).select("role is_active full_name gov_approve_status");
      } catch {
        authenticatedUser = null; // an invalid/expired token degrades to "public"
      }
    }
    // A signed-in worker can never rate themselves — whichever rater path the
    // token would otherwise fall into.
    if (authenticatedUser && String(authenticatedUser._id) === String(worker._id)) {
      return res.status(403).json({ detail: "A worker cannot rate themselves." });
    }
    // Employer raters must be government-ACCEPTED, same as workers must be
    // before they can apply anywhere: an unlaboured, unreviewed account
    // should not be able to attach public ratings to workers.
    if (
      authenticatedUser?.role === "employer" &&
      authenticatedUser?.is_active &&
      (authenticatedUser.gov_approve_status ?? "accepted") !== "accepted"
    ) {
      return res.status(403).json({
        detail:
          "Your employer registration is pending government acceptance. Once a labour office accepts your account, you can rate workers.",
        code: "gov_approval_pending",
      });
    }
    const isEmployerRater = authenticatedUser?.role === "employer" && authenticatedUser?.is_active;

    let raterRole, raterUserId, raterName, raterPhone, verification, engagementId = null;
    if (isEmployerRater) {
      // The gate that makes "verified_employer" mean something: this account
      // must have had a shift with this worker that the account itself
      // confirmed as worked.
      const engagement = await findConfirmedEngagement(
        authenticatedUser._id,
        worker._id,
        req.body?.engagement_id
      );
      if (!engagement) {
        return res.status(403).json({
          detail:
            "You can rate a worker only after a shift you confirmed as worked. Use the public review form until then — it is labelled as unverified.",
          code: "no_confirmed_engagement",
        });
      }
      raterRole = "employer";
      raterUserId = authenticatedUser._id;
      raterName = null;
      raterPhone = null;
      verification = "confirmed_engagement";
      engagementId = engagement._id;
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
      verification = "public_self_declared";
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
    } else {
      // Two-sided release: once the record is final — the worker replied, or
      // their window closed — the author can no longer amend it.
      const existing = await WorkerRating.findOne(query);
      if (existing && existing.isReleased()) {
        return res.status(409).json({
          detail:
            "This rating is final: the worker has replied, or the reply window has closed. Ask the worker to reply there rather than editing the score.",
          code: "rating_locked",
        });
      }
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
        engagement_id: engagementId,
        verification,
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
 * POST /ratings/:id/response — the rated worker's right of reply.
 * One reply, on their own rating only. Replying makes the record final.
 */
router.post("/:id/response", authenticate, requireWorker, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Rating not found" });
    const rating = await WorkerRating.findById(req.params.id);
    // Same 404 for "missing" and "not yours": neither existence nor content of
    // someone else's rating is disclosed.
    if (!rating || String(rating.worker_id) !== String(req.userId)) {
      return res.status(404).json({ detail: "Rating not found" });
    }
    if (rating.response?.text) {
      return res.status(409).json({ detail: "You have already replied to this rating.", code: "already_replied" });
    }
    const text = cleanText(req.body?.text, 500);
    if (!text || text.length < 5) {
      return res.status(422).json({ detail: "text must be at least 5 characters" });
    }

    rating.response = { text, responded_at: new Date() };
    await rating.save();

    await audit({
      actorRole: "worker",
      actorIdentifier: String(req.userId),
      action: "worker.rating_reply",
      resourceType: "worker_rating",
      resourceId: String(rating._id),
      ip: req.ip,
      success: true,
    });

    res.json({ rating: rating.toJSON(), summary: await ratingSummary(rating.worker_id) });
  } catch (err) {
    fail(res, err, "Could not save your reply.");
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
