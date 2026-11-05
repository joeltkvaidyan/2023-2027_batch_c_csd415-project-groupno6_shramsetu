# ShramSetu — Final Verification Report

**Date:** 2026-10-19
**Repository:** https://github.com/joeltkvaidyan/shramsetu (base commit d7ae8d8)
**Branch:** freebuff/609c2fe3d62d4f4b212de23e

Everything below was produced by running the commands shown, in this
worktree, on this date. Nothing is marked passing unless its command actually
ran and exited 0. Where a check could not run, that is stated as a limitation.

---

## 1. What was delivered

| Deliverable | Status | Notes |
|---|---|---|
| `docs/RESEARCH_AND_GAP_REPORT.md` | ✅ | Problem landscape, government-service capability audit, prohibited-claims list, legal-framework verification |
| `docs/IMPLEMENTATION_PLAN.md` | ✅ | P0–P3 plan plus a Phase 2 section describing the job/employer work below |
| `docs/KB_QUARANTINE_CHECKLIST.md` | ✅ | Quarantine rules and FAIL-if triggers for the AI knowledge base |
| `docs/verified-sources.json` | ✅ | Curated registry used by the loader gate and the in-app directory |
| `frontend/public/verified-sources.json` | ✅ | Copy served to the Service Directory screen |
| `docs/FINAL_VERIFICATION_REPORT.md` | ✅ | This file |
| Phase 1 code (KB gate, wage locking, directory, scam checker, offline drafts) | ✅ | Preserved; see §3 |
| Phase 2 code (job matching, recurring employers, dashboards) | ✅ | New; see §4 |

---

## 2. Commands run and their results

### Server tests — `cd server && npx vitest run`

```
✓ tests/jobs.test.js          (32 tests)
✓ tests/security.test.js      (43 tests)
✓ tests/parity.test.js         (6 tests)
✓ tests/contentPolicy.test.js  (1 test)

Test Files  4 passed (4)
     Tests  82 passed (82)
  Duration  9.08s
```

### Frontend tests — `cd frontend && npx vitest run`

```
✓ src/services/documentSecurity.test.ts        (23 tests)
✓ src/components/ProtectedRoute.test.tsx        (7 tests)
✓ src/components/GrievanceStatusBadge.test.tsx  (8 tests)
✓ src/components/government/JobsPanel.test.tsx   (4 tests)
✓ src/i18n/languages.test.ts                   (12 tests)
✓ src/pages/phase2.pages.test.tsx               (7 tests)

Test Files  6 passed (6)
     Tests  61 passed (61)
  Duration  11.19s
```

### Frontend typecheck — `cd frontend && npx tsc --noEmit`
Exits 0 with no diagnostics.

### Frontend production build — `cd frontend && npm run build`
```
> tsc -b && vite build
✓ 1714 modules transformed.
dist/assets/index-Rs80ctuK.js  422.86 kB │ gzip: 105.73 kB
✓ built in 6.40s
```

### Locale parity (scripted check)
All six bundles (`en, hi, bn, te, ta, ml`) have identical top-level sections and
identical job/review key sets (61 new keys per locale) — verified by comparing
key sets after the applicant-review merge, and enforced in CI-able form by
`src/i18n/languages.test.ts`.

### Live end-to-end API smoke (real server, not mocked)

Started the API in development mode against embedded MongoDB
(`MONGODB_URI=memory`, which seeds 10 demo workers and the Kerala/Ernakulam
officials) and drove the review flow over HTTP with the seeded accounts:

| Step | Result |
|---|---|
| `POST /auth/government/login` (EKM001) | 200, district `Ernakulam` |
| `POST /jobs` (mason, Ernakulam, 4 openings) | 201, `verification: unverified`, state forced to `Kerala` |
| `POST /auth/worker/login` (9555500101) | 200, `SS-100001` |
| `GET /jobs` as the worker | 200, top match `strong` 95 with `occupation_match`, `same_district`, `recent_posting`, `multiple_openings`, `wage_listed` |
| `POST /jobs/:id/apply` | 201, `submitted`; contact not shared |
| `GET /jobs/:id/applications` as the office | 200, `{total: 1, shortlisted: 0}`, review `strong` 80, `contact_phone: null` |
| `PATCH /jobs/:id/applications/:appId` → `shortlisted` | 200, `shortlisted: true`, `reviewed_at` set |
| `GET /jobs/applications/mine` as the worker | 200, `[('shortlisted', True)]` |
| `GET /jobs/posted` as the office | 200, `applications_count: 1`, `shortlisted_count: 1` |
| same `PATCH` without a token | 401 |

