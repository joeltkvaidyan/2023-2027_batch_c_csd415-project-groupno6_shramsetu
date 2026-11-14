import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { OCCUPATIONS } from "../utils/occupations.js";
import { listDirectoryWorkers, parseDirectoryPaging } from "../utils/workerDirectory.js";

/**
 * Signed-in worker directory — the hiring side's "find and call" screen.
 *
 * Only an authenticated employer or household account reaches it (a public
 * visitor, a worker or an official gets 403). The same visibility rule as the
 * public listing applies (active + phone-verified + labour-office accepted),
 * so signing in never exposes a worker who could not already be found.
 *
 * The one deliberate difference: the response carries the worker's mobile
 * number, because the whole point of this screen is to call them about work.
 * Street addresses, documents and wages still never leave the server.
 */
const router = Router();

function requireContactViewer(req, res, next) {
  if (req.userRole !== "employer" && req.userRole !== "citizen") {
    return res.status(403).json({
      detail: "Sign in with an employer or household account to see worker contact numbers.",
      code: "contact_viewer_required",
    });
  }
  next();
}

// GET /directory/workers?name=&place=&occupation=&page=&page_size=
router.get("/workers", authenticate, requireContactViewer, async (req, res) => {
  try {
    const { page, pageSize } = parseDirectoryPaging(req.query);
    const result = await listDirectoryWorkers({
      name: String(req.query?.name || "").trim(),
      place: String(req.query?.place || "").trim(),
      occupation: String(req.query?.occupation || "").trim(),
      page,
      pageSize,
      includePhone: true,
    });

    res.json({
      ...result,
      notice:
        "Contact numbers are shown only to signed-in employer and household accounts, so you can call a worker about work. Use them for that purpose only — never to advertise, resell or harass.",
    });
  } catch (err) {
    console.error("[directory/workers]", err);
    res.status(500).json({ detail: "Could not load workers." });
  }
});

// GET /directory/occupations — trades list for the signed-in filter.
router.get("/occupations", authenticate, requireContactViewer, (_req, res) => {
  res.json({ occupations: OCCUPATIONS });
});

export default router;
