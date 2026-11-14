import { Router } from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Grievance, GRIEVANCE_STATUSES } from "../models/Grievance.js";
import { PushNotification, WorkerNotification } from "../models/Notification.js";
import { AuditLog } from "../models/Document.js";
import { authenticate, requireGovernment, audit } from "../middleware/auth.js";
import { toCsv, sendCsv, datedFilename } from "../utils/csv.js";
import { InsurancePolicy } from "../models/InsurancePolicy.js";
import { policyStatus, maskPolicyNumber } from "../utils/insurance.js";
import { daysOverdue, OPEN_GRIEVANCE_STATUSES } from "../utils/slaEscalation.js";
import {
  grievanceScopeFilter,
  officialCanSeeGrievance,
  notifiableWorkerIds,
  workerScopeFilter,
} from "../utils/scope.js";

const router = Router();

// ── Dashboard stats (Mongo aggregation, grouped server-side, SCOPED) ──
router.get("/dashboard/stats", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const { workerFilter, grievanceFilter } = await grievanceScopeFilter(official);
    const employerFilter = employerScopeFilter(official);

    const [
      total_workers,
      active_workers,
      total_grievances,
      open_grievances,
      resolved_grievances,
      urgent_grievances,
      total_employers,
      pending_employers,
    ] = await Promise.all([
      User.countDocuments(workerFilter),
      User.countDocuments({ ...workerFilter, is_active: true }),
      Grievance.countDocuments(grievanceFilter),
      Grievance.countDocuments({ ...grievanceFilter, status: { $in: ["submitted", "under_review"] } }),
      Grievance.countDocuments({ ...grievanceFilter, status: "resolved" }),
      Grievance.countDocuments({ ...grievanceFilter, priority: "urgent", status: { $nin: ["resolved", "rejected", "withdrawn"] } }),
      User.countDocuments({ role: "employer", ...employerFilter }),
      User.countDocuments({ role: "employer", ...employerFilter, gov_approve_status: "pending" }),
    ]);

    const [byCategory, byStatus, byState, recent] = await Promise.all([
      Grievance.aggregate([
        { $match: grievanceFilter },
        { $group: { _id: "$category", n: { $sum: 1 } } },
      ]),
      Grievance.aggregate([
        { $match: grievanceFilter },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]),
      // Count WORKERS per state (distinct users) — not grievances, which would
      // inflate the chart by counting each worker's complaints individually.
      // Scoped: non-superadmins see only their own state's slice.
      User.aggregate([
        { $match: { ...workerFilter, current_state: { $ne: null } } },
        { $group: { _id: "$current_state", n: { $sum: 1 } } },
      ]),
      Grievance.find(grievanceFilter).sort({ createdAt: -1 }).limit(8),
    ]);

    const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id ?? "unknown", r.n]));
    res.json({
      total_workers,
      active_workers,
      total_grievances,
      open_grievances,
      resolved_grievances,
      urgent_grievances,
      total_employers,
      pending_employers,
      grievances_by_category: toMap(byCategory),
      grievances_by_status: toMap(byStatus),
      workers_by_state: toMap(byState),
      recent_filings: recent.map((g) => ({
        id: String(g._id),
        complaint_number: g.complaint_number,
        category: g.category,
        subject: g.subject,
        status: g.status,
        created_at: g.createdAt,
      })),
    });
  } catch (err) {
    console.error("[gov/stats]", err);
    res.status(500).json({ detail: "Could not load stats." });
  }
});

// ── Worker acceptance queue (register → government accepts/rejects) ──
router.get("/worker-approvals", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const status = ["pending", "accepted", "rejected"].includes(String(req.query.status))
      ? String(req.query.status)
      : "pending";
    const filter = { role: "worker", ...workerScopeFilter(official), gov_approve_status: status };
    const search = String(req.query.search || "").trim();
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ full_name: rx }, { worker_id: rx }, { mobile_number: rx }];
    }
    const workers = await User.find(filter).sort({ createdAt: -1 }).limit(200);
    const counts = await Promise.all(
      ["pending", "accepted", "rejected"].map(async (s) =>
        ({ [s]: await User.countDocuments({ role: "worker", ...workerScopeFilter(official), gov_approve_status: s }) })
      )
    );
    res.json({
      status,
      counts: Object.assign({}, ...counts),
      workers: workers.map((w) => ({
        id: String(w._id),
        worker_id: w.worker_id,
        full_name: w.full_name,
        mobile_number: w.mobile_number,
        occupation: w.occupation,
        current_state: w.current_state,
        current_district: w.current_district,
        gov_approve_status: w.gov_approve_status,
        created_at: w.createdAt,
      })),
    });
  } catch (err) {
    console.error("[gov/approvals]", err);
    res.status(500).json({ detail: "Could not load the acceptance queue." });
  }
});

