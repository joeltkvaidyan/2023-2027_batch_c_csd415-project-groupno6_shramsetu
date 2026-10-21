import { Router } from "express";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { ServiceRequest, REQUEST_STATUSES, REQUEST_OCCUPATIONS } from "../models/ServiceRequest.js";
import { scoreServiceRequest, MIN_MATCH_SCORE } from "../utils/jobMatch.js";
import { authenticate, requireWorker, requireCitizen, audit } from "../middleware/auth.js";

const router = Router();

const MAX_PER_OPEN_CITIZEN = 5;
const stateRegexEscape = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

const fail = (res, code, detail) => res.status(code).json({ detail });

async function workerById(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const w = await User.findById(id);
  return w && w.role === "worker" ? w : null;
}

// ── Citizen: post a help request ────────────────────────────────────────
router.post("/", authenticate, requireCitizen, async (req, res) => {
  try {
    const citizen = await User.findById(req.userId);
    if (!citizen || !citizen.is_phone_verified) return fail(res, 403, "Verify your mobile number first.");

    const occupation = String(req.body?.occupation || "").trim();
    if (!REQUEST_OCCUPATIONS.includes(occupation)) {
      return fail(res, 422, [{ loc: ["body", "occupation"], msg: `occupation must be one of: ${REQUEST_OCCUPATIONS.join(", ")}` }]);
    }
    const description = String(req.body?.description || "").trim();
    if (description.length < 5) {
      return fail(res, 422, [{ loc: ["body", "description"], msg: "Describe the work in at least 5 characters (what, where, when)." }]);
    }
    if (description.length > 500) {
      return fail(res, 422, [{ loc: ["body", "description"], msg: "Description must be 500 characters or fewer." }]);
    }

    const openCount = await ServiceRequest.countDocuments({ citizen_id: citizen._id, status: "open" });
    if (openCount >= MAX_PER_OPEN_CITIZEN) {
      return fail(res, 429, `You already have ${openCount} open requests. Close one before posting another.`);
    }

    const clean = (v, max = 120) => {
      const s = String(v || "").trim();
      return s.length ? s.slice(0, max) : null;
    };

    const request = await ServiceRequest.create({
      citizen_id: citizen._id,
      citizen_name: citizen.full_name,
      contact_phone: citizen.mobile_number,
      occupation,
      description,
      area_village: clean(req.body?.area_village),
      district: clean(req.body?.district, 80),
      state: clean(req.body?.state, 80),
      preferred_time: clean(req.body?.preferred_time, 60),
      status: "open",
    });

    await audit({
      actorRole: "citizen", actorIdentifier: citizen.mobile_number, action: "request.created",
      resourceType: "service_request", resourceId: String(request._id), ip: req.ip, success: true,
    });

    res.status(201).json(request.toCitizenJSON());
  } catch (err) {
    console.error("[requests/create]", err);
    fail(res, 500, "Could not post the request. Please try again.");
  }
});

// ── Citizen: my requests (phone shown only after a worker accepts) ──────
router.get("/mine", authenticate, requireCitizen, async (req, res) => {
  try {
    const requests = await ServiceRequest.find({ citizen_id: req.userId }).sort({ createdAt: -1 }).limit(50);
    res.json({ requests: requests.map((r) => r.toCitizenJSON()) });
  } catch (err) {
    console.error("[requests/mine]", err);
    fail(res, 500, "Could not load your requests.");
  }
});

// ── Citizen: cancel an open request ─────────────────────────────────────
router.post("/:id/cancel", authenticate, requireCitizen, async (req, res) => {
  try {
    const request = await ServiceRequest.findOne({ _id: req.params.id, citizen_id: req.userId });
    if (!request) return fail(res, 404, "Request not found");
    if (request.status !== "open") return fail(res, 409, "A request can be cancelled only while it is still open.");
    request.status = "cancelled";
    await request.save();
    res.json(request.toCitizenJSON());
  } catch (err) {
    console.error("[requests/cancel]", err);
    fail(res, 500, "Could not cancel the request.");
  }
});

