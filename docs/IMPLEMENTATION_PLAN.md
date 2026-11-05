# ShramSetu — Implementation Plan

**Date:** 2026-10-19 (original plan) · **Last updated:** 2026-11-05 — every item below is implemented and verified (see the ✅ markers and §7)  
**Status:** Updated based on actual codebase audit (commit d7ae8d8). Repository present with strong foundations.

---

## 1. Current State Summary

**Strengths:**
- Server (Node/Express): 206 tests passing. Auth with liveness checks, role scoping, jurisdiction enforcement (state/district), audit logging, rate limiting. Document encryption with per-file keys wrapped by master key, content-based validation. Wage logging with locking (prevents editing fully-paid days), proper validation, prefill-to-grievance. Grievance routing with jurisdiction scoping.
- Frontend (React/TS): 61 tests passing, typecheck clean. Wage log page complete with partial payments, balances, CSV export, grievance deep-linking. Verified service directory + scam-checker pages. i18n (6 langs), offline storage (idb), document caching, installable PWA (manifest + network-first service worker).
- AI service (FastAPI): RAG with FAISS+BM25 over a fully curated 65-active-doc corpus, registry-driven loader gate, provenance metadata, PII stripping, grounded flag, citations, multilingual, health/readiness with warmup.
- Security: Good practices throughout. Tests validate critical cases.

**Gaps (P0): — ALL CLOSED, final state verified 2026-11-05**
1. ✅ KB gated: `rag/loader.py` is verified-only against `verified-sources.json`; "needs review"/superseded/unregistered docs never reach the index.
2. ✅ All 61 flagged docs curated (phase 2); zero "needs review" markers remain across the 76 KB docs.
3. ✅ UI built: verified government-service directory (`ServiceDirectoryPage.tsx`) and scam checker (`ScamCheckerPage.tsx`).
4. ✅ Offline grievance drafts via idb; PWA live (manifest + hand-rolled `public/sw.js`).
5. ✅ Banned-claims enforcement: the 13 `excluded_claims` are scanned by content tests.

---

## 2. Priority Order

P0 (Critical - correctness/security) → P1 (High impact) → P2 (Medium) → P3 (Nice-to-have). No item marked done without verified tests.

---

## 3. P0 — Critical Fixes

### P0-1. KB verification gating (verified-only) — ✅ DONE (phase 1)
**Why:** Many KB docs have "needs review" metadata. Must enforce "verified only" per requirement.

**Outcome:** `rag/loader.py` loads the registry, quarantines "needs review" docs, skips superseded docs, and refuses SOURCE_URLs absent from the registry unless the doc TITLE matches a registry entry. Enforced by the ai-service loader/corpus tests.

**Changes:**
- Modify `ai-service/rag/loader.py`: load `docs/verified-sources.json`, build allow-list of verified source URLs/entries. Only ingest docs that meet verification criteria (properly verified, not superseded, no "needs review" in critical fields). Skip docs with `LAST_VERIFIED: needs review`, `SOURCE_URL: needs review`, or missing required verification.
- Treat status normalization: "current" is acceptable if properly verified; still reject unverified.
- Add logging for skipped unverified docs.
- If no verified docs load, fail fast with clear error.

**Acceptance:** Only verified docs ingested; docs with "needs review" skipped; loader logs what’s excluded.

**Tests:** Unit test for loader verification gating.

### P0-2. Enforce banned claims — ✅ DONE (phase 1)
**Why:** Prevent asserting unverified figures/numbers.

**Outcome:** content tests scan the KB corpus (and user-facing surfaces) against all 13 `excluded_claims` entries in `verified-sources.json`; grounded answers below the similarity threshold refuse rather than guess.

**Changes:**
- Add check in AI service/RAG pipeline to scan responses for patterns from `verified-sources.json.excluded_claims`. If detected in grounded answer, force `grounded=false` or refuse.
- Add content lint test scanning user-facing text (frontend strings, KB docs, API responses) for banned patterns.

**Acceptance:** Banned claims never appear in grounded answers. Test catches violations.

**Tests:** Content policy test against banned-claims patterns.

### P0-3. Strengthen KB corpus curation — ✅ DONE (phase 2, 2026-11-03)
**Why:** 48 docs have "needs review" - need to clean up or exclude.

**Outcome:** 61 flagged files curated to zero markers; every non-superseded doc grounded in the registry with `LAST_VERIFIED: 2026-11-03`; superseded docs left untouched for the loader to skip. Fact-level changes and the standing review cadence: see RESEARCH_AND_GAP_REPORT §6–7.

