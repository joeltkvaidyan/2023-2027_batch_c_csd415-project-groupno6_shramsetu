import { Router } from "express";
import { InsurancePolicy, COVERAGES } from "../models/InsurancePolicy.js";
import { authenticate, requireWorker } from "../middleware/auth.js";
import { ownPolicyView, pickCurrentPolicy, policyStatus } from "../utils/insurance.js";

/**
 * A worker's own insurance records.
 *
 * The card and the public verify page only ever show cover that is in force
 * today, which means the underlying rows must be accurate. Two deliberate
 * constraints here:
 *   - a worker may only add a policy for themselves (the session decides whose
 *     record it is; no id is accepted from the body);
 *   - a worker cannot delete a policy an official has verified. Removing it
 *     would silently withdraw a claim a household may already have relied on,
 *     so that has to go through the office.
 *
 * Everything a worker enters starts life as `self_declared`. That word is
 * shown, not hidden: an unverified entry is still useful, but it must never be
 * presented to a household as though an official had checked it.
 */
const router = Router();

const MAX_POLICIES_PER_WORKER = 10;
const FIFTY_YEARS_MS = 50 * 365 * 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

router.get("/", authenticate, requireWorker, async (req, res) => {
  try {
    const policies = await InsurancePolicy.find({ worker_id: req.userId })
      .sort({ valid_to: -1 })
      .lean();

    const now = new Date();
    const current = pickCurrentPolicy(policies, now);

    res.set("Cache-Control", "no-store");
    res.json({
      policies: policies.map((p) => ownPolicyView(p, now)),
      current: current ? ownPolicyView(current, now) : null,
    });
  } catch (err) {
    console.error("[insurance/list]", err);
    res.status(500).json({ detail: "Could not load your insurance records." });
  }
});

router.post("/", authenticate, requireWorker, async (req, res) => {
  try {
    const body = req.body ?? {};

    const provider = String(body.provider ?? "").trim();
    const policyNumber = String(body.policy_number ?? "").trim();
    const coverage = String(body.coverage ?? "accident");
    const sumInsured = Number(body.sum_insured);
    const validFrom = parseDate(body.valid_from);
    const validTo = parseDate(body.valid_to);

    if (provider.length < 2) {
      return res.status(400).json({ detail: "Enter the name of the insurance company." });
    }
    if (policyNumber.length < 3) {
      return res.status(400).json({ detail: "Enter the policy number printed on the policy." });
    }
    if (!COVERAGES.includes(coverage)) {
      return res.status(400).json({ detail: "Choose what the policy covers." });
    }
    if (!Number.isFinite(sumInsured) || sumInsured < 1) {
      return res.status(400).json({ detail: "Enter the amount the policy covers, in rupees." });
    }
    if (!validFrom || !validTo) {
      return res.status(400).json({ detail: "Enter the start and end date of the policy." });
    }
    if (validTo <= validFrom) {
      return res.status(400).json({ detail: "The policy must end after it starts." });
    }
    if (new Date(validTo).getTime() - Date.now() > FIFTY_YEARS_MS) {
      return res.status(400).json({ detail: "That end date is too far in the future." });
    }
    if (policyStatus({ valid_from: validFrom, valid_to: validTo }) === "expired") {
      return res
        .status(400)
        .json({ detail: "This policy has already expired, so it will not show on your card." });
    }

    const count = await InsurancePolicy.countDocuments({ worker_id: req.userId });
    if (count >= MAX_POLICIES_PER_WORKER) {
      return res.status(409).json({
        detail:
          "You already have the maximum number of policies on record. A labour office can remove an old one.",
      });
    }

    const duplicate = await InsurancePolicy.findOne({
      worker_id: req.userId,
      policy_number: policyNumber,
    }).lean();
    if (duplicate) {
      return res.status(409).json({ detail: "This policy number is already on your record." });
    }

    const policy = await InsurancePolicy.create({
      worker_id: req.userId,
      provider,
      policy_number: policyNumber,
      coverage,
      sum_insured: Math.round(sumInsured),
      valid_from: validFrom,
      valid_to: validTo,
      verification: "self_declared",
    });

    res.status(201).json({ policy: ownPolicyView(policy) });
  } catch (err) {
    console.error("[insurance/create]", err);
    res.status(500).json({ detail: "Could not save this policy." });
  }
});

router.delete("/:id", authenticate, requireWorker, async (req, res) => {
  try {
    const policy = await InsurancePolicy.findOne({
      _id: req.params.id,
      worker_id: req.userId,
    });
    if (!policy) return res.status(404).json({ detail: "No such policy on your record." });

    if (policy.verification === "office_verified") {
      return res.status(409).json({
        detail:
          "A labour office verified this policy, so it cannot be removed here. Contact the office if it is wrong.",
      });
    }

    await policy.deleteOne();
    res.json({ deleted: true });
  } catch (err) {
    console.error("[insurance/delete]", err);
    res.status(500).json({ detail: "Could not remove this policy." });
  }
});

export default router;