// ── Citizen: mark an accepted request done ──────────────────────────────
router.post("/:id/done", authenticate, requireCitizen, async (req, res) => {
  try {
    const request = await ServiceRequest.findOne({ _id: req.params.id, citizen_id: req.userId });
    if (!request) return fail(res, 404, "Request not found");
    if (request.status !== "accepted") return fail(res, 409, "Only an accepted request can be marked done.");
    request.status = "done";
    request.done_at = new Date();
    await request.save();
    await audit({
      actorRole: "citizen", actorIdentifier: String(req.userId), action: "request.done",
      resourceType: "service_request", resourceId: String(request._id), ip: req.ip, success: true,
    });
    res.json(request.toCitizenJSON());
  } catch (err) {
    console.error("[requests/done]", err);
    fail(res, 500, "Could not update the request.");
  }
});

// ── Worker: open requests near me, SCORED with reasons ──────────────────
router.get("/nearby", authenticate, requireWorker, async (req, res) => {
  try {
    const now = new Date();
    const openFilter = { status: "open" };
    // Skill and geography filters are optional narrowing — the score, not a
    // WHERE, decides what surfaces (a carpenter in Ernakulam should still see
    // a Chennai request described as "any trade").
    const { occupation, district } = req.query;
    if (occupation) {
      const occ = String(occupation).trim();
      if (REQUEST_OCCUPATIONS.includes(occ)) return applyFilter({ ...openFilter, occupation: occ });
      return fail(res, 422, "Unknown occupation filter");
    }
    if (district) openFilter.district = stateRegexEscape(String(district).trim());

    async function applyFilter(filter) {
      const [requests, worker] = await Promise.all([
        ServiceRequest.find(filter).sort({ createdAt: -1 }).limit(200),
        User.findById(req.userId).select("occupation current_district current_state current_village_or_city"),
      ]);
      const scored = requests
        .map((r) => r.toWorkerJSON(scoreServiceRequest(r.toJSON(), worker?.toJSON() ?? {}, now)))
        .filter((r) => r.match.score >= MIN_MATCH_SCORE)
        .sort((a, b) => b.match.score - a.match.score || (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 50);
      res.json({
        requests: scored,
        total: scored.length,
        matching_note:
          "Requests are ranked by how well the need matches your trade and area. This is guidance, not a promise of work.",
      });
    }
    await applyFilter(openFilter);
  } catch (err) {
    console.error("[requests/nearby]", err);
    fail(res, 500, "Could not load nearby requests.");
  }
});

// ── Worker: accept an open request (reveals phones to BOTH sides) ───────
router.post("/:id/accept", authenticate, requireWorker, async (req, res) => {
  try {
    if (req.userRole !== "worker") return fail(res, 403, "Worker access required");
    const request = await ServiceRequest.findOne({ _id: req.params.id, status: "open" });
    if (!request) return fail(res, 404, "Request not found or already taken.");

    const worker = await workerById(req.userId);
    if (!worker) return fail(res, 404, "Worker not found");
    if ((worker.gov_approve_status ?? "pending") !== "accepted") {
      return res.status(403).json({
        detail: "Your registration is pending government acceptance. Once a labour office accepts you, you can accept house requests.",
        code: "gov_approval_pending",
      });
    }
    if (!worker.is_phone_verified) return fail(res, 403, "Verify your mobile number in the app first.");

    request.accepted_worker_id = worker._id;
    request.accepted_worker_code = worker.worker_id;
    request.accepted_worker_name = worker.full_name;
    request.accepted_worker_phone = worker.mobile_number; // reveal point
    request.worker_occupation = worker.occupation;
    request.accepted_at = new Date();
    request.status = "accepted"; // single-writer: nobody can accept twice (404 first)
    await request.save();

    await audit({
      actorRole: "worker", actorIdentifier: worker.worker_id, action: "request.accepted",
      resourceType: "service_request", resourceId: String(request._id), ip: req.ip, success: true,
    });
    res.json(request.toAcceptedWorkerJSON());
  } catch (err) {
    console.error("[requests/accept]", err);
    fail(res, 500, "Could not accept the request.");
  }
});

// ── Worker: my accepted requests (citizen contact usable safely) ────────
router.get("/accepted", authenticate, requireWorker, async (req, res) => {
  try {
    const requests = await ServiceRequest.find({
      accepted_worker_id: req.userId,
      status: { $in: ["accepted", "done"] },
    }).sort({ accepted_at: -1 }).limit(50);
    res.json({ requests: requests.map((r) => r.toAcceptedWorkerJSON()) });
  } catch (err) {
    console.error("[requests/accepted]", err);
    fail(res, 500, "Could not load your accepted requests.");
  }
});

export default router;