router.patch("/workers/:id/approval", authenticate, requireGovernment, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ detail: "Worker not found" });
    const status = String(req.body?.status || "");
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(422).json({ detail: "status must be one of: accepted, rejected" });
    }
    const official = await User.findById(req.userId);
    const worker = await User.findById(req.params.id).select("worker_id role gov_approve_status");
    if (!worker || worker.role !== "worker") return res.status(404).json({ detail: "Worker not found" });

    // Jurisdiction boundary: an official outside the worker's registered
    // state/district (and any non-superadmin) gets the same 404 as a missing
    // worker, exactly like the grievance queue.
    const { workerFilter } = await grievanceScopeFilter(official);
    const inScope = await User.countDocuments({ _id: worker._id, ...workerFilter });
    if (!inScope) return res.status(404).json({ detail: "Worker not found" });

    worker.gov_approve_status = status;
    worker.gov_approve_at = status === "accepted" ? new Date() : null;
    worker.gov_approve_by = official._id;
    await worker.save();

    await audit({
      actorRole: "government",
      actorIdentifier: req.userId,
      action: "worker.approval",
      resourceType: "user",
      resourceId: String(worker._id),
      ip: req.ip,
      success: true,
    });
    res.json({ id: String(worker._id), worker_id: worker.worker_id, gov_approve_status: worker.gov_approve_status });
  } catch (err) {
    console.error("[gov/approval]", err);
    res.status(500).json({ detail: "Could not update the approval." });
  }
});

/**
 * Employer review scope. Employers register an OPTIONAL business location
 * (current_state / current_district), so staffing rules differ from workers:
 *  - an employer WITH a district is reviewable by that district's officials;
 *  - an employer with only a state (or none at all) is reviewable by their
 *    state officials; location-less employers fall to whoever can see them —
 *    never dropped silently (fail visible, not fail open for citizens).
 */
function employerScopeFilter(official) {
  if (!official) return { _id: null };
  if (official.is_superadmin) return {};
  if (official.district) {
    return {
      $or: [
        { current_district: official.district },
        { current_district: null },
        { current_district: "" },
      ],
    };
  }
  if (official.state) {
    return {
      $or: [{ current_state: official.state }, { current_state: null }, { current_state: "" }],
    };
  }
  return { _id: null }; // fail closed, same rule as workers
}

// ── Employer acceptance queue (new employer → labour office accepts) ──
// Mirrors worker-approvals: pending/accepted/rejected segments with counts,
// search, and the same jurisdiction logic so employers cannot pick their own
// reviewing office.
router.get("/employer-approvals", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const status = ["pending", "accepted", "rejected"].includes(String(req.query.status))
      ? String(req.query.status)
      : "pending";
    const search = String(req.query.search || "").trim();
    const base = { role: "employer", ...employerScopeFilter(official) };
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      base.$or = [{ full_name: rx }, { business_name: rx }, { mobile_number: rx }];
    }

    const filter = { ...base, gov_approve_status: status };
    const [employers, pendingCount, acceptedCount, rejectedCount] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).limit(200),
      User.countDocuments({ ...base, gov_approve_status: "pending" }),
      User.countDocuments({ ...base, gov_approve_status: "accepted" }),
      User.countDocuments({ ...base, gov_approve_status: "rejected" }),
    ]);
    res.json({
      status,
      counts: { pending: pendingCount, accepted: acceptedCount, rejected: rejectedCount },
      employers: employers.map((e) => ({
        id: String(e._id),
        full_name: e.full_name,
        business_name: e.business_name,
        mobile_number: e.mobile_number,
        current_state: e.current_state,
        current_district: e.current_district,
        gov_approve_status: e.gov_approve_status,
        created_at: e.createdAt,
      })),
      notice:
        "Accepting an employer lets it post listings publicly and rate workers. ShramSetu does not certify businesses — acceptance records that a labour office reviewed the account.",
    });
  } catch (err) {
    console.error("[gov/employer-approvals]", err);
    res.status(500).json({ detail: "Could not load the employer acceptance queue." });
  }
});

