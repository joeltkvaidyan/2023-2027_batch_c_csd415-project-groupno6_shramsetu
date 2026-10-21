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
  // Poster account was ACCEPTED by a labour office (employer self-service
  // postings only). Small deliberate weight: it raises trust slightly but it
  // is NOT a listing-level verification, and the reason string says so.
  employerAccepted: 8,
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

  // Accept both the Mongoose document (`createdAt`) and the serialised API
  // shape (`created_at`); reading only one silently dropped the recency score.
  const postedRaw = job.createdAt ?? job.created_at ?? null;
  const postedAt = postedRaw ? new Date(postedRaw) : null;
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

  if (job.employer_accepted === true) {
    score += WEIGHTS.employerAccepted;
    reasons.push("employer_accepted");
  }

  const level = score >= 70 ? "strong" : score >= 45 ? "good" : "possible";
  return { score, level, reasons };
}

/** Attach match metadata to a serialised job for a specific worker. */
export function withMatch(jobJSON, worker, now = new Date()) {
  const { score, level, reasons } = scoreJob(jobJSON, worker, now);
  return { ...jobJSON, match: { score, level, reasons } };
}

/**
 * Citizen service requests (the household "I need a worker near me" flow)
 * scored for a worker from the SAME explainable philsophy: transparent
 * additive points, reasons a worker can read, hard cap at the fields the
 * citizen actually entered.
 */
const REQUEST_WEIGHTS = {
  occupation: 40,
  anyTrade: 15,
  sameDistrict: 35,
  sameArea: 10,
  postedWithin7Days: 12,
  postedWithin30Days: 5,
};

export function scoreServiceRequest(request, worker, now = new Date()) {
  let score = 0;
  const reasons = [];

  if (request.occupation === "any") {
    score += REQUEST_WEIGHTS.anyTrade;
    reasons.push("open_to_any_trade");
  } else if (sameText(request.occupation, worker.occupation)) {
    score += REQUEST_WEIGHTS.occupation;
    reasons.push("occupation_match");
  }

  if (sameText(request.district, worker.current_district)) {
    score += REQUEST_WEIGHTS.sameDistrict;
    reasons.push("same_district");
  } else if (sameText(request.state, worker.current_state)) {
    score += 8;
    reasons.push("same_state");
  }

  // Village/area overlap (same text or one containing the other) — a small
  // signal on top of district, never a hard filter.
  const area = String(request.area_village || "").trim().toLowerCase();
  const workerArea = String(worker.current_village_or_city || "").trim().toLowerCase();
  if (area && workerArea && (sameText(area, workerArea) || workerArea.includes(area) || area.includes(workerArea))) {
    score += REQUEST_WEIGHTS.sameArea;
    reasons.push("same_area");
  }

  const postedRaw = request.createdAt ?? request.created_at ?? null;
  const postedAt = postedRaw ? new Date(postedRaw) : null;
  if (postedAt && !Number.isNaN(postedAt.getTime())) {
    const ageDays = Math.max(0, (now.getTime() - postedAt.getTime()) / DAY_MS);
    if (ageDays <= 7) {
      score += REQUEST_WEIGHTS.postedWithin7Days;
      reasons.push("recent_posting");
    } else if (ageDays <= 30) {
      score += REQUEST_WEIGHTS.postedWithin30Days;
      reasons.push("recent_posting");
    }
  }

  const level = score >= 65 ? "strong" : score >= 45 ? "good" : "possible";
  return { score, level, reasons };
}

/**
 * The same idea in reverse: how well does an applicant's stored profile line up
 * with one listing? Used when an office reviews applications.
 *
 * Only fields the worker themselves entered are compared (`occupation`,
 * `current_district`, `current_state`) — nothing inferred, no name, caste,
 * gender, age or document data. A missing field simply scores nothing and is
 * reported as `detail_not_recorded` so the office knows the score is thin
 * rather than reading a low number as a judgement about the worker.
 */
const APPLICANT_WEIGHTS = {
  occupation: 50,
  anyTrade: 20,
  sameDistrict: 30,
  sameState: 15,
};

/**
 * @param {object} job    JobPosting document/JSON (occupation, district, state)
 * @param {object} worker { occupation, current_district, current_state }
 * @returns {{ score: number, level: "strong"|"good"|"possible", reasons: string[] }}
 */
export function scoreApplicant(job, worker = {}) {
  let score = 0;
  const reasons = [];
  const recorded = [worker.occupation, worker.current_district, worker.current_state].filter(Boolean);

  if (job?.occupation === "any") {
    score += APPLICANT_WEIGHTS.anyTrade;
    reasons.push("open_to_any_trade");
  } else if (sameText(job?.occupation, worker.occupation)) {
    score += APPLICANT_WEIGHTS.occupation;
    reasons.push("occupation_match");
  } else if (worker.occupation) {
    reasons.push("different_trade");
  }

  if (job?.district && sameText(job.district, worker.current_district)) {
    score += APPLICANT_WEIGHTS.sameDistrict;
    reasons.push("same_district");
  } else if (sameText(job?.state, worker.current_state)) {
    score += APPLICANT_WEIGHTS.sameState;
    reasons.push("same_state");
  }

  // Say so explicitly when the profile has too little to compare, so a low
  // score is not mistaken for a verdict about the worker.
  if (recorded.length < 3) reasons.push("detail_not_recorded");

  const level = score >= 70 ? "strong" : score >= 40 ? "good" : "possible";
  return { score, level, reasons };
}

/** Attach review metadata to a serialised application for the posting office. */
export function withApplicantMatch(applicationJSON, job) {
  const snapshot = applicationJSON.worker ?? {};
  const review = scoreApplicant(job, {
    occupation: snapshot.occupation ?? null,
    current_district: snapshot.district ?? null,
    current_state: snapshot.state ?? null,
  });
  return { ...applicationJSON, review };
}
