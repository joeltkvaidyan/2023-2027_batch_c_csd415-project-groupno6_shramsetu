/**
 * Explainable job matching.
 *
 * Deliberately a transparent additive score, not a learned ranker: every point
 * a worker sees in the UI maps to a reason they can read ("same district",
 * "matches your trade"). Pure function so it is unit-testable and the ranking
 * can be re-derived in a test instead of trusted.
 *
 * The score never claims suitability or a guaranteed wage — only the overlap
 * between the worker's profile and the listing's stated fields.
 */

const WEIGHTS = {
  occupation: 45,
  anyTrade: 15,
  sameDistrict: 25,
  sameState: 15,
  postedWithin7Days: 15,
  postedWithin30Days: 8,
  multipleOpenings: 5,
  wageListed: 5,
};

/** Jobs below this score are not shown as matches at all. */
export const MIN_MATCH_SCORE = 25;

const DAY_MS = 86_400_000;

function sameText(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * @param {object} job       JobPosting document (or JSON) with occupation,
 *                           district, state, createdAt, openings, wage_max
 * @param {object} worker    { occupation, current_district, current_state }
 * @param {Date}   now       injectable clock for deterministic tests
 * @returns {{ score: number, level: "strong"|"good"|"possible", reasons: string[] }}
 */
export function scoreJob(job, worker, now = new Date()) {
  let score = 0;
  const reasons = [];

  if (job.occupation === "any") {
    score += WEIGHTS.anyTrade;
    reasons.push("open_to_any_trade");
  } else if (sameText(job.occupation, worker.occupation)) {
    score += WEIGHTS.occupation;
    reasons.push("occupation_match");
  }

  if (job.district && sameText(job.district, worker.current_district)) {
    score += WEIGHTS.sameDistrict;
    reasons.push("same_district");
  } else if (sameText(job.state, worker.current_state)) {
    score += WEIGHTS.sameState;
    reasons.push("same_state");
  }

  const postedAt = job.createdAt ? new Date(job.createdAt) : null;
  if (postedAt && !Number.isNaN(postedAt.getTime())) {
    const ageDays = Math.max(0, (now.getTime() - postedAt.getTime()) / DAY_MS);
    if (ageDays <= 7) {
      score += WEIGHTS.postedWithin7Days;
      reasons.push("recent_posting");
    } else if (ageDays <= 30) {
      score += WEIGHTS.postedWithin30Days;
      reasons.push("recent_posting");
    }
  }

  if (Number(job.openings) >= 3) {
    score += WEIGHTS.multipleOpenings;
    reasons.push("multiple_openings");
  }

  if (job.wage_max !== null && job.wage_max !== undefined) {
    score += WEIGHTS.wageListed;
    reasons.push("wage_listed");
  }

  const level = score >= 70 ? "strong" : score >= 45 ? "good" : "possible";
  return { score, level, reasons };
}

/** Attach match metadata to a serialised job for a specific worker. */
export function withMatch(jobJSON, worker, now = new Date()) {
  const { score, level, reasons } = scoreJob(jobJSON, worker, now);
  return { ...jobJSON, match: { score, level, reasons } };
}