router.patch("/employers/:id/approval", authenticate, requireGovernment, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ detail: "Employer not found" });
    const status = String(req.body?.status || "");
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(422).json({ detail: "status must be one of: accepted, rejected" });
    }
    const official = await User.findById(req.userId);
    const employer = await User.findById(req.params.id).select("full_name role gov_approve_status");
    if (!employer || employer.role !== "employer") return res.status(404).json({ detail: "Employer not found" });

    const scoped = await User.countDocuments({ _id: employer._id, ...employerScopeFilter(official) });
    if (!scoped) return res.status(404).json({ detail: "Employer not found" });

    employer.gov_approve_status = status;
    employer.gov_approve_at = status === "accepted" ? new Date() : null;
    employer.gov_approve_by = official._id;
    await employer.save();

    await audit({
      actorRole: "government",
      actorIdentifier: req.userId,
      action: "employer.approval",
      resourceType: "user",
      resourceId: String(employer._id),
      ip: req.ip,
      success: true,
    });
    res.json({ id: String(employer._id), gov_approve_status: employer.gov_approve_status });
  } catch (err) {
    console.error("[gov/employer-approval]", err);
    res.status(500).json({ detail: "Could not update the approval." });
  }
});

// ── Workers list (scoped) ────────────────────────────────────────────
router.get("/workers", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const search = String(req.query.search || "").trim();
    const filter = workerScopeFilter(official);
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ full_name: rx }, { worker_id: rx }, { mobile_number: rx }, { occupation: rx }];
    }
    const total = await User.countDocuments(filter);
    const workers = await User.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({
      total,
      workers: workers.map((w) => ({
        id: String(w._id),
        worker_id: w.worker_id,
        full_name: w.full_name,
        occupation: w.occupation,
        current_state: w.current_state,
        current_district: w.current_district,
        is_active: w.is_active,
        created_at: w.createdAt,
      })),
    });
  } catch (err) {
    console.error("[gov/workers]", err);
    res.status(500).json({ detail: "Could not load workers." });
  }
});

// ── CSV exports (scoped) ─────────────────────────────────────────────
// The Flask reference app let a labour-office admin download the worker and
// grievance lists as CSV. Both exports below reuse the same scope filters as
// the on-screen lists, so an official can never download a row they cannot
// already see, and every export is written to the audit log — a bulk copy of
// worker data is exactly the kind of read that should leave a trace.
const EXPORT_ROW_CAP = 5000;

router.get("/export/workers.csv", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const filter = workerScopeFilter(official);
    const search = String(req.query.search || "").trim();
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ full_name: rx }, { worker_id: rx }, { occupation: rx }];
    }

    const rows = await User.find(filter)
      .sort({ createdAt: -1 })
      .limit(EXPORT_ROW_CAP)
      .lean();

    // Dates are normalised to ISO before serialising: a raw Date reaches the
    // CSV as "Thu Oct 22 2026 11:55:19 GMT+0530 (India Standard Time)", which
    // is both unreadable in Excel and full of commas.
    const csv = toCsv(
      rows.map((w) => ({
        ...w,
        createdAt: w.createdAt ? new Date(w.createdAt).toISOString() : "",
      })),
      [
        { key: "worker_id", header: "Worker ID" },
        { key: "full_name", header: "Name" },
        { key: "mobile_number", header: "Mobile" },
        { key: "occupation", header: "Occupation" },
        { key: "years_of_experience", header: "Experience (years)" },
        { key: "current_village_or_city", header: "Village / city" },
        { key: "current_district", header: "District" },
        { key: "current_state", header: "State" },
        { key: "gov_approve_status", header: "Approval" },
        { key: "is_active", header: "Active" },
        { key: "createdAt", header: "Registered" },
      ],
    );

    await audit({
      actorRole: "government",
      actorIdentifier: official?.employee_id ?? req.userId,
      action: "export.workers_csv",
      resourceType: "user",
      resourceId: null,
      ip: req.ip,
      success: true,
    });

    sendCsv(res, datedFilename("workers"), csv);
  } catch (err) {
    console.error("[gov/export/workers]", err);
    res.status(500).json({ detail: "Could not build the worker export." });
  }
});

