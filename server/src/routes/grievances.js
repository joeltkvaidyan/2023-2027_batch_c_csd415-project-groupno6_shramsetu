import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { User } from "../models/User.js";
import { Grievance, GRIEVANCE_CATEGORIES } from "../models/Grievance.js";
import { WageSlip } from "../models/WageSlip.js";
import { Engagement } from "../models/Engagement.js";
import { authenticate, requireWorker, audit } from "../middleware/auth.js";
import { config } from "../config.js";
import { validateDocumentFile, ALLOWED_DOC_EXTENSIONS } from "../utils/fileValidation.js";
import { encryptBuffer } from "../utils/crypto.js";
import { isDuplicateKeyError, readIdempotencyKey, replayResponse } from "../utils/idempotency.js";
import { wrapKey, unwrapKey } from "../utils/docKeys.js";

const router = Router();
// Memory storage: nothing ever touches disk on validation failure, and the
// buffer is only persisted after every check passes. Max file size is small
// enough (default 10 MB) that holding it in RAM is safe.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

const PRIORITIES_BY_CATEGORY = {
  harassment_abuse: "urgent",
  workplace_safety: "urgent",
  unpaid_wages: "high",
  illegal_termination: "high",
  employer_dispute: "medium",
  document_issue: "medium",
  insurance_claim: "medium",
  accommodation: "medium",
  other: "medium",
};

// Auto SLA by priority (days) — mirrors the legacy service.
const SLA_DAYS = { urgent: 7, high: 14, medium: 30, low: 45 };

const nextComplaintNumber = () => `GR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

function detailJSON(g, worker = null) {
  return {
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
    worker_rating: g.worker_rating,
    worker_feedback: g.worker_feedback,
    feedback_at: g.feedback_at,
    attachments: (g.attachments || []).map((a) => ({
      id: a.id,
      // "file" for an uploaded document, otherwise the record it points at.
      kind: a.kind ?? "file",
      ref_id: a.ref_id ?? null,
      label: a.label ?? a.original_filename ?? null,
      original_filename: a.original_filename ?? null,
      content_type: a.content_type ?? null,
      size_bytes: a.size_bytes ?? null,
      created_at: a.created_at,
    })),
    // Evidence split by kind, so a reader (or a labour office) can see at a
    // glance how much of this complaint is corroborated rather than asserted.
    evidence: {
      platform_records: (g.attachments || [])
        .filter((a) => (a.kind ?? "file") !== "file")
        .map((a) => ({ kind: a.kind, ref_id: a.ref_id ?? null, label: a.label ?? null })),
      uploaded_files: (g.attachments || []).filter((a) => (a.kind ?? "file") === "file").length,
    },
    timeline: (g.timeline || []).map((t) => ({
      status: t.status, note: t.note ?? null, changed_by: t.changed_by, created_at: t.created_at,
    })),
    comments: (g.comments || []).filter((c) => !c.is_internal).map((c) => ({
      id: c.id, author_name: c.author_name, author_role: c.author_role, content: c.content, created_at: c.created_at,
    })),
    ...(worker
      ? { worker: { worker_id: worker.worker_id, full_name: worker.full_name, occupation: worker.occupation, current_state: worker.current_state, current_district: worker.current_district } }
      : {}),
  };
}

const fail = (res, err, msg) => {
  console.error("[grievances]", err);
  res.status(500).json({ detail: msg });
};

const EVIDENCE_KINDS = ["wage_slip", "engagement"];
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Turn `evidence: [{kind, ref_id}]` into rows in the EXISTING attachments array.
 *
 * Every reference is re-checked against the filer: a worker can cite their own
 * wage slip or their own engagement, and nothing else. A bad or foreign
 * reference is dropped rather than failing the whole filing — losing the
 * complaint because one evidence id was stale would be worse than losing the
 * citation.
 */
async function resolveEvidence(workerId, rawEvidence) {
  const list = Array.isArray(rawEvidence) ? rawEvidence.slice(0, 20) : [];
  const out = [];
  const seen = new Set();

  for (const item of list) {
    const kind = String(item?.kind || "");
    const refId = String(item?.ref_id || "");
    if (!EVIDENCE_KINDS.includes(kind) || !mongoose.isValidObjectId(refId)) continue;

    const key = `${kind}:${refId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let label = null;
    if (kind === "wage_slip") {
      const slip = await WageSlip.findOne({ _id: refId, worker_id: workerId }).select(
        "slip_number issue_date"
      );
      if (!slip) continue;
      label = `Wage slip ${slip.slip_number} (${isoDay(slip.issue_date)})`;
    } else {
      const engagement = await Engagement.findOne({ _id: refId, worker_id: workerId }).select(
        "work_date employer_name"
      );
      if (!engagement) continue;
      label = `Employer-confirmed day ${isoDay(engagement.work_date)}${
        engagement.employer_name ? ` — ${engagement.employer_name}` : ""
      }`;
    }

    out.push({
      id: crypto.randomBytes(6).toString("hex"),
      kind,
      ref_id: refId,
      label,
      created_at: new Date(),
    });
  }

  return out;
}