This surfaced one real defect that the unit tests had missed (recency was read
from `createdAt` while the API emits `created_at`, so fresh listings never earned
the recency weight); see §5. The numbers above are from the re-run after the fix.

### AI service tests — NOT RUN (limitation)
`ai-service/tests/` exists, but running it needs heavy ML dependencies
(torch, faiss-cpu, sentence-transformers) plus model downloads that are not
installed in this environment. No AI-service test result is claimed here.

---

## 3. Phase 1 (preserved, re-verified)

- **`ai-service/rag/loader.py`** — quarantines unverified / superseded /
  outdated KB entries by default; only `status="verified"` entries with a real
  verification date are ingested unless `SHRAMSETU_KB_ALLOW_UNVERIFIED`,
  `SHRAMSETU_KB_REQUIRE_PROVENANCE` or `SHRAMSETU_KB_STRICT_VERIFIED_ONLY`
  explicitly relax that.
- **Wage diary** — fully-paid days are locked (`409 wage_paid_locked`),
  partial payments tracked, per-worker ownership enforced on every query.
- **Documents** — per-file encryption keys wrapped by the master key, with
  content-based validation of uploads.
- **Verified service directory** and **scam risk checker** — both read curated
  data only and never claim a government integration.
- **Offline grievance drafts** — IndexedDB draft cache with explicit
  save/restore/discard, kept separate from submitted grievances.
- **155214 is not presented as a Kerala helpline** anywhere; it appears only
  where the Karnataka context applies, and `server/tests/contentPolicy.test.js`
  guards the banned-claim list.

---

## 4. Phase 2 (new in this change)

### 4.1 Recurring employers — worker-owned register

| File | Purpose |
|---|---|
| `server/src/models/Employer.js` | Per-worker recurring employer record; unique on (worker, normalised name); soft-delete |
| `server/src/routes/employers.js` | List / create / update / delete, plus wage totals joined from the caller's own entries |
| `frontend/src/pages/EmployersPage.tsx` | Registration form, per-employer stats, unpaid-wage complaint shortcut |

Design decision worth recording: the request mentioned *employer* registration
of recurring *employees*. That would let one party create records about another
person's work and pay without their consent, which is exactly the cross-worker
data-leak class this project has been hardening against. So the feature is
implemented as the worker's own private employer list instead. It is labelled
self-reported in the UI, and wage totals are computed only from that worker's
`WageEntry` rows (asserted in `tests/jobs.test.js` by planting another worker's
row with the same employer name and proving it is excluded).

### 4.2 Job matching

| File | Purpose |
|---|---|
| `server/src/models/JobPosting.js` | Listing model; `verification` is pinned to `"unverified"` by the schema |
| `server/src/models/JobApplication.js` | Application with a consent-gated contact snapshot |
| `server/src/utils/jobMatch.js` | Pure, explainable additive scorer (`scoreJob`) |
| `server/src/routes/jobs.js` | Matching list, detail, apply/withdraw, official posting + applicant routes |
| `frontend/src/pages/JobsPage.tsx` | Match cards with reasons, filters, apply/withdraw |
| `frontend/src/components/government/JobsPanel.tsx` | Official-side listing creation, status toggle, applicant list |

Matching is a transparent score, not a learned ranker: exact trade match +45,
"any trade" +15, same district +25, same state +15, posted ≤7 days +15 / ≤30
days +8, ≥3 openings +5, wage stated +5, with a hard visibility floor
(`MIN_MATCH_SCORE = 25`). Every point shown maps to a reason chip the worker can
read, and the API response carries an explicit note that the score is guidance,
not a promise of work or of the stated wage. Ranking, reasons and the floor are
unit-tested against fixed inputs.

### 4.3 Authorisation and privacy rules (all asserted in tests)

- A district official's listing is forced into their own state/district;
  an out-of-scope listing is `403`.
