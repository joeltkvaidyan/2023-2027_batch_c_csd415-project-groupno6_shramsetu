import { Router } from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Grievance, GRIEVANCE_STATUSES } from "../models/Grievance.js";
import { PushNotification, WorkerNotification } from "../models/Notification.js";
import { AuditLog } from "../models/Document.js";
import { authenticate, requireGovernment, audit } from "../middleware/auth.js";
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

    const [total_workers, active_workers, total_grievances, open_grievances, resolved_grievances, urgent_grievances] =
      await Promise.all([
        User.countDocuments(workerFilter),
        User.countDocuments({ ...workerFilter, is_active: true }),
        Grievance.countDocuments(grievanceFilter),
        Grievance.countDocuments({ ...grievanceFilter, status: { $in: ["submitted", "under_review"] } }),
        Grievance.countDocuments({ ...grievanceFilter, status: "resolved" }),
        Grievance.countDocuments({ ...grievanceFilter, priority: "urgent", status: { $nin: ["resolved", "rejected", "withdrawn"] } }),
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

export default router;
