import { Router } from "express";
import mongoose from "mongoose";
import { JobPosting, JOB_STATUSES, WORK_TYPES, WAGE_PERIODS } from "../models/JobPosting.js";
import { JobApplication } from "../models/JobApplication.js";
import { User } from "../models/User.js";
import { JOB_OCCUPATIONS } from "../utils/occupations.js";
import { MIN_MATCH_SCORE, withMatch } from "../utils/jobMatch.js";
import { authenticate, requireWorker, requireGovernment, audit } from "../middleware/auth.js";

const router = Router();

const fail = (res, err, msg) => {
  console.error("[jobs]", err);
  res.status(500).json({ detail: msg });
};

const isOid = (id) => mongoose.isValidObjectId(id);
const clampLimit = (raw, fallback = 50, max = 100) => {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

function cleanText(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function normalisePhone(value) {
  if (value === undefined || value === null || String(value).trim() === "") return { phone: null };
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return { error: "contact_phone must contain 10 to 15 digits" };
  return { phone: digits };
}

/** Jurisdiction rules for creating a listing. */
async function resolveScope(officialId, body) {
  const official = await User.findById(officialId).select(
    "role state district department is_superadmin"
  );
  if (!official || official.role !== "government") return { forbidden: true };

  if (official.is_superadmin) {
    const state = cleanText(body?.state, 80);
    if (!state) return { error: "state is required for a superadmin listing" };
    return { official, state, district: cleanText(body?.district, 80) };
  }

  if (!official.state) return { forbidden: true }; // fail closed
  if (body?.state && String(body.state) !== official.state) return { forbidden: true };
  if (official.district) {
    if (body?.district && String(body.district) !== official.district) return { forbidden: true };
    return { official, state: official.state, district: official.district };
  }
  return { official, state: official.state, district: cleanText(body?.district, 80) };
}

function validateJob(body) {
  const title = cleanText(body?.title, 120);
  if (!title || title.length < 5) return { error: "title must be at least 5 characters" };

  const description = cleanText(body?.description, 2000);
  if (!description || description.length < 20) {
    return { error: "description must be at least 20 characters" };
  }

  const employer_name = cleanText(body?.employer_name, 120);
  if (!employer_name || employer_name.length < 2) {
    return { error: "employer_name must be at least 2 characters" };
  }

  const occupation = cleanText(body?.occupation, 40) || "any";
  if (!JOB_OCCUPATIONS.includes(occupation)) {
    return { error: `occupation must be one of: ${JOB_OCCUPATIONS.join(", ")}` };
  }

  const work_type = cleanText(body?.work_type, 20) || "daily";
  if (!WORK_TYPES.includes(work_type)) {
    return { error: `work_type must be one of: ${WORK_TYPES.join(", ")}` };
  }

  const wage_period = cleanText(body?.wage_period, 10) || "day";
  if (!WAGE_PERIODS.includes(wage_period)) {
    return { error: `wage_period must be one of: ${WAGE_PERIODS.join(", ")}` };
  }

  const num = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const wage_min = num(body?.wage_min);
  const wage_max = num(body?.wage_max);
  if (Number.isNaN(wage_min) || (wage_min !== null && wage_min < 0)) {
    return { error: "wage_min must be a number ≥ 0" };
  }
  if (Number.isNaN(wage_max) || (wage_max !== null && wage_max < 0)) {
    return { error: "wage_max must be a number ≥ 0" };
  }
  if (wage_min !== null && wage_max !== null && wage_max < wage_min) {
    return { error: "wage_max cannot be lower than wage_min" };
  }

  let openings = 1;
  if (body?.openings !== undefined && body?.openings !== null && body?.openings !== "") {
    openings = Number(body.openings);
    if (!Number.isInteger(openings) || openings < 1 || openings > 500) {
      return { error: "openings must be an integer between 1 and 500" };
    }
  }

  const { phone, error: phoneError } = normalisePhone(body?.contact_phone);
  if (phoneError) return { error: phoneError };

  return {
    value: {
      title,
      description,
      employer_name,
      occupation,
      work_location: cleanText(body?.work_location, 160),
      wage_min,
      wage_max,
      wage_period,
      work_type,
      openings,
      contact_phone: phone,
    },
  };
}

/** Is this official allowed to manage this posting? */
function canManage(official, job) {
  return Boolean(official?.is_superadmin) || String(job.posted_by) === String(official?._id);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Matched jobs for the signed-in worker ─────────────────────────────
router.get("/", authenticate, requireWorker, async (req, res) => {
  try {
    const worker = await User.findById(req.userId)
      .select("occupation current_district current_state")
      .lean();

    const filter = { status: "open" };
    if (req.query.district) filter.district = String(req.query.district);
    if (req.query.state) filter.state = String(req.query.state);
    if (req.query.occupation && JOB_OCCUPATIONS.includes(String(req.query.occupation))) {
      filter.occupation = String(req.query.occupation);
    }

    const candidates = await JobPosting.find(filter).sort({ createdAt: -1 }).limit(300);
    const now = new Date();
    const q = req.query.q ? String(req.query.q).trim().toLowerCase() : "";

    let jobs = candidates
      .map((job) => withMatch(job.toJSON(), worker || {}, now))
      .filter((job) => job.match.score >= MIN_MATCH_SCORE);

    if (q) {
      jobs = jobs.filter((job) =>
        [job.title, job.employer_name, job.work_location, job.district, job.state]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      );
    }

    jobs.sort((a, b) => b.match.score - a.match.score || new Date(b.created_at) - new Date(a.created_at));
    const limit = clampLimit(req.query.limit, 50);
    jobs = jobs.slice(0, limit);

    // Applied state for this worker only.
    const applied = await JobApplication.find({
      worker_id: req.userId,
      status: "submitted",
      job_id: { $in: jobs.map((j) => j.id) },
    }).select("job_id");
    const appliedIds = new Set(applied.map((a) => String(a.job_id)));

    res.json({
      jobs: jobs.map((job) => ({ ...job, applied: appliedIds.has(job.id) })),
      total: jobs.length,
      matching_note:
        "Match scores are guidance based on the trade, district and listing age you provided. They are not a promise of work or of the stated wage.",
    });
  } catch (err) {
    fail(res, err, "Could not load job matches.");
  }
});

// ── My applications ──────────────────────────────────────────────────
router.get("/applications/mine", authenticate, requireWorker, async (req, res) => {
  try {
    const applications = await JobApplication.find({ worker_id: req.userId, status: "submitted" })
      .sort({ createdAt: -1 })
      .populate("job_id");

    res.json({
      applications: applications
        .filter((a) => a.job_id)
        .map((a) => ({
          ...a.toJSON(),
          job: a.job_id.toJSON(),
        })),
    });
  } catch (err) {
    fail(res, err, "Could not load your applications.");
  }
});

// ── Listings I posted (government) ───────────────────────────────────
router.get("/posted", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId).select("is_superadmin state district");
    if (!official) return res.status(401).json({ detail: "Not authenticated" });

    // Non-superadmins only ever see their own postings. A superadmin sees all,
    // which is the same visibility rule used for grievances.
    const filter = official.is_superadmin ? {} : { posted_by: official._id };
    const jobs = await JobPosting.find(filter).sort({ createdAt: -1 }).limit(200);

    const counts = await JobApplication.aggregate([
      { $match: { job_id: { $in: jobs.map((j) => j._id) }, status: "submitted" } },
      { $group: { _id: "$job_id", n: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.n]));

    res.json({
      jobs: jobs.map((j) => ({ ...j.toJSON(), applications_count: countMap.get(String(j._id)) ?? 0 })),
    });
  } catch (err) {
    fail(res, err, "Could not load your job listings.");
  }
});

// ── Create a listing (government, within own jurisdiction) ───────────
router.post("/", authenticate, requireGovernment, async (req, res) => {
  try {
    const scope = await resolveScope(req.userId, req.body);
    if (scope.forbidden) return res.status(403).json({ detail: "Listing is outside your jurisdiction" });

    const { value, error } = validateJob(req.body);
    if (error) return res.status(422).json({ detail: error });

    const job = await JobPosting.create({
      ...value,
      state: scope.state,
      district: scope.district,
      posted_by: scope.official._id,
      posted_by_department: scope.official.department || null,
    });

    await audit({
      actorRole: "government",
      actorIdentifier: req.userId,
      action: "job.create",
      resourceType: "job_posting",
      resourceId: String(job._id),
      ip: req.ip,
      success: true,
    });

    res.status(201).json(job.toJSON());
  } catch (err) {
    fail(res, err, "Could not create the job listing.");
  }
});

// ── Open / close a listing I posted ──────────────────────────────────
router.patch("/:id/status", authenticate, requireGovernment, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Listing not found" });
    const status = String(req.body?.status || "");
    if (!JOB_STATUSES.includes(status)) {
      return res.status(422).json({ detail: `status must be one of: ${JOB_STATUSES.join(", ")}` });
    }

    const official = await User.findById(req.userId).select("is_superadmin");
    const job = await JobPosting.findById(req.params.id);
    if (!job) return res.status(404).json({ detail: "Listing not found" });
    if (!canManage(official, job)) return res.status(404).json({ detail: "Listing not found" });

    job.status = status;
    await job.save();

    await audit({
      actorRole: "government",
      actorIdentifier: req.userId,
      action: "job.status",
      resourceType: "job_posting",
      resourceId: String(job._id),
      ip: req.ip,
      success: true,
    });

    res.json(job.toJSON());
  } catch (err) {
    fail(res, err, "Could not update the listing.");
  }
});