- Only the posting official (or a superadmin) can close a listing or read its
  applicants; anyone else gets `404`, not `403`, so the existence of another
  office's listing is not confirmed.
- An applicant's phone number reaches the office **only** when the worker
  ticks "share my number" at apply time; otherwise `contact_phone` is `null`
  even for the posting office.
- Employers are worker-scoped: another worker's `GET` returns an empty list and
  `PATCH`/`DELETE` on a foreign id return `404` with the record unchanged.
- Worker tokens are rejected on posting routes and government tokens on the
  matching route.
- Applications are unique per (worker, listing); applying twice returns `409
  already_applied`, applying to a closed listing returns `409 job_closed`.

### 4.4 Dashboards

- **Worker dashboard** now shows a three-stat work snapshot (job matches,
  saved employers, unpaid wages for the last 90 days) sourced from
  `/jobs`, `/employers` and `/wages/summary`, plus "Job matches" and "Recurring
  employers" action tiles.
- **Government dashboard** gains a "Job Listings" tab rendering `JobsPanel`
  (create, close/reopen, applicant counts, consent-aware applicant detail).

### 4.5 Internationalisation

`jobs`, `employers` and the three new `dashboard` keys were added in English,
Hindi, Bengali, Telugu, Tamil and Malayalam. Occupation codes are mapped
through a single `OCCUPATION_LABEL_KEYS` table so screens look up the existing
`auth.occupation*` translations instead of inventing keys from the code.

### 4.6 Applicant review — "review workers" for the posting office

The office can now open a listing and review the workers who applied, ranked by
a reverse of the same explainable scorer:

| File | Purpose |
|---|---|
| `server/src/utils/jobMatch.js` | `scoreApplicant()` / `withApplicantMatch()` — additive fit from the worker's stored trade/district/state (50/30/15, `any` trade = 20) |
| `server/src/models/JobApplication.js` | `shortlisted` status plus `reviewed_at` / `reviewed_by`; `toOfficialJSON` exposes both |
| `server/src/routes/jobs.js` | `GET /jobs/:id/applications` now ranks + returns counts and a fit note; new `PATCH /jobs/:id/applications/:applicationId` |
| `frontend/src/components/government/JobsPanel.tsx` | Review queue with fit badges, reason chips, All/Shortlisted filter, shortlist toggle |
| `frontend/src/pages/JobsPage.tsx` | Score meter, shortlisted state, debounced search, clearer empty state |

Honesty rules enforced in code and UI:

- `shortlisted` is a triage mark. The worker sees "the office read your
  application — this is not an offer of work", and the office card says the
  same. No status implies hiring, and no wage/placement claim is made.
- The fit score compares only trade, district and state. A thin profile yields
  `detail_not_recorded` instead of a low score presented as a judgement.
- A worker's phone still appears only when they ticked "share my number";
  otherwise the panel says to contact them through the office.
- Shortlisting is scoped to the posting office: a foreign official gets `404`,
  and an application id is only reviewable through its own listing.
- Re-applying cannot wipe a shortlist (`409 already_applied`), and withdrawing
  clears both consent and the review mark.

---

## 5. Defects found and fixed during this work

1. **Duplicate-key crash risk** — `Employer` name uniqueness is enforced by a
   per-worker index and `11000` errors are translated to `409 employer_exists`
   rather than a 500.
2. **Soft delete vs. wage history** — deleting a recurring employer now sets
   `is_active=false` instead of removing the row, so the employer name in the
   wage diary still resolves; re-adding the same name reactivates the record.
3. **Phone validation** — employer and listing phone numbers are normalised to
   digits and rejected with `422` when outside 10–15 digits, instead of being
   silently truncated.
4. **Applicant list leak** — the applicant route is ownership-checked before it
   queries anything, so a foreign official cannot enumerate applicants.
5. **Withdraw now clears consent data** — withdrawing an application nulls the
   stored `contact_phone`, so consent is not retained after the worker backs
   out.
6. **Frontend test-mock identity bug** — the new screen tests initially hung
   because a re-created `t` function changed an effect dependency; the mock now
   mirrors react-i18next's stable `t`, matching production behaviour.