router.get("/export/grievances.csv", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const { grievanceFilter } = await grievanceScopeFilter(official);
    const filter = { ...grievanceFilter };
    if (req.query.status_filter) filter.status = String(req.query.status_filter);
    if (req.query.category) filter.category = String(req.query.category);

    const rows = await Grievance.find(filter)
      .sort({ createdAt: -1 })
      .limit(EXPORT_ROW_CAP)
      .populate("owner_id")
      .lean();

    const csv = toCsv(
      rows.map((g) => ({
        ...g,
        worker_id: g.owner_id?.worker_id ?? "",
        worker_name: g.owner_id?.full_name ?? "",
        createdAt: g.createdAt ? new Date(g.createdAt).toISOString() : "",
        incident_date: g.incident_date ? new Date(g.incident_date).toISOString() : "",
        resolved_at: g.resolved_at ? new Date(g.resolved_at).toISOString() : "",
      })),
      [
        { key: "complaint_number", header: "Complaint no." },
        { key: "createdAt", header: "Filed" },
        { key: "category", header: "Category" },
        { key: "subject", header: "Subject" },
        { key: "status", header: "Status" },
        { key: "priority", header: "Priority" },
        { key: "worker_id", header: "Worker ID" },
        { key: "worker_name", header: "Worker" },
        { key: "employer_name", header: "Employer" },
        { key: "incident_location", header: "Incident location" },
        { key: "incident_date", header: "Incident date" },
        { key: "resolved_at", header: "Resolved" },
      ],
    );

    await audit({
      actorRole: "government",
      actorIdentifier: official?.employee_id ?? req.userId,
      action: "export.grievances_csv",
      resourceType: "grievance",
      resourceId: null,
      ip: req.ip,
      success: true,
    });

    sendCsv(res, datedFilename("grievances"), csv);
  } catch (err) {
    console.error("[gov/export/grievances]", err);
    res.status(500).json({ detail: "Could not build the grievance export." });
  }
});