// ── Applicants for a listing I posted ────────────────────────────────
router.get("/:id/applications", authenticate, requireGovernment, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Listing not found" });
    const official = await User.findById(req.userId).select("is_superadmin");
    const job = await JobPosting.findById(req.params.id);
    if (!job) return res.status(404).json({ detail: "Listing not found" });
    if (!canManage(official, job)) return res.status(404).json({ detail: "Listing not found" });

    const applications = await JobApplication.find({ job_id: job._id, status: "submitted" }).sort({
      createdAt: -1,
    });

    res.json({ applications: applications.map((a) => a.toOfficialJSON()) });
  } catch (err) {
    fail(res, err, "Could not load applicants.");
  }
});

// ── One listing ──────────────────────────────────────────────────────
router.get("/:id", authenticate, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Listing not found" });
    const job = await JobPosting.findById(req.params.id);
    if (!job) return res.status(404).json({ detail: "Listing not found" });

    if (req.userRole === "government") {
      const official = await User.findById(req.userId).select("is_superadmin");
      if (!canManage(official, job)) return res.status(404).json({ detail: "Listing not found" });
      return res.json({ ...job.toJSON(), applied: false });
    }

    // Workers can open an open listing, or any listing they applied to.
    const application = await JobApplication.findOne({ job_id: job._id, worker_id: req.userId });
    if (job.status !== "open" && application?.status !== "submitted") {
      return res.status(404).json({ detail: "Listing not found" });
    }
    res.json({ ...job.toJSON(), applied: application?.status === "submitted" });
  } catch (err) {
    fail(res, err, "Could not load the listing.");
  }
});

