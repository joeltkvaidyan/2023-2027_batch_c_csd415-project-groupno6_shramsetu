import { Router } from "express";
import { OCCUPATIONS } from "../utils/occupations.js";
import { listDirectoryWorkers, parseDirectoryPaging } from "../utils/workerDirectory.js";

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

// GET /public/occupations — trades list for directory filters.
router.get("/occupations", (_req, res) => {
  res.json({ occupations: OCCUPATIONS });
});

export default router;
