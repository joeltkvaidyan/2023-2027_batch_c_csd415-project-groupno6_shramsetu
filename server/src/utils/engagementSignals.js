import mongoose from "mongoose";
import { Engagement } from "../models/Engagement.js";

/**
 * Objective signals about a worker, derived from confirmed engagements.
 *
 * Computed at read time and never stored. That is deliberate: a stored counter
 * is a copy that drifts (a cancelled engagement, a corrected payment), and a
 * drifting number beside a worker's name is worse than no number. The only
 * durable facts are the engagements themselves.
 *
 * `paid_on_time` needs a definition, because the platform holds no contractual
 * payment deadline — only the shift date and the moment payment was recorded.
 * The rule used here, and stated in the response so a reader can disagree with
 * it: a payment is on time when it was recorded on or before the end of the
 * shift day (work_date + 24h, UTC).
 */
export const PAID_ON_TIME_RULE =
  "Payment recorded on or before the end of the shift day (work_date + 24h, UTC).";

const SHIFT_DAY_MS = 86_400_000;

function shapeRow(row) {
  const shifts = row?.shifts_confirmed ?? 0;
  const onTime = row?.paid_on_time ?? 0;
  return {
    shifts_confirmed: shifts,
    paid_on_time: onTime,
    on_time_rate: shifts > 0 ? Math.round((onTime / shifts) * 100) / 100 : null,
    paid_total: Math.round((row?.paid_total ?? 0) * 100) / 100,
    disputes: row?.disputes ?? 0,
    rule: PAID_ON_TIME_RULE,
  };
}

const EMPTY_SIGNALS = shapeRow(null);

/** Signals for one worker. */
export async function engagementSignals(workerId) {
  const map = await engagementSignalsFor([workerId]);
  return map.get(String(workerId)) ?? { ...EMPTY_SIGNALS };
}

/** Signals for many workers in one aggregation (directory pages). */
export async function engagementSignalsFor(workerIds = []) {
  const ids = workerIds.filter(Boolean).map((id) => new mongoose.Types.ObjectId(id));
  const out = new Map();
  if (ids.length === 0) return out;

  const rows = await Engagement.aggregate([
    // Only days the employer confirmed as worked: an offer, a no-show or a
    // cancellation is not a shift and must not inflate the count.
    { $match: { worker_id: { $in: ids }, worked_at: { $ne: null } } },
    {
      $group: {
        _id: "$worker_id",
        shifts_confirmed: { $sum: 1 },
        paid_on_time: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$payment.paid_at", null] },
                  { $lte: ["$payment.paid_at", { $add: ["$work_date", SHIFT_DAY_MS] }] },
                ],
              },
              1,
              0,
            ],
          },
        },
        paid_total: { $sum: { $ifNull: ["$payment.amount", 0] } },
        disputes: { $sum: { $cond: [{ $eq: ["$status", "disputed"] }, 1, 0] } },
      },
    },
  ]);

  for (const row of rows) out.set(String(row._id), shapeRow(row));
  return out;
}

export { EMPTY_SIGNALS };
