/**
 * SLA escalation.
 *
 * The platform gives every grievance a deadline derived from its priority
 * (urgent 7 · high 14 · medium 30 · low 45 days) and then, until now, never
 * mentioned it again. A promise nobody enforces is worse than no promise: the
 * worker believes the clock is running for them, and the labour office never
 * learns that it did not.
 *
 * So the ladder has two rungs:
 *   1. the deadline passes and the complaint is still open → the district
 *      labour office is told (escalation_level 1),
 *   2. it is *still* open after a grace window → the state office is told
 *      (escalation_level 2).
 *
 * The claim is the same trick the insurance reminder sweep uses: the update is
 * filtered on the level it expects to find, so whoever wins the write owns the
 * escalation, and a restart or a second API instance cannot escalate twice.
 * That also means the timeline a worker reads gains exactly one entry per rung.
 *
 * Only open grievances climb. A complaint resolved on day 40 of a 14-day SLA is
 * late, but escalating it after the fact tells nobody anything useful — the
 * overdue view still shows it as closed, not as a live breach.
 */
import { Grievance } from "../models/Grievance.js";
import { audit } from "../middleware/auth.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that still owe the worker an answer. */
export const OPEN_GRIEVANCE_STATUSES = ["submitted", "under_review"];

/** Days the state office gets told after the district office. */
export const STATE_ESCALATION_DAYS = 7;

/**
 * Whole days a deadline has been missed, or null when there is no deadline.
 * 0 means "due today" — never negative, because the overdue view is about what
 * is late, not how early something is.
 */
export function daysOverdue(deadline, now = new Date()) {
  if (!deadline) return null;
  const at = new Date(deadline).getTime();
  if (Number.isNaN(at)) return null;
  const diff = new Date(now).getTime() - at;
  return diff > 0 ? Math.floor(diff / DAY_MS) : 0;
}

function longDate(date) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Who is being told, named from the jurisdiction the complaint was filed in. */
function officeName(grievance, level) {
  const district = grievance.owner_district;
  const state = grievance.owner_state;
  if (level === 1) {
    return district ? `${district} district labour office` : "the district labour office";
  }
  return state ? `${state} state labour office` : "the state labour office";
}

function timelineNote(grievance, level, now) {
  const overdue = daysOverdue(grievance.sla_deadline, now);
  if (level === 1) {
    return (
      `SLA deadline (${longDate(grievance.sla_deadline)}) passed with this complaint still open. ` +
      `Escalated to ${officeName(grievance, 1)}.`
    );
  }
  return (
    `Still unresolved ${overdue} day${overdue === 1 ? "" : "s"} after the deadline. ` +
    `Escalated to ${officeName(grievance, 2)}.`
  );
}

/**
 * Take the next rung of the ladder for one grievance, or return null when
 * somebody else already did (or when the row no longer qualifies).
 */
async function claim(grievance, level, now, filter) {
  const updated = await Grievance.findOneAndUpdate(
    { _id: grievance._id, status: { $in: OPEN_GRIEVANCE_STATUSES }, ...filter },
    {
      $set: {
        escalation_level: level,
        escalated: true,
        ...(level === 1 ? { escalated_at: now } : { state_escalated_at: now }),
      },
      $push: {
        timeline: {
          status: grievance.status,
          note: timelineNote(grievance, level, now),
          changed_by: "ShramSetu",
          created_at: now,
        },
      },
    },
    { new: true },
  ).lean();
  return updated;
}

/**
 * Walk every open, past-deadline grievance one rung up the ladder.
 *
 * @param {{now?: Date, stateAfterDays?: number}} [options]
 * @returns {Promise<{districtEscalated: number, stateEscalated: number}>}
 */
export async function escalateOverdueGrievances({
  now = new Date(),
  stateAfterDays = STATE_ESCALATION_DAYS,
} = {}) {
  const open = { status: { $in: OPEN_GRIEVANCE_STATUSES } };
  let districtEscalated = 0;
  let stateEscalated = 0;

  // ── Rung 1: the deadline has passed and nobody has been told yet ──────
  const overdue = await Grievance.find({
    ...open,
    sla_deadline: { $ne: null, $lt: now },
    $or: [{ escalation_level: { $lt: 1 } }, { escalation_level: { $exists: false } }],
  }).lean();

  for (const grievance of overdue) {
    const escalated = await claim(grievance, 1, now, {
      $or: [{ escalation_level: { $lt: 1 } }, { escalation_level: { $exists: false } }],
    });
    if (!escalated) continue;
    districtEscalated += 1;
    await audit({
      actorRole: "system",
      actorIdentifier: "sla-sweep",
      action: "grievance.escalate",
      resourceType: "grievance",
      resourceId: String(grievance._id),
      success: true,
    });
  }

  // ── Rung 2: still open after the grace window ─────────────────────────
  const graceCutoff = new Date(now.getTime() - stateAfterDays * DAY_MS);
  const stalled = await Grievance.find({
    ...open,
    sla_deadline: { $ne: null, $lt: now },
    escalation_level: 1,
    escalated_at: { $ne: null, $lte: graceCutoff },
  }).lean();

  for (const grievance of stalled) {
    const escalated = await claim(grievance, 2, now, {
      escalation_level: 1,
      escalated_at: { $ne: null, $lte: graceCutoff },
    });
    if (!escalated) continue;
    stateEscalated += 1;
    await audit({
      actorRole: "system",
      actorIdentifier: "sla-sweep",
      action: "grievance.escalate_state",
      resourceType: "grievance",
      resourceId: String(grievance._id),
      success: true,
    });
  }

  return { districtEscalated, stateEscalated };
}