// ── Create ───────────────────────────────────────────────────────────
router.post("/", authenticate, requireWorker, async (req, res) => {
  try {
    const { category, subject, description, employer_name, incident_location, incident_date } = req.body || {};
    if (!GRIEVANCE_CATEGORIES.includes(category)) {
      return res.status(422).json({ detail: [{ loc: ["body", "category"], msg: "Invalid category" }] });
    }
    if (!subject || !String(subject).trim()) {
      return res.status(422).json({ detail: [{ loc: ["body", "subject"], msg: "Subject is required" }] });
    }
    if (!description || !String(description).trim()) {
      return res.status(422).json({ detail: [{ loc: ["body", "description"], msg: "Description is required" }] });
    }

    // A retried submission (lost reply, flaky connection) carries the same key
    // as the first attempt: answer with the grievance that already exists
    // instead of filing a second complaint for one incident.
    const requestKey = readIdempotencyKey(req);
    if (requestKey) {
      const previous = await Grievance.findOne({ owner_id: req.userId, client_request_id: requestKey });
      if (previous) return replayResponse(res, detailJSON(previous));
    }

    const priority = PRIORITIES_BY_CATEGORY[category] || "medium";
    const slaDays = SLA_DAYS[priority] ?? 30;

    // Snapshot the worker's jurisdiction at filing time so officials can
    // scope grievances without a join and the filing district survives a
    // later worker move (see utils/scope.js).
    const filer = await User.findById(req.userId).select("current_state current_district");
    const evidence = await resolveEvidence(req.userId, req.body?.evidence);

    const g = await Grievance.create({
      owner_id: req.userId,
      owner_state: filer?.current_state || null,
      owner_district: filer?.current_district || null,
      complaint_number: nextComplaintNumber(),
      client_request_id: requestKey ?? undefined,
      category,
      subject: String(subject).trim(),
      description: String(description).trim(),
      status: "submitted",
      priority,
      employer_name: employer_name || null,
      incident_location: incident_location || null,
      incident_date: incident_date ? new Date(incident_date) : null,
      sla_deadline: new Date(Date.now() + slaDays * 86400000),
      attachments: evidence,
      timeline: [{ status: "submitted", note: null, changed_by: "Worker", created_at: new Date() }],
      comments: [],
    });
    await audit({ actorRole: "worker", actorIdentifier: req.userId, action: "grievance.create", resourceType: "grievance", resourceId: String(g._id), ip: req.ip, success: true });
    res.status(201).json(detailJSON(g));
  } catch (err) {
    // Two requests with one key can pass the check above together; the unique
    // index is what actually decides. The loser replays the winner's record.
    if (isDuplicateKeyError(err)) {
      const key = readIdempotencyKey(req);
      const previous = key && (await Grievance.findOne({ owner_id: req.userId, client_request_id: key }));
      if (previous) return replayResponse(res, detailJSON(previous));
    }
    fail(res, err, "Could not file grievance. Please try again.");
  }
});

// ── List mine ────────────────────────────────────────────────────────
router.get("/", authenticate, requireWorker, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const filter = { owner_id: req.userId };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.category) filter.category = String(req.query.category);
    const rows = await Grievance.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json(rows.map((g) => detailJSON(g)));
  } catch (err) {
    fail(res, err, "Could not load grievances. Please try again.");
  }
});

// ── Detail ───────────────────────────────────────────────────────────
router.get("/:id", authenticate, requireWorker, async (req, res) => {
  try {
    const g = await Grievance.findOne({ _id: req.params.id, owner_id: req.userId });
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    const worker = await User.findById(req.userId);
    res.json(detailJSON(g, worker));
  } catch (err) {
    fail(res, err, "Could not load grievance.");
  }
});

