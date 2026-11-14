/**
 * Insurance status, derived from dates on every read.
 *
 * The temptation is to store `is_insured: true`. Don't: a policy that expired
 * last night would still show a green tick on a card printed this morning, and
 * the household reading it has no way to tell. Everything here is computed from
 * `valid_from` / `valid_to` and the current clock, so a card can only ever
 * promise cover that is genuinely in force at the moment it is checked.
 */

/** @typedef {"self_declared"|"office_verified"} Verification */

/**
 * @param {{valid_from: Date, valid_to: Date}} policy
 * @param {Date} [now]
 * @returns {"expired"|"upcoming"|"active"}
 */
export function policyStatus(policy, now = new Date()) {
  const from = new Date(policy.valid_from).getTime();
  const to = new Date(policy.valid_to).getTime();
  const at = now.getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return "expired";
  if (at > to) return "expired";
  if (at < from) return "upcoming";
  return "active";
}

const VERIFICATION_RANK = { office_verified: 2, self_declared: 1 };

/**
 * The policy a stranger should be shown when they check a card.
 *
 * Picks the in-force policy with the longest remaining cover, preferring an
 * office-verified one over an equally valid self-declared one — an official's
 * check is worth more than the worker's own word, but a verified policy that
 * expired is worth nothing at all.
 */
export function pickCurrentPolicy(policies, now = new Date()) {
  const live = (policies || []).filter((p) => policyStatus(p, now) === "active");
  if (live.length === 0) return null;
  return live.sort((a, b) => {
    const rank = (VERIFICATION_RANK[b.verification] || 0) - (VERIFICATION_RANK[a.verification] || 0);
    if (rank !== 0) return rank;
    return new Date(b.valid_to).getTime() - new Date(a.valid_to).getTime();
  })[0];
}

/** Never publish a full policy number: the last four are enough to match a card. */
export function maskPolicyNumber(policyNumber) {
  const clean = String(policyNumber || "").trim();
  if (clean.length <= 4) return "••••";
  return `••••${clean.slice(-4)}`;
}

/**
 * What the public verify endpoint may say about a worker's cover.
 *
 * `covered` is deliberately about TODAY: true only for a policy in force right
 * now. It says nothing about whether the policy actually pays a particular
 * claim — the wording on the page has to carry that limit, not this function.
 */
export function publicInsuranceView(policies, now = new Date()) {
  const policy = pickCurrentPolicy(policies, now);
  if (!policy) {
    // Distinguish "had cover, it ran out" from "never declared any", because a
    // household should be told to ask rather than assume either way.
    const known = (policies || []).length > 0;
    const latest = known
      ? (policies || []).reduce((a, b) =>
          new Date(b.valid_to).getTime() > new Date(a.valid_to).getTime() ? b : a,
        )
      : null;
    return {
      covered: false,
      status: latest ? policyStatus(latest, now) : "none",
      provider: null,
      coverage: null,
      sum_insured: null,
      valid_to: null,
      verification: null,
      policy_number_masked: null,
      on_record: known,
    };
  }

  return {
    covered: true,
    status: "active",
    provider: policy.provider,
    coverage: policy.coverage ?? "accident",
    sum_insured: policy.sum_insured ?? null,
    valid_to: policy.valid_to ? new Date(policy.valid_to).toISOString() : null,
    verification: policy.verification,
    policy_number_masked: maskPolicyNumber(policy.policy_number),
    on_record: true,
  };
}

/** The worker's own view of one policy: full number, plus derived status. */
export function ownPolicyView(policy, now = new Date()) {
  return {
    id: String(policy._id),
    provider: policy.provider,
    policy_number: policy.policy_number,
    coverage: policy.coverage ?? "accident",
    sum_insured: policy.sum_insured ?? null,
    valid_from: policy.valid_from ? new Date(policy.valid_from).toISOString() : null,
    valid_to: policy.valid_to ? new Date(policy.valid_to).toISOString() : null,
    verification: policy.verification,
    verified_at: policy.verified_at ? new Date(policy.verified_at).toISOString() : null,
    status: policyStatus(policy, now),
  };
}
