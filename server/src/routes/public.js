import { Router } from "express";
import { OCCUPATIONS } from "../utils/occupations.js";
import { listDirectoryWorkers, parseDirectoryPaging } from "../utils/workerDirectory.js";
import { User } from "../models/User.js";
import { parseCardCode, tokenMatches } from "../utils/cardToken.js";
import { cardVerifyLimiter } from "../middleware/rateLimit.js";

/**
 * Public "find a worker" listing — kept for outside integrations and tests.
 * The SPA no longer links to an open directory: signed-in employer and
 * household accounts use /directory/workers, which is the only surface that
 * includes a contact number.
 *
 * Privacy here is structural: only the fields a worker's own registration
 * already made public-by-nature are returned (name, trade, experience years,
 * state, district) plus the community rating summary. Phone numbers, street
 * addresses, documents, wages and QR codes are NEVER exposed here.
 */
const router = Router();

// GET /public/workers?name=&place=&occupation=&page=&page_size=
router.get("/workers", async (req, res) => {
  try {
    const { page, pageSize } = parseDirectoryPaging(req.query);
    const result = await listDirectoryWorkers({
      name: String(req.query?.name || "").trim(),
      place: String(req.query?.place || "").trim(),
      occupation: String(req.query?.occupation || "").trim(),
      page,
      pageSize,
      includePhone: false,
    });

    res.json({
      ...result,
      notice:
        "Only government-accepted workers are listed, with just their name, trade and place visible. Sign in as an employer or household to see a contact number. Ratings are community feedback, not verification; the shift counts and paid-on-time figures come from employer-confirmed engagements. A low rating never removes anyone from this list.",
    });
  } catch (err) {
    console.error("[public/workers]", err);
    res.status(500).json({ detail: "Could not load workers." });
  }
});

/**
 * GET /public/verify/worker/:code — what scanning a worker ID card's QR does.
 *
 * `code` is `<worker_id>.<token>` (see utils/cardToken.js). Three independent
 * gates before any data is returned: the code must parse, its token must match
 * the keyed digest for that worker, and the worker must still be active and
 * ACCEPTED by a labour office. A card therefore stops verifying the moment a
 * registration is rejected or the account is disabled.
 *
 * What comes back is only what a stranger holding the physical card already
 * knows: name, trade, district, state. No phone number, address, Aadhaar last
 * four or document data — the card is a verification surface, not a directory.
 *
 * Every failure returns the same 404 body, so a wrong token cannot be told
 * apart from a worker code that never existed.
 */
router.get("/verify/worker/:code", cardVerifyLimiter, async (req, res) => {
  const notFound = { valid: false, detail: "No verified worker matches this card." };
  try {
    const parsed = parseCardCode(req.params.code);
    if (!parsed) {
      return res.status(400).json({ valid: false, detail: "This is not a ShramSetu identity code." });
    }
    if (!tokenMatches(parsed.workerId, parsed.token)) {
      return res.status(404).json(notFound);
    }

    const worker = await User.findOne({
      worker_id: parsed.workerId,
      role: "worker",
      is_active: true,
    })
      .select(
        "worker_id full_name occupation current_district current_state gov_approve_status createdAt",
      )
      .lean();

    if (!worker || worker.gov_approve_status !== "accepted") {
      return res.status(404).json(notFound);
    }

    res.set("Cache-Control", "no-store");
    res.json({
      valid: true,
      worker_id: worker.worker_id,
      full_name: worker.full_name,
      occupation: worker.occupation ?? null,
      district: worker.current_district ?? null,
      state: worker.current_state ?? null,
      registered_on: worker.createdAt ? new Date(worker.createdAt).toISOString() : null,
      checked_at: new Date().toISOString(),
      notice:
        "This confirms the worker's registration and labour-office acceptance. It is not a background check, and it says nothing about a specific employer or wage.",
    });
  } catch (err) {
    console.error("[public/verify/worker]", err);
    res.status(500).json({ detail: "Could not verify this card right now." });
  }
});

// GET /public/occupations — trades list for directory filters.
router.get("/occupations", (_req, res) => {
  res.json({ occupations: OCCUPATIONS });
});

export default router;