// ── Attachments ──────────────────────────────────────────────────────
router.post("/:id/attachments", authenticate, requireWorker, upload.single("file"), async (req, res) => {
  try {
    const g = await Grievance.findOne({ _id: req.params.id, owner_id: req.userId });
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    if (!req.file) return res.status(422).json({ detail: "file is required" });

    // Content-based validation (magic bytes), not the client MIME type.
    const verdict = validateDocumentFile(req.file.buffer, req.file.originalname, req.file.size, config.maxUploadMb * 1024 * 1024);
    if (!verdict.ok) return res.status(422).json({ detail: verdict.reason });

    const attId = crypto.randomBytes(6).toString("hex");
    const { key, payload } = encryptBuffer(req.file.buffer);
    const wrapped = wrapKey(Buffer.from(key, "base64"));
    const dest = path.join(config.uploadDir, `grievance-${g._id}-${attId}`);
    await fs.promises.mkdir(config.uploadDir, { recursive: true });
    await fs.promises.writeFile(dest, payload);
    try {
      g.attachments.push({
        id: attId,
        original_filename: req.file.originalname,
        content_type: req.file.mimetype,
        size_bytes: req.file.size,
        created_at: new Date(),
        encryption_key: wrapped,
      });
      await g.save();
    } catch (err) {
      // Never orphan the file if the DB write fails.
      await fs.promises.unlink(dest).catch(() => {});
      throw err;
    }
    res.status(201).json({ detail: "Attachment added" });
  } catch (err) {
    fail(res, err, "Could not attach file.");
  }
});

router.delete("/:id/attachments/:attachmentId", authenticate, requireWorker, async (req, res) => {
  try {
    const g = await Grievance.findOne({ _id: req.params.id, owner_id: req.userId });
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    const att = (g.attachments || []).find((a) => a.id === req.params.attachmentId);
    if (att) {
      await fs.promises.unlink(path.join(config.uploadDir, `grievance-${g._id}-${att.id}`)).catch(() => {});
      g.attachments = g.attachments.filter((a) => a.id !== att.id);
      await g.save();
    }
    res.json({ detail: "Attachment removed" });
  } catch (err) {
    fail(res, err, "Could not remove attachment.");
  }
});

// ── Withdraw (state machine: only submitted/under_review) ────────────
router.post("/:id/withdraw", authenticate, requireWorker, async (req, res) => {
  try {
    const g = await Grievance.findOne({ _id: req.params.id, owner_id: req.userId });
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    if (!["submitted", "under_review"].includes(g.status)) {
      return res.status(400).json({ detail: `Cannot withdraw a grievance that is ${g.status}.` });
    }
    g.status = "withdrawn";
    g.timeline.push({ status: "withdrawn", note: null, changed_by: "Worker", created_at: new Date() });
    g.resolved_at = new Date();
    await g.save();
    await audit({ actorRole: "worker", actorIdentifier: req.userId, action: "grievance.withdraw", resourceType: "grievance", resourceId: String(g._id), ip: req.ip, success: true });
    res.json({ detail: "Grievance withdrawn", old_status: g.timeline[g.timeline.length - 2]?.status ?? "under_review", new_status: "withdrawn" });
  } catch (err) {
    fail(res, err, "Could not withdraw grievance.");
  }
});

// ── Comments (worker → officer thread) ───────────────────────────────
router.post("/:id/comments", authenticate, requireWorker, async (req, res) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) {
      return res.status(422).json({ detail: [{ loc: ["body", "content"], msg: "Comment cannot be empty" }] });
    }
    const g = await Grievance.findOne({ _id: req.params.id, owner_id: req.userId });
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    const worker = await User.findById(req.userId);
    g.comments.push({
      id: crypto.randomBytes(6).toString("hex"),
      author_name: worker.full_name,
      author_role: worker.role,
      content,
      is_internal: false,
      created_at: new Date(),
    });
    await g.save();
    res.status(201).json({ detail: "Comment added" });
  } catch (err) {
    fail(res, err, "Could not add comment.");
  }
});

// ── Feedback (only once, only when resolved) ─────────────────────────
router.post("/:id/feedback", authenticate, requireWorker, async (req, res) => {
  try {
    const g = await Grievance.findOne({ _id: req.params.id, owner_id: req.userId });
    if (!g) return res.status(404).json({ detail: "Grievance not found." });
    if (g.status !== "resolved") {
      return res.status(400).json({ detail: "Feedback can only be given on resolved grievances." });
    }
    if (g.worker_rating) {
      return res.status(400).json({ detail: "Feedback already submitted for this grievance." });
    }
    const rating = parseInt(req.body?.rating, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(422).json({ detail: [{ loc: ["body", "rating"], msg: "Rating must be 1–5" }] });
    }
    g.worker_rating = rating;
    g.worker_feedback = req.body?.feedback ? String(req.body.feedback).trim() : null;
    g.feedback_at = new Date();
    await g.save();
    res.json({ detail: "Feedback recorded" });
  } catch (err) {
    fail(res, err, "Could not record feedback.");
  }
});

export default router;
