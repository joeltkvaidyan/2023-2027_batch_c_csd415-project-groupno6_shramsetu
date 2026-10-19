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
✓ tests/jobs.test.js          (20 tests)
✓ tests/security.test.js      (43 tests)
✓ tests/parity.test.js         (6 tests)
✓ tests/contentPolicy.test.js  (1 test)

Test Files  4 passed (4)
     Tests  70 passed (70)
  Duration  8.92s
```

### Frontend tests — `cd frontend && npx vitest run`

```
✓ src/services/documentSecurity.test.ts   (23 tests)
✓ src/components/ProtectedRoute.test.tsx   (7 tests)
✓ src/components/GrievanceStatusBadge.test.tsx (8 tests)
✓ src/i18n/languages.test.ts              (12 tests)
✓ src/pages/phase2.pages.test.tsx          (7 tests)

Test Files  5 passed (5)
     Tests  57 passed (57)
  Duration  8.65s
```

### Frontend typecheck — `cd frontend && npx tsc --noEmit`
Exits 0 with no diagnostics.

### Frontend production build — `cd frontend && npm run build`
```
> tsc -b && vite build
✓ 1714 modules transformed.
dist/assets/index-DvhDMiUr.js  377.04 kB │ gzip: 93.75 kB
✓ built in 5.69s
```

### Locale parity (scripted check)
All six bundles (`en, hi, bn, te, ta, ml`) have identical top-level sections —
verified by comparing key sets after the Phase 2 merge, and enforced in CI-able
form by `src/i18n/languages.test.ts`.

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
- **AI service tests were not run** (missing heavy ML dependencies), so RAG
  retrieval/refusal behaviour is unchanged and unverified in this environment.
- **No end-to-end browser test** was executed: the flow is covered by server
  integration tests plus mocked-API component tests, not by a live browser
  session against a running stack.

## 7. Reproducing the verification

```bash
cd server   && npx vitest run          # 70 passed
cd frontend && npx tsc --noEmit        # clean
cd frontend && npx vitest run          # 57 passed
cd frontend && npm run build           # tsc -b && vite build succeeds
```