// ── Grievances management (scoped) ───────────────────────────────────
router.get("/grievances", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const { grievanceFilter } = await grievanceScopeFilter(official);
    const filter = { ...grievanceFilter };
    if (req.query.status_filter) filter.status = String(req.query.status_filter);
    if (req.query.category) filter.category = String(req.query.category);
    const total = await Grievance.countDocuments(filter);
    const rows = await Grievance.find(filter).sort({ createdAt: -1 }).limit(500).populate("owner_id");
    res.json({
      total,
      grievances: rows.map((g) => ({
        id: String(g._id),
        complaint_number: g.complaint_number,
        category: g.category,
        subject: g.subject,
        description: g.description,
        status: g.status,
        employer_name: g.employer_name,
        incident_location: g.incident_location,
        incident_date: g.incident_date,
        created_at: g.createdAt,
        updated_at: g.updatedAt,
        resolved_at: g.resolved_at,
        worker: g.owner_id
          ? {
              worker_id: g.owner_id.worker_id,
              full_name: g.owner_id.full_name,
              occupation: g.owner_id.occupation,
              current_state: g.owner_id.current_state,
              current_district: g.owner_id.current_district,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error("[gov/grievances]", err);
    res.status(500).json({ detail: "Could not load grievances." });
  }
});

// ── Overdue escalations (scoped) ─────────────────────────────────────
// What the labour office owes an answer on, oldest breach first. Scoped by the
// same filter as the grievance list, so an official never sees a complaint
// outside their jurisdiction — and the escalation level says how far up the
// ladder it has already gone (1 = district told, 2 = state told).
router.get("/escalations", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    if (!official) return res.status(401).json({ detail: "Sign in again." });

    const { grievanceFilter } = await grievanceScopeFilter(official);
    const now = new Date();
    const filter = {
      ...grievanceFilter,
      status: { $in: OPEN_GRIEVANCE_STATUSES },
      sla_deadline: { $ne: null, $lt: now },
    };

    const total = await Grievance.countDocuments(filter);
    const rows = await Grievance.find(filter)
      .sort({ sla_deadline: 1 })
      .limit(200)
      .populate("owner_id")
      .lean();

    res.set("Cache-Control", "no-store");
    res.json({
      total,
      escalations: rows.map((g) => ({
        id: String(g._id),
        complaint_number: g.complaint_number,
        category: g.category,
        subject: g.subject,
        status: g.status,
        priority: g.priority,
        sla_deadline: g.sla_deadline,
        days_overdue: daysOverdue(g.sla_deadline, now),
        escalation_level: g.escalation_level ?? 0,
        escalated_at: g.escalated_at ?? null,
        state_escalated_at: g.state_escalated_at ?? null,
        district: g.owner_district ?? g.owner_id?.current_district ?? null,
        state: g.owner_state ?? g.owner_id?.current_state ?? null,
        worker: g.owner_id
          ? {
              worker_id: g.owner_id.worker_id ?? null,
              full_name: g.owner_id.full_name ?? null,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error("[gov/escalations]", err);
    res.status(500).json({ detail: "Could not load overdue complaints." });
  }
});

router.get("/grievances/:id", authenticate, requireGovernment, async (req, res) => {
  try {
    const g = await Grievance.findById(req.params.id).populate("owner_id");
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    const official = await User.findById(req.userId);
    const { workerIds } = await grievanceScopeFilter(official);
    if (!officialCanSeeGrievance(g, official, workerIds)) {
      return res.status(403).json({ detail: "This grievance is outside your jurisdiction." });
    }
    res.json({
      id: String(g._id),
      complaint_number: g.complaint_number,
      category: g.category,
      subject: g.subject,
      description: g.description,
      status: g.status,
      priority: g.priority,
      escalated: g.escalated,
      sla_deadline: g.sla_deadline,
      employer_name: g.employer_name,
      incident_location: g.incident_location,
      incident_date: g.incident_date,
      created_at: g.createdAt,
      updated_at: g.updatedAt,
      resolved_at: g.resolved_at,
      worker: g.owner_id
        ? {
            worker_id: g.owner_id.worker_id,
            full_name: g.owner_id.full_name,
            occupation: g.owner_id.occupation,
            current_state: g.owner_id.current_state,
            current_district: g.owner_id.current_district,
          }
        : null,
      comments: (g.comments || []).map((c) => ({
        id: c.id, author_name: c.author_name, author_role: c.author_role,
        content: c.content, is_internal: c.is_internal, created_at: c.created_at,
      })),
      timeline: (g.timeline || []).map((t) => ({
        status: t.status, note: t.note ?? null, changed_by: t.changed_by, created_at: t.created_at,
      })),
      attachments: (g.attachments || []).map((a) => ({
        id: a.id, original_filename: a.original_filename, content_type: a.content_type, size_bytes: a.size_bytes, created_at: a.created_at,
      })),
    });
  } catch (err) {
    console.error("[gov/grievance detail]", err);
    res.status(500).json({ detail: "Could not load grievance." });
  }
});

const VALID_TRANSITIONS = {
  submitted: ["under_review", "rejected"],
  under_review: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
  withdrawn: [],
};

router.post("/grievances/:id/status", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const g = await Grievance.findById(req.params.id);
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    const { workerIds } = await grievanceScopeFilter(official);
    if (!officialCanSeeGrievance(g, official, workerIds)) {
      return res.status(403).json({ detail: "This grievance is outside your jurisdiction." });
    }

    const newStatus = String(req.body?.status || "");
    if (!GRIEVANCE_STATUSES.includes(newStatus)) {
      return res.status(422).json({ detail: "Invalid status." });
    }
    if (!(VALID_TRANSITIONS[g.status] || []).includes(newStatus)) {
      return res.status(400).json({ detail: `Cannot move from ${g.status} to ${newStatus}.` });
    }
    const old = g.status;
    g.status = newStatus;
    if (newStatus === "resolved") g.resolved_at = new Date();
    g.timeline.push({
      status: newStatus,
      note: req.body?.note ? String(req.body.note).trim() : null,
      changed_by: official ? official.full_name : "Government",
      created_at: new Date(),
    });
    await g.save();
    await audit({ actorRole: "government", actorIdentifier: official?.employee_id ?? req.userId, action: "grievance.status", resourceType: "grievance", resourceId: String(g._id), ip: req.ip, success: true });
    res.json({ detail: "Status updated", old_status: old, new_status: newStatus });
  } catch (err) {
    console.error("[gov/status]", err);
    res.status(500).json({ detail: "Could not update status." });
  }
});

router.post("/grievances/:id/comment", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const g = await Grievance.findById(req.params.id);
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    const { workerIds } = await grievanceScopeFilter(official);
    if (!officialCanSeeGrievance(g, official, workerIds)) {
      return res.status(403).json({ detail: "This grievance is outside your jurisdiction." });
    }
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(422).json({ detail: "content is required" });
    g.comments.push({
      id: crypto.randomUUID().slice(0, 12),
      author_name: official ? official.full_name : "Government",
      author_role: "government",
      content,
      is_internal: Boolean(req.body?.is_internal),
      created_at: new Date(),
    });
    await g.save();
    res.status(201).json({ detail: "Comment added" });
  } catch (err) {
    console.error("[gov/comment]", err);
    res.status(500).json({ detail: "Could not add comment." });
  }
});

// ── Notifications: scoped send + sent history ────────────────────────
router.get("/notifications", authenticate, requireGovernment, async (req, res) => {
  try {
    const rows = await PushNotification.find({ sender_id: req.userId }).sort({ createdAt: -1 }).limit(100);
    res.json({ notifications: rows.map((n) => n.toJSON()) });
  } catch (err) {
    console.error("[gov/notifications]", err);
    res.status(500).json({ detail: "Could not load notifications." });
  }
});

router.post("/notifications/send", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!title || !body) {
      return res.status(422).json({ detail: "title and body are required" });
    }
    const target = String(req.body?.target || "all");
    const allowed = ["all", "occupation", "state", "district"];
    if (!allowed.includes(target)) return res.status(422).json({ detail: "Invalid target type." });

    // Jurisdiction enforcement: non-superadmins may only target workers
    // inside their own scope; "all" broadcasts and out-of-scope states or
    // districts are rejected with 403 (not silently narrowed) so the UI
    // cannot mislead the official about who will receive the message.
    const resolved = await notifiableWorkerIds(
      official,
      target,
      req.body?.target_value ? String(req.body.target_value).trim() : null
    );
    if (resolved && resolved.forbidden) {
      return res.status(403).json({ detail: "You may only send notifications within your jurisdiction." });
    }
    const workerIds =
      resolved ??
      // Broadcasts reach registered, verified workers only — accounts that
      // have not finished registration are not notification targets.
      new Set(
        (await User.find({ role: "worker", is_active: true, is_phone_verified: true }).select("_id")).map((w) =>
          String(w._id)
        )
      );
    if (workerIds.size === 0) {
      return res.status(400).json({ detail: "No workers match this target." });
    }

    const pn = await PushNotification.create({
      title, body,
      priority: String(req.body?.priority || "medium"),
      target, target_value: req.body?.target_value ? String(req.body.target_value).trim() : null,
      sender_id: req.userId,
      sender_name: official ? official.full_name : "Government",
      department: official?.department || "general",
      is_broadcast: target === "all",
      sent_count: workerIds.size,
    });
    await WorkerNotification.insertMany(
      [...workerIds].map((wid) => ({ notification_id: pn._id, worker_id: wid, is_read: false }))
    );
    await audit({ actorRole: "government", actorIdentifier: official?.employee_id ?? req.userId, action: "notification.send", resourceType: "notification", resourceId: String(pn._id), ip: req.ip, success: true });
    res.status(201).json({ detail: `Notification queued for ${workerIds.size} workers`, notification_id: String(pn._id), sent_count: workerIds.size });
  } catch (err) {
    console.error("[gov/notifications/send]", err);
    res.status(500).json({ detail: "Could not send notification." });
  }
});

// ── Officials directory (superadmin monitoring) ──────────────────────
// Oversight view: every government account, the jurisdiction it covers,
// and live worker/grievance counts inside that jurisdiction — how the
// superadmin monitors each state official. Non-superadmins get 403:
// officials must not be able to enumerate each other.
router.get("/officials", authenticate, requireGovernment, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    if (!me?.is_superadmin) {
      return res.status(403).json({ detail: "Superadmin access required" });
    }
    const officials = await User.find({ role: "government" }).sort({ employee_id: 1 });
    const rows = await Promise.all(
      officials.map(async (o) => {
        // Same scope machinery as the dashboards — the counts shown here are
        // exactly what that official would see when they log in. The
        // fail-closed official (no jurisdiction) therefore shows 0/0.
        const { workerFilter, grievanceFilter } = await grievanceScopeFilter(o);
        const [workers_in_scope, grievances_in_scope] = await Promise.all([
          User.countDocuments(workerFilter),
          Grievance.countDocuments(grievanceFilter),
        ]);
        return {
          id: String(o._id),
          employee_id: o.employee_id || null,
          full_name: o.full_name,
          department: o.department || null,
          state: o.state || null,
          district: o.district || null,
          is_superadmin: Boolean(o.is_superadmin),
          workers_in_scope,
          grievances_in_scope,
        };
      })
    );
    res.json({ officials: rows });
  } catch (err) {
    console.error("[gov/officials]", err);
    res.status(500).json({ detail: "Could not load officials." });
  }
});

