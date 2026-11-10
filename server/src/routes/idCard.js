import { Router } from "express";
import { User } from "../models/User.js";
import { InsurancePolicy } from "../models/InsurancePolicy.js";
import { pickCurrentPolicy, policyStatus } from "../utils/insurance.js";
import { authenticate, requireWorker } from "../middleware/auth.js";
import { config } from "../config.js";
import { cardCode } from "../utils/cardToken.js";

/**
 * Worker identity card — the printable, verifiable credential behind the QR on
 * the worker dashboard.
 *
 * Inherited from the Tamil Nadu migrant-worker project, which issued a PDF ID
 * card per worker with a QR pointing at a public profile. Two things changed on
 * the way in:
 *   1. No server-side PDF. The card is a print-styled React page, so Devanagari,
 *      Tamil, Bengali, Telugu and Malayalam names render with the fonts the
 *      phone already has. The reportlab version printed every name in Helvetica,
 *      which mangles non-Latin scripts — unacceptable on an identity document.
 *   2. The QR encodes a keyed verification code, not the worker code itself.
 *      Worker codes are sequential, so encoding the bare code would let anyone
 *      enumerate the registry through the public verify endpoint.
 *
 * The card is the worker's own data served to the worker's own session; the
 * public half (what a stranger scanning the QR gets) lives in routes/public.js
 * and deliberately exposes no phone number or address.
 */
const router = Router();

/** Base URL a scanned QR should open: the SPA, not the API. */
function appBaseUrl(req) {
  if (config.publicAppUrl) return config.publicAppUrl.replace(/\/+$/, "");
  const origin = req.get("origin");
  if (origin) return origin.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

// GET /id-card — everything the printable page needs, for the signed-in worker.
router.get("/", authenticate, requireWorker, async (req, res) => {
  try {
    const worker = await User.findById(req.userId).lean();
    if (!worker) return res.status(404).json({ detail: "Worker not found." });

    // A card is only worth printing once a labour office has accepted the
    // registration — the card is a claim about that acceptance.
    const status = worker.gov_approve_status ?? "pending";
    const code = worker.worker_id ? cardCode(worker.worker_id) : null;

    // Insurance on the card is a claim made at print time, so it is derived
    // from the policy dates rather than a stored flag: a card printed today can
    // only carry cover that is in force today.
    const policies = await InsurancePolicy.find({ worker_id: req.userId }).lean();
    const now = new Date();
    const current = pickCurrentPolicy(policies, now);

    res.set("Cache-Control", "no-store");
    res.json({
      worker_id: worker.worker_id ?? null,
      full_name: worker.full_name,
      occupation: worker.occupation ?? null,
      years_of_experience: worker.years_of_experience ?? null,
      gender: worker.gender ?? null,
      district: worker.current_district ?? null,
      state: worker.current_state ?? null,
      mobile_number: worker.mobile_number,
      registered_on: worker.createdAt ? new Date(worker.createdAt).toISOString() : null,
      status,
      issued: status === "accepted" && Boolean(code),
      verify_code: code,
      verify_url: code ? `${appBaseUrl(req)}/verify/${code}` : null,
      insurance: current
        ? {
            covered: true,
            status: "active",
            provider: current.provider,
            policy_number: current.policy_number,
            coverage: current.coverage ?? "accident",
            sum_insured: current.sum_insured ?? null,
            valid_to: current.valid_to ? new Date(current.valid_to).toISOString() : null,
            verification: current.verification,
          }
        : {
            covered: false,
            status:
              policies.length > 0
                ? policyStatus(
                    policies.reduce((a, b) =>
                      new Date(b.valid_to).getTime() > new Date(a.valid_to).getTime() ? b : a,
                    ),
                    now,
                  )
                : "none",
            provider: null,
            policy_number: null,
            coverage: null,
            sum_insured: null,
            valid_to: null,
            verification: null,
          },
    });
  } catch (err) {
    console.error("[id-card]", err);
    res.status(500).json({ detail: "Could not build the identity card." });
  }
});

export default router;
