/**
 * Insurance expiry reminders.
 *
 * A card is only honest if the worker knows the date is coming. Without a nudge
 * the failure is silent: the policy lapses, the worker's card quietly stops
 * showing cover, and the first person to notice is a household at the door —
 * or nobody, until a claim.
 *
 * So the sweep looks for policies whose cover ends within the reminder window
 * and writes one in-app notification per policy. The window reaches slightly
 * backwards as well as forwards: if the API was down on the day cover ended,
 * "your cover has ended" is still worth saying, but a policy that lapsed months
 * ago is not worth chasing.
 *
 * Two things keep this from becoming spam:
 *   1. `reminder_sent_at` on the policy. The claim is an atomic update filtered
 *      on `reminder_sent_at: null`, so two sweeps running at once cannot both
 *      message the worker — the second finds nothing to claim.
 *   2. One warning per policy, ever. A renewal is a new row with its own
 *      window, so the reminder follows the policy, not the worker.
 */
import { InsurancePolicy } from "../models/InsurancePolicy.js";
import { PushNotification, WorkerNotification } from "../models/Notification.js";
import { User } from "../models/User.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead of the end date a worker is warned. */
export const REMINDER_WINDOW_DAYS = 30;

/** How far back a just-lapsed policy is still worth mentioning. */
export const LAPSE_GRACE_DAYS = 30;

/** Whole days from `now` to `date`, rounded up so "tomorrow" never reads "0". */
export function daysUntil(date, now = new Date()) {
  const diff = new Date(date).getTime() - new Date(now).getTime();
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / DAY_MS);
}

function rupee(amount) {
  if (amount == null) return "";
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount)}`;
}

function longDate(date) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The message a worker receives. English, like every stored notification. */
export function reminderMessage(policy, now = new Date()) {
  const days = daysUntil(policy.valid_to, now);
  const cover = `${policy.provider}${policy.sum_insured ? ` cover of ${rupee(policy.sum_insured)}` : ""}`;

  if (days === null) return null;
  if (days < 0) {
    return {
      title: "Your insurance cover has ended",
      body:
        `${cover} ended on ${longDate(policy.valid_to)}. ` +
        "Your ID card no longer shows you as covered. Add the renewed policy to your card.",
      priority: "high",
    };
  }
  if (days === 0) {
    return {
      title: "Your insurance cover ends today",
      body:
        `${cover} ends today (${longDate(policy.valid_to)}). ` +
        "Add the renewed policy to your card so it keeps showing cover.",
      priority: "high",
    };
  }
  return {
    title: "Your insurance cover ends soon",
    body:
      `${cover} ends on ${longDate(policy.valid_to)} — ${days} day${days === 1 ? "" : "s"} left. ` +
      "Add the renewed policy to your card so it keeps showing cover.",
    priority: days <= 7 ? "high" : "medium",
  };
}

/**
 * Warn every worker whose cover ends inside the window and who has not been
 * warned about that policy yet.
 *
 * @param {{now?: Date, windowDays?: number, graceDays?: number}} [options]
 * @returns {Promise<{ checked: number, sent: number }>}
 */
export async function sendExpiryReminders({
  now = new Date(),
  windowDays = REMINDER_WINDOW_DAYS,
  graceDays = LAPSE_GRACE_DAYS,
} = {}) {
  const horizon = new Date(now.getTime() + windowDays * DAY_MS);
  const floor = new Date(now.getTime() - graceDays * DAY_MS);

  const due = await InsurancePolicy.find({
    reminder_sent_at: null,
    valid_to: { $gt: floor, $lte: horizon },
  }).lean();

  let sent = 0;

  for (const policy of due) {
    const message = reminderMessage(policy, now);
    if (!message) continue;

    // Claim first, send second: whoever wins the update owns the message.
    const claimed = await InsurancePolicy.updateOne(
      { _id: policy._id, reminder_sent_at: null },
      { $set: { reminder_sent_at: now } },
    );
    if (!claimed.modifiedCount) continue;

    const worker = await User.findById(policy.worker_id).select("_id is_active").lean();
    if (!worker || worker.is_active === false) continue;

    const notification = await PushNotification.create({
      ...message,
      target: "worker",
      target_value: null,
      is_broadcast: false,
      sender_id: null,
      sender_name: "ShramSetu",
      department: "insurance",
      sent_count: 1,
    });
    await WorkerNotification.create({
      notification_id: notification._id,
      worker_id: worker._id,
    });
    sent += 1;
  }

  return { checked: due.length, sent };
}