// ── Audit logs (superadmin only) ─────────────────────────────────────
router.get("/audit-logs", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    if (!official?.is_superadmin) {
      return res.status(403).json({ detail: "Superadmin access required" });
    }
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(300);
    res.json({ logs: logs.map((l) => l.toJSON()) });
  } catch (err) {
    console.error("[gov/audit-logs]", err);
    res.status(500).json({ detail: "Could not load audit logs." });
  }
});

// ── Insurance verification queue ─────────────────────────────────────
// A worker's self-declared policy is only worth showing to a household once an
// official has checked it against the insurer or the scheme enrolment list.
// This is that queue, scoped exactly like the worker lists: an official can
// only verify workers inside their own jurisdiction.
const MAX_INSURANCE_ROWS = 200;

function insuranceRow(policy, worker, now) {
  return {
    id: String(policy._id),
    worker: worker
      ? {
          id: String(worker._id),
          worker_id: worker.worker_id ?? null,
          full_name: worker.full_name ?? null,
          district: worker.current_district ?? null,
          state: worker.current_state ?? null,
        }
      : null,
    provider: policy.provider,
    // Officials need the real number to check it with the insurer; the public
    // verify page only ever shows the last four digits.
    policy_number: policy.policy_number,
    coverage: policy.coverage ?? "accident",
    sum_insured: policy.sum_insured ?? null,
    valid_from: policy.valid_from ? new Date(policy.valid_from).toISOString() : null,
    valid_to: policy.valid_to ? new Date(policy.valid_to).toISOString() : null,
    verification: policy.verification,
    verified_at: policy.verified_at ? new Date(policy.verified_at).toISOString() : null,
    status: policyStatus(policy, now),
    masked_number: maskPolicyNumber(policy.policy_number),
  };
}

