import { User } from "../models/User.js";
import { WorkerRating } from "../models/WorkerRating.js";
import { OCCUPATIONS } from "./occupations.js";
import { engagementSignalsFor } from "./engagementSignals.js";

/**
 * Shared "find a worker" listing used by two surfaces:
 *  - /public/workers   → open, privacy-safe (no phone number)
 *  - /directory/workers → signed-in employer/household, includes the worker's
 *    mobile number so the account holder can call directly.
 *
 * Keeping ONE visibility rule here means a worker can never be contactable
 * while hidden from the public list, or vice versa. The rule is decided by
 * two facts only: the worker is active and a labour office accepted them.
 * Ratings are never part of this filter — an employer's opinion must never
 * be able to remove a worker from the directory.
 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseDirectoryPaging(query) {
  const page = Math.max(1, Number.parseInt(String(query?.page ?? "1"), 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(query?.page_size ?? "20"), 10) || 20));
  return { page, pageSize };
}

export function buildDirectoryFilter({ name = "", place = "", occupation = "" } = {}) {
  const filter = {
    role: "worker",
    is_active: true,
    is_phone_verified: true,
    gov_approve_status: "accepted",
  };
  if (name) filter.full_name = new RegExp(escapeRegex(name), "i");
  if (occupation && OCCUPATIONS.includes(occupation)) filter.occupation = occupation;
  if (place) {
    const rx = new RegExp(escapeRegex(place), "i");
    filter.$or = [{ current_district: rx }, { current_state: rx }, { current_village_or_city: rx }];
  }
  return filter;
}

/**
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.place
 * @param {string} opts.occupation
 * @param {number} opts.page
 * @param {number} opts.pageSize
 * @param {boolean} opts.includePhone  true only after the caller has
 *   authenticated an employer/household account.
 */
export async function listDirectoryWorkers({
  name = "",
  place = "",
  occupation = "",
  page = 1,
  pageSize = 20,
  includePhone = false,
} = {}) {
  const filter = buildDirectoryFilter({ name, place, occupation });

  const selectBase =
    "_id full_name occupation years_of_experience current_state current_district current_village_or_city worker_id";

  const [total, workers] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select(includePhone ? `${selectBase} mobile_number` : selectBase),
  ]);

  const ratingRows = await WorkerRating.aggregate([
    { $match: { worker_id: { $in: workers.map((w) => w._id) } } },
    { $group: { _id: "$worker_id", average: { $avg: "$stars" }, count: { $sum: 1 } } },
  ]);
  const ratingMap = new Map(
    ratingRows.map((r) => [String(r._id), { average: Math.round(r.average * 10) / 10, count: r.count }])
  );

  // Objective signals, computed at read time from confirmed engagements. A
  // new worker with no ratings can still show corroborated shifts.
  const signalsMap = await engagementSignalsFor(workers.map((w) => w._id));

  return {
    total,
    page,
    page_size: pageSize,
    workers: workers.map((w) => ({
      id: String(w._id),
      worker_code: w.worker_id,
      full_name: w.full_name,
      occupation: w.occupation,
      years_of_experience: w.years_of_experience,
      place: [w.current_village_or_city, w.current_district, w.current_state].filter(Boolean).join(", ") || null,
      current_district: w.current_district,
      current_state: w.current_state,
      rating: ratingMap.get(String(w._id)) ?? { average: null, count: 0 },
      signals: signalsMap.get(String(w._id)) ?? null,
      gov_accepted: true,
      ...(includePhone ? { phone: w.mobile_number } : {}),
    })),
  };
}