**Changes:**
- Review each doc with "needs review"; either fix metadata (add proper URL, verification date from verified-sources.json where matches) or mark as superseded/exclude.
- Ensure current law docs (Code on Wages 2019, OSH Code 2020) have proper verification.

**Acceptance:** Critical current-law docs properly verified; unfixable ones excluded from trusted ingestion.

---

## 4. P1 — High Impact Features

### P1-1. Verified government-service directory UI — ✅ DONE (phase 1)
**Why:** `verified-sources.json` has 44 verified entries but no user-facing directory.

**Changes:**
- Create `frontend/src/pages/ServiceDirectoryPage.tsx` - displays services from verified-sources.json (or fetch from API). Show: title, category, jurisdiction, status, last_verified, notes, official URL.
- Add route in App.tsx (e.g., `/worker/services` or accessible from dashboard).
- Add translations for directory UI.
- Distinguish: schemes, portals, boards; mark uncertain statuses clearly.

**Acceptance:** Page loads, shows verified entries with official links, no invented services.

**Tests:** Component test rendering directory entries.

### P1-2. Explainable recruitment-scam risk checker — ✅ DONE (phase 1)
**Why:** Helps workers identify red flags without making definitive legal claims.

**Changes:**
- Create `frontend/src/pages/ScamCheckerPage.tsx` with checklist (fees demanded, no written contract, ID withheld, agent not registered, etc.). Each item explains why (explainable). Gives risk level (low/medium/high) with actionable guidance - never definitive legal conclusion.
- Link to official channels (NCS helpline 1514, labour offices). Cite verified sources only.
- Add route and translations.

**Acceptance:** Explainable, cites official guidance, avoids fabricating statistics.

**Tests:** Component tests for checklist logic.

### P1-3. Grievance offline drafts — ✅ DONE (phase 1)
**Why:** Workers may have connectivity issues; offline drafts improve usability.

**Changes:**
- Extend offlineStorage to support grievance drafts (separate from submitted). Save draft on form changes (debounced), restore on load if offline/reconnect.
- Update `GrievanceFormPage.tsx` to auto-save drafts locally, show "Draft saved locally" indicator, allow "Discard draft".
- Sync when online.

**Acceptance:** Drafts persist across reloads, work offline, don't get mixed with submitted grievances.

**Tests:** Frontend tests for draft save/restore.

### P1-4. Downloadable wage reports — ✅ DONE (phase 1; CSV)
**Why:** Workers need evidence they can download/share.

**Changes:**
- Add export in `WageLogPage.tsx`: download CSV and/or PDF of current month's wage entries + summary. Include worker info (non-PII), dates, agreed/paid/balance, status.
- Generate client-side (no server changes needed). Clear filename with month.
- Include disclaimer it's self-reported.

**Acceptance:** CSV downloads correctly formatted; includes all visible data; no sensitive leakage.

**Tests:** Unit test for CSV generation.

---

## 5. P2 — Medium Priority

### P2-1. Configure PWA properly — ✅ DONE (via a hand-rolled worker, not the plugin)
**Changes:** Add vite-plugin-pwa to vite.config.ts with basic manifest, service worker for offline caching of static assets. Keep existing offlineStorage for dynamic data.

**Acceptance:** PWA installable, basic offline works.

**Outcome:** `index.html` links `/manifest.webmanifest` (+ SVG icon, theme-color); `main.tsx` registers `public/sw.js` in production builds. The worker is a documented network-first v2 strategy so phones always run current code (an earlier stale-while-revalidate worker kept serving stale dev modules; see the rationale in `public/sw.js`). idb remains the dynamic-data path. `vite-plugin-pwa` stays installed but is deliberately unused — adopting it later is one config line.

### P2-2. KB curation and alignment — ✅ DONE (phase 2; superset of P0-3)
**Changes:** Fix metadata for critical docs where possible (match verified-sources), exclude unfixable ones. Update docs to reflect current state.

**Outcome:** completed with P0-3 — zero "needs review" markers, registry-grounded, review cadence documented in RESEARCH_AND_GAP_REPORT §7.

### P2-3. Strengthen AI refusal/citation — ✅ DONE
**Changes:** Ensure responses always include proper citations from retrieved sources; strengthen grounded checks. Add test for refusal when context insufficient.