/**
 * Policies for the officials' own jurisdiction, shaped for the console and the
 * CSV. Shared by both so a downloaded row can never describe something the
 * on-screen list would hide.
 */
async function collectInsuranceRows(official, { verification, status, limit } = {}) {
  const scopedWorkers = await User.find(workerScopeFilter(official))
    .select("_id full_name worker_id current_district current_state")
    .lean();
  const byId = new Map(scopedWorkers.map((w) => [String(w._id), w]));

  const filter = { worker_id: { $in: [...byId.keys()] } };
  if (verification === "self_declared" || verification === "office_verified") {
    filter.verification = verification;
  }

  const policies = await InsurancePolicy.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit ?? MAX_INSURANCE_ROWS)
    .lean();

  const now = new Date();
  return policies
    .map((p) => insuranceRow(p, byId.get(String(p.worker_id)), now))
    .filter((row) => (status ? row.status === status : true));
}

router.get("/insurance", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    if (!official) return res.status(401).json({ detail: "Sign in again." });

    const rows = await collectInsuranceRows(official, {
      verification: String(req.query.verification || "").trim(),
      status: String(req.query.status || "").trim(),
      limit: MAX_INSURANCE_ROWS,
    });

    res.set("Cache-Control", "no-store");
    res.json({ policies: rows, count: rows.length });
  } catch (err) {
    console.error("[gov/insurance]", err);
    res.status(500).json({ detail: "Could not load insurance records." });
  }
});