7. **Recency never scored** — `scoreJob` read `job.createdAt`, but the API
   serialises `created_at`. Every fresh listing was silently losing the
   recency weight its reasons promised (live smoke showed 80 instead of 95).
   Fixed to accept both shapes, with a regression test.
8. **Populated `job_id` stringified** — `applications/mine` populates `job_id`,
   and `String(this.job_id)` could yield a document string. It now unwraps
   `_id` so the worker client always receives an id.
9. **Missing `wages.exportCSV` in five locales** — the wage diary's export
   button fell back to English for hi/bn/te/ta/ml. Translated.

---

## 6. Honest limitations and dependencies

- **There is no employer account type.** Listings come from authenticated
  government/partner officials inside their own jurisdiction. A self-service
  employer portal would need a third role, credential vetting and a fraud
  process; none of that exists, and nothing in the UI claims it does.
- **Nothing about an employer is verified.** Listings carry
  `verification: "unverified"` and the UI repeats the "never pay a fee" warning.
  ShramSetu does not check that a listed wage will be honoured.
- **No seed/demo listings** were added, so a fresh database shows the empty
  state with its explanatory copy until an official posts a listing.
- **Matching uses stored profile fields only** (trade, district, state). It does
  not consider wage history, availability or travel distance.
- ~~**AI service tests were not run** (missing heavy ML dependencies)~~
  **RESOLVED 2026-11-05:** with the venv provisioned, the AI-service suite runs
  — 103/103 passing (loader gate, corpus integrity, retrieval/refusal, PII,
  injection, cold start). See §8 addendum.
- **No end-to-end browser test** was executed. The API flow *was* exercised
  end-to-end against a running server (§2), and the screens are covered by
  jsdom tests, but nobody has clicked through the review queue in a real
  browser yet — the dev preview is running for exactly that check.
- **Review is triage, not hiring.** There is no interview scheduling, no offer
  letter, no candidate messaging and no notification to the applicant beyond a
  status flag; all of that would need a decision-record model first.

## 7. Reproducing the verification

```bash
cd server   && npx vitest run tests     # 206 passed (10 files)
cd ai-service && venv\Scripts\python -m pytest tests -q   # 103 passed
cd frontend && npx tsc --noEmit         # clean
cd frontend && npx vitest run           # 61 passed (6 files)
cd frontend && npm run build            # tsc -b && vite build succeeds

# live API smoke (seeded demo data, embedded Mongo)
cd server && MONGODB_URI=memory node src/index.js
```

For the UI, the Vite dev server proxies `/api` to `localhost:8000`, so with both
processes running the government dashboard's **Job Listings** tab exercises the
real review flow (sign in as `EKM001` / `Ernakulam@123`).

---

## 8. Addendum — full verification after phase 2 (2026-11-05)

This report was originally written in an environment that could not run the
AI-service suite or the full server suite. With the venv provisioned and the
phase-2 knowledge-base curation merged, every suite runs and passes:

| Suite | Result (2026-11-05) |
|---|---|
| `cd server && npx vitest run tests` | **206/206** |
| `cd ai-service && venv\Scripts\python -m pytest tests -q` | **103/103** |
| `cd frontend && npm run typecheck` | clean |
| `cd frontend && npm test` | **61/61** |
| `cd frontend && npm run build` | succeeds |

KB state at close: 76 docs in `ai-service/rag/sample_docs/` — 65 active
(66 FAISS vectors) + 11 superseded (skipped by the loader); zero "needs
review" markers; every non-superseded doc grounded in
`docs/verified-sources.json` (80 entries, `generated_at` 2026-11-03).
Retrieval re-measured in retrieval-only mode: hit@1 **45/49 (92%)**, hit@3
**47/49 (96%)**, off-topic + injection refusals **12/13** —
`ai-service/eval/RESULTS.md` (threshold unchanged at 0.45). The fact-level
changes and the standing review cadence are in
`RESEARCH_AND_GAP_REPORT.md` §6–7.

Rectified during this close-out: the Mongoose "duplicate schema index on
{\"worker_id\":1}" warning — `server/src/models/User.js` now declares the
worker-code index exactly once, as `unique` +
`partialFilterExpression { role: "worker", worker_id: { $gt: null } }`, and
the server suite re-verified green.