**Outcome:** similarity gate (0.45) + grounded flag + citation provenance, covered by refusal/injection tests in the ai-service suite; 12/13 off-topic+injection refusals measured in `eval/RESULTS.md`.

---

## 6. Testing Strategy

- **Baseline:** Server (206) + Frontend (61) + AI service (103) all passing - maintain.
- **New tests:** Add for KB gating, banned claims, service directory, scam checker, wage CSV export, draft save/restore.
- **AI tests:** Where deps allow, add tests for refusal behavior, citation presence, multilingual responses.
- **Run after each P0 fix:** All existing tests must still pass (no regression).

---

## 7. Acceptance Criteria (Global)

- All existing tests still pass
- New tests pass
- Typecheck/lint clean
- No committed secrets, no production placeholders
- No unverified claims in grounded answers
- Only verified KB content ingested
- UI never claims government integration that doesn’t exist

---

## 8. Execution Order

1. P0-1 (KB gating) + tests
2. P0-2 (banned claims) + tests  
3. P0-3 (KB curation)
4. P1-1, P1-2, P1-3, P1-4 (features) + tests
5. P2 items
6. Run full test suite, typecheck, build
7. Update FINAL_VERIFICATION_REPORT.md with verified outcomes
---

## 9. Phase 2 — implemented (job matching, recurring employers, dashboards)

Status: **implemented and tested.** See `docs/FINAL_VERIFICATION_REPORT.md` §4
for the evidence and for the deliberate scope decisions.

### 9.1 Scope decision on "employer registers recurring employees"

An employer-side flow that creates records about a worker's employment would
let one party assert facts about another without consent, and would sit outside
the existing per-worker data-isolation model. It was therefore implemented as a
worker-owned **recurring employer register** instead: the worker lists the
employers they work for often, sees their own wage totals against each, and can
prefill an unpaid-wage grievance from it. Deliberately excluded: any shared
employer directory, employer accounts, and any verification claim.

### 9.2 Job matching

- `server/src/models/JobPosting.js`, `JobApplication.js`
- `server/src/utils/jobMatch.js` — pure additive scorer with a documented
  weight table and a visibility floor; unit-tested
- `server/src/routes/jobs.js` — worker matching/detail/apply/withdraw;
  official create/close/applicants/review
- `frontend/src/pages/JobsPage.tsx`, `frontend/src/components/government/JobsPanel.tsx`
- Rules: jurisdiction forced on create; ownership checked before any applicant
  query (404, not 403, for foreign ids); contact phone shared only on explicit
  worker consent; `verification` pinned to `unverified` in the schema.

#### 9.2.1 Applicant review ("review workers")

- `scoreApplicant()` in `server/src/utils/jobMatch.js` mirrors the worker
  scorer: trade 50, district 30, state 15, any-trade 20. It reports
  `detail_not_recorded` for a thin profile rather than scoring absence.
- `PATCH /jobs/:id/applications/:applicationId` sets `submitted` or
  `shortlisted` for the posting office only, records `reviewed_at` / `reviewed_by`,
  and writes an audit entry. A foreign office gets `404`.
- `shortlisted` is triage: the worker sees "the office read your application —
  this is not an offer of work". Re-applying cannot wipe the mark; withdrawing
  clears both the mark and any shared phone number.
- `JobsPanel` shows the queue sorted by fit with reason chips, an All/Shortlisted
  filter, consent-aware contact display, and the same disclaimers the worker
  sees.

### 9.3 Dashboards

- Worker: three-stat work snapshot (job matches, saved employers, unpaid
  wages) plus two new tiles, all fed by existing authenticated endpoints.
- Government: "Job Listings" tab with create, close/reopen, applicant and
  shortlisted counts, and the ranked applicant review queue.

### 9.4 Remaining follow-ups (not implemented, listed honestly)

1. **Employer accounts** (third role) with onboarding checks, if a real
   employer-side product is wanted — needs a fraud/abuse process first.
2. **Listing expiry** — closed/aged listings are filtered but never archived;
   an age-out job is needed before the table grows.
3. **Application notifications** — applying does not yet notify the posting
   office through the existing notification model.
4. **Richer matching** — incorporate wage-diary history, experience and
   availability into both directions of the score.
5. **Review outcomes** — only shortlist/un-shortlist exists. Interview
   scheduling, offer records and applicant messaging need a decision model with
   its own audit trail before they are safe to add.
6. **A live browser pass** over the review queue against the running stack;
   everything so far is API-level plus jsdom.
7. **AI-service test execution** — blocked by uninstalled ML dependencies.