// The register a district office actually needs on paper: which workers are
// covered, by whom, until when, and whether anyone checked. Scoped and audited
// like the worker and grievance exports — a bulk copy of insurance records is
// a bulk copy of worker data.
router.get("/export/insurance.csv", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    if (!official) return res.status(401).json({ detail: "Sign in again." });

    const rows = await collectInsuranceRows(official, {
      verification: String(req.query.verification || "").trim(),
      status: String(req.query.status || "").trim(),
      limit: EXPORT_ROW_CAP,
    });

    const csv = toCsv(
      rows.map((row) => ({
        worker_id: row.worker?.worker_id ?? "",
        worker_name: row.worker?.full_name ?? "",
        district: row.worker?.district ?? "",
        state: row.worker?.state ?? "",
        provider: row.provider,
        policy_number: row.policy_number,
        coverage: row.coverage,
        sum_insured: row.sum_insured ?? "",
        // Date-only: an ISO timestamp sorts as text anyway and is unreadable
        // in a printed register.
        valid_from: row.valid_from ? row.valid_from.slice(0, 10) : "",
        valid_to: row.valid_to ? row.valid_to.slice(0, 10) : "",
        status: row.status,
        verification: row.verification,
        verified_at: row.verified_at ? row.verified_at.slice(0, 10) : "",
      })),
      [
        { key: "worker_id", header: "Worker ID" },
        { key: "worker_name", header: "Worker" },
        { key: "district", header: "District" },
        { key: "state", header: "State" },
        { key: "provider", header: "Insurer" },
        { key: "policy_number", header: "Policy number" },
        { key: "coverage", header: "Coverage" },
        { key: "sum_insured", header: "Sum insured (INR)" },
        { key: "valid_from", header: "Valid from" },
        { key: "valid_to", header: "Valid to" },
        { key: "status", header: "Status" },
        { key: "verification", header: "Verification" },
        { key: "verified_at", header: "Verified on" },
      ],
    );

    await audit({
      actorRole: "government",
      actorIdentifier: official?.employee_id ?? req.userId,
      action: "export.insurance_csv",
      resourceType: "insurance_policy",
      resourceId: null,
      ip: req.ip,
      success: true,
    });

    sendCsv(res, datedFilename("insurance"), csv);
  } catch (err) {
    console.error("[gov/export/insurance]", err);
    res.status(500).json({ detail: "Could not build the insurance export." });
  }
});

router.post("/insurance/:id/verify", authenticate, requireGovernment, async (req, res) => {
  try {
    const official = await User.findById(req.userId);
    if (!official) return res.status(401).json({ detail: "Sign in again." });

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ detail: "No such insurance record." });
    }

    const policy = await InsurancePolicy.findById(req.params.id);
    if (!policy) return res.status(404).json({ detail: "No such insurance record." });

    // Scope check by re-reading the worker through the jurisdiction filter: a
    // policy in another district must behave as though it does not exist.
    const worker = await User.findOne({
      _id: policy.worker_id,
      ...workerScopeFilter(official),
    });
    if (!worker) return res.status(403).json({ detail: "This worker is outside your jurisdiction." });

    policy.verification = "office_verified";
    policy.verified_by = official._id;
    policy.verified_at = new Date();
    await policy.save();

    await audit({
      actorRole: "government",
      actorIdentifier: req.userId,
      action: "insurance.verify",
      resourceType: "insurance_policy",
      resourceId: String(policy._id),
      ip: req.ip,
      success: true,
    });

    res.json({ policy: insuranceRow(policy, worker, new Date()) });
  } catch (err) {
    console.error("[gov/insurance/verify]", err);
    res.status(500).json({ detail: "Could not verify this policy." });
  }
});

export default router;