// ── Apply to a listing ───────────────────────────────────────────────
router.post("/:id/apply", authenticate, requireWorker, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Listing not found" });
    const job = await JobPosting.findById(req.params.id);
    if (!job) return res.status(404).json({ detail: "Listing not found" });
    if (job.status !== "open") {
      return res.status(409).json({ detail: "This listing is closed.", code: "job_closed" });
    }

    const existing = await JobApplication.findOne({ job_id: job._id, worker_id: req.userId });
    if (existing?.status === "submitted") {
      return res.status(409).json({ detail: "You have already applied.", code: "already_applied" });
    }

    const worker = await User.findById(req.userId).select(
      "worker_id full_name occupation current_district current_state mobile_number"
    );

    const shareContact = Boolean(req.body?.share_contact);
    const note = cleanText(req.body?.note, 300);

    const application = existing
      ? await JobApplication.findByIdAndUpdate(
          existing._id,
          {
            status: "submitted",
            note,
            share_contact: shareContact,
            contact_phone: shareContact ? worker?.mobile_number ?? null : null,
            worker_snapshot: {
              worker_code: worker?.worker_id ?? null,
              full_name: worker?.full_name ?? null,
              occupation: worker?.occupation ?? null,
              district: worker?.current_district ?? null,
              state: worker?.current_state ?? null,
            },
          },
          { new: true }
        )
      : await JobApplication.create({
          job_id: job._id,
          worker_id: req.userId,
          note,
          share_contact: shareContact,
          contact_phone: shareContact ? worker?.mobile_number ?? null : null,
          worker_snapshot: {
            worker_code: worker?.worker_id ?? null,
            full_name: worker?.full_name ?? null,
            occupation: worker?.occupation ?? null,
            district: worker?.current_district ?? null,
            state: worker?.current_state ?? null,
          },
        });

    await audit({
      actorRole: "worker",
      actorIdentifier: req.userId,
      action: "job.apply",
      resourceType: "job_posting",
      resourceId: String(job._id),
      ip: req.ip,
      success: true,
    });

    res.status(existing ? 200 : 201).json(application.toJSON());
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ detail: "You have already applied.", code: "already_applied" });
    }
    fail(res, err, "Could not apply to this job.");
  }
});

// ── Withdraw my application ──────────────────────────────────────────
router.delete("/:id/apply", authenticate, requireWorker, async (req, res) => {
  try {
    if (!isOid(req.params.id)) return res.status(404).json({ detail: "Application not found" });
    const application = await JobApplication.findOneAndUpdate(
      { job_id: req.params.id, worker_id: req.userId, status: "submitted" },
      { status: "withdrawn", contact_phone: null },
      { new: true }
    );
    if (!application) return res.status(404).json({ detail: "Application not found" });
    res.json({ detail: "Application withdrawn" });
  } catch (err) {
    fail(res, err, "Could not withdraw the application.");
  }
});

export default router;
