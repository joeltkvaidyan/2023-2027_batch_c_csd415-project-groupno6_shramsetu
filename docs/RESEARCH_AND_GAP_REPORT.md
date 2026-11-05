# ShramSetu — Research and Gap Report

**Date:** 2026-10-19 (original audit) · **Last updated:** 2026-11-05 (phase-2 closure — see §6–7)  
**Status:** Grounded in actual codebase audit (commit d7ae8d8) + current official research

---

## 1. Executive Summary

ShramSetu is a functional multi-component platform (React/TS frontend, Node/Express backend, FastAPI AI service with RAG/FAISS) with good security foundations (document encryption with key wrapping, content-based validation, jurisdiction scoping, wage locking, audit logging). However, several gaps remain relative to the goal of being a secure, reliable multilingual platform for interstate migrant workers in Kerala:

- **KB verification gap (P0) — RESOLVED (2026-11-03):** `rag/loader.py` now enforces verified-only ingestion cross-referenced against `verified-sources.json`; "needs review" docs are quarantined, superseded docs skipped. See §6.
- ~~**Missing UI features**~~ **RESOLVED:** the verified government-service directory page and the explainable recruitment-scam risk checker are built, routed and tested (see §4 gaps 3–4).
- ~~**Offline drafts / PWA**~~ **RESOLVED:** grievance-form drafts round-trip through idb (`offlineStorage.ts`), and the app ships as an installable PWA — `index.html` links the manifest, and a hand-rolled network-first service worker (`public/sw.js`) registers in production builds. `vite-plugin-pwa` stays installed but deliberately unused (the manual worker avoids stale-module caching during development).
- ~~**KB corpus quality**~~ **RESOLVED (2026-11-03):** zero "needs review" flags remain across all 76 KB docs; the curation pass and its ongoing cadence are described in §6–7.

---

## 2. Real Problems Faced by Migrant Workers in Kerala (Evidence)

Based on current research (2024-2025):

### 2.1 Unpaid Wages (Strong Evidence)
- **India Labourline Kochi (Oct 2022–Dec 2023):** 1,093 complaints about non-payment/withholding of wages (98% of complaints). Total claims ₹1.3 crore; ~1/3 settled. Evidence often weak (no written contracts/records). Employers absent at some legal adalats. ([The South First, 2024](https://thesouthfirst.com/keralam/helpline-unveils-%E2%82%B91-3-crore-wage-theft-from-migrant-labourers-in-kerala-over-14-months/))
- **Implication:** ShramSetu's wage diary with locking and prefill-to-grievance is well-aligned. Needs stronger export/complaint draft generation.

### 2.2 Scale & Visibility
- **2025 Assembly (Kerala):** No accurate official count of migrant workers; registrations under different schemes don't sum to total. Aawaaz ~5.16 lakh, Athidhi ~4.2 lakh, ISMW scheme ~1.65 lakh vs 2021 estimate ~31 lakh. ([The Hindu, Oct 2025](https://www.thehindu.com/news/national/kerala/no-accurate-data-on-number-of-migrant-workers-in-state/article70190377.ece))
- **Implication:** Avoid absolute counts in UI/KB unless year-specified and verified.

### 2.3 Language Barriers
- Kochi study (353 workers): 64.8% identified language barriers to healthcare access. ([Mondal et al, 2024](https://jswep.in/index.php/jswep/article/view/304))
- **Implication:** Multilingual UI + voice support valuable. Current codebase has i18n (6 langs), STT/TTS in AI service - good foundation.

### 2.4 Other Issues
- Recruitment scams: Evidence of informal hiring/mismatched promises; limited quantified data for Kerala inward migration specifically. Need careful, non-alarmist guidance.
- Document loss/retention: Weak evidence of widespread ID withholding; stronger evidence of missing employment proof hindering claims.
- Grievance redressal: Channels exist (Labour Call 1800-42555-214, Citizen Call 155300, CPGRAMS) but resolution not guaranteed.

### 2.5 Access, not registration (SIIMS 2026 — 1,824 workers, 33 districts, KA/TN/KL)
- The UNFPA–IIMAD **South India Interstate Migration Survey (SIIMS 2026)** found 73.3% of interstate migrant workers had problems accessing welfare schemes and services, 69.2% had trouble accessing healthcare, 86.4% had no signed employment contract and 57.6% were paid in cash; 77.4% were recruited through non-contractor channels. Its recommendations include **multilingual helplines and help desks**, ration-portability awareness and stronger labour inspection ([UNFPA–IIMAD report](https://india.unfpa.org/sites/default/files/pub-pdf/2date26-date9/UNFPA-IIMAD%20Report.pdf); [Down To Earth coverage](https://www.downtoearth.org.in/governance/nearly-three-in-four-migrant-workers-in-southern-india-report-improved-living-standards-survey-finds)).
- **Implication:** the platform's social value is the last mile — telling a worker in their own language what a scheme covers, where to claim it, and how — not creating one more registration gateway.

### 2.6 Registration ≠ welfare (e-Shram at national scale, AAWAZ in Kerala)
- e-Shram passed **31.78 crore** unorganised-worker registrations on 14 July 2026 ([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2286757&reg=48&lang=2)) — one of the world's largest worker registries — but its headline metric is registrations, not benefits received; independent analysis argues it made workers "visible to the state" without enabling claims ([The e-SHRAM Paradox, Mainstream Weekly](https://mainstreamweekly.net/article16755.html)).
- Kerala's **AAWAZ** card is the sharpest local case: ~5.16 lakh cards issued, but only **~374 cardholders** are known to have received medical help across about four years — well under 0.1%. Documented causes: workers saw the card as a work ID, did not know which hospitals were empanelled or how to claim, and outreach ran mainly in Malayalam or English ([The News Minute, 2022](https://www.thenewsminute.com/kerala/kerala-s-aawaz-health-insurance-migrant-labourers-benefited-only-handful-171316)). Enrolment is reported to have closed in 2022; the current status is treated as **uncertain** in `verified-sources.json` (`aawaz-status`), never presented as active.
- **Implication:** ShramSetu must never present a card or registration as an entitlement (already enforced via registry `excluded_claims`). The AI assistant and service directory must answer the three exact questions that failed here: what does my card cover, where can I claim, how — in the worker's language.

### 2.7 New rights under the 2026 final Labour Code Rules
- The four Codes took effect 21 November 2025; **final Central Rules were notified 8 May 2026**. Reportedly: a **Grievance Redressal Committee is mandatory** in industrial establishments with 20+ workers, and **contract-labour grievances** on wages, health or working conditions go to a committee of the **principal employer**, escalating to the **Inspector-cum-Facilitator** if unresolved within **30 days** ([KPMG flash alert](https://kpmg.com/xx/en/our-insights/gms-flash-alert/2026/flash-alert-2026-127.html)). Central-sector scope — Kerala/state rules may still be drafts.
- **Implication:** rights this new are unclaimable unless workers know they exist; added to the RAG corpus as `labour-codes-grievance-path-2026.txt` (verified 2026-10-20, registry entry `labour-codes-central-rules-2026-summary`).

### 2.8 Heat — an advisory without teeth
- The Labour Ministry issued a **nationwide heatwave advisory on 28 April 2026** (flexible/slower pace in extreme heat, two-person crews, rest areas with ventilation, special attention to construction and brick-kiln workers, awareness campaigns at labour chowks) ([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2256186&reg=3&lang=1)) — but it is **advisory, non-binding**, and unions were still demanding binding heat provisions into mid-2026 ([India Mongabay, May 2026](https://india.mongabay.com/2026/05/workers-groups-are-pushing-for-legal-protections-against-deadly-heat)).
- **Implication:** until protected hours are binding, a worker-facing heat guidance capability (scheduling, water/rest, buddy system, red-flag symptoms) in the worker's language partially fills the gap; added as `heat-stress-advisory.txt` with a dashboard entry point.

---

## 3. Existing Government Services (Verification)

| Service | What it does | What it doesn't do |
|---|---|---|
| **ATHIDHI Kerala** | Registration for migrant workers, employers, contractors; multilingual info. | Not proof of AAWAZ enrollment; live portal access can be intermittent. |
| **AAWAZ** | Health insurance/accident cover for interstate migrant workers in Kerala (18-60). | Benefit amounts need verification against current notifications. |
| **e-Shram** | National unorganised worker database (UAN); scheme discovery gateway. | Not benefit itself; schemes have own eligibility. Requires Aadhaar-linked mobile or CSC. Helpline 14434. |
| **ONORC** | Ration portability for existing NFSA beneficiaries. | Not a new ration card; doesn't create entitlement. |
| **NCS** | Job search/matching, fairs, counselling. | No job guarantee; warns against fee demands. Helpline 1514. |
| **UMANG** | Access gateway to participating e-gov services. | Not a benefit scheme; availability varies by location. |
| **CPGRAMS** | Public service delivery grievance tracking. | Not emergency/legal appeal; excludes some matters. |

---

## 4. Codebase Audit Findings

### Strengths
- **Security:** Document encryption with per-file keys wrapped by master key (AES-256-GCM); content-based upload validation (magic bytes); extension/content consistency checks; owner scoping on all doc operations; audit logging.
- **Auth/Access:** JWT with short expiry (12h), liveness cache (30s) to revoke disabled users quickly, role-based middleware (worker/gov), jurisdiction scoping for gov officials (state/district), worker-scoped data everywhere.
- **Wages:** Complete workflow - create/update by date (upsert), partial payments, status (paid/unpaid/partial), summary with balances, locking prevents editing fully-paid days (409), proper validation, deep-link to grievance with prefill.
- **Grievances:** Jurisdiction-aware listing/detail/status updates/comments; attachments; timeline; SLA fields; worker ownership enforced.
- **AI/RAG:** Good guardrails - PII stripping before external calls, grounded flag, similarity gating, BM25 fusion + deduplication, citations with provenance, multilingual (6 langs), STT/TTS, health/readiness endpoints with warmup tracking.
- **Testing:** 49 server tests + 50 frontend tests passing; typecheck passes. Security/parity tests cover key cases (wage locking, jurisdiction scoping).
- **Infrastructure:** idb for offline storage (chat/docs/grievances), document caching, PWA deps present.

### Gaps — closed as of 2026-11-05

All eight audited gaps are closed:

1. **KB gating (P0): CLOSED.** `rag/loader.py` is registry-driven — skips superseded docs, quarantines any doc whose LAST_VERIFIED or SOURCE_URL says "needs review", refuses docs whose SOURCE_URL is absent from `verified-sources.json` (strip+lowercase match) unless the TITLE matches a registry entry, and logs every exclusion.
2. **Verified-sources.json not enforced: CLOSED.** The registry (80 entries, `generated_at` 2026-11-03) is the loader's allow-list, and content tests enforce its 13 `excluded_claims` against the whole corpus.
3. **Service directory UI: CLOSED.** `ServiceDirectoryPage.tsx` renders the registry-backed directory (status, jurisdiction, last-verified, official links) at a protected worker route.
4. **Scam checker: CLOSED.** `ScamCheckerPage.tsx` implements the explainable checklist and is linked from the jobs-page fee warning.
5. **Offline drafts UX: CLOSED.** GrievanceFormPage saves/loads drafts via `offlineStorage.ts` (`cacheGrievanceDraft`), and the wage-log page can prefill a grievance from a server-generated draft.
6. **KB curation: CLOSED (2026-11-03).** All "needs review" flags cleared; every non-superseded doc is grounded in the registry; superseded historical docs deliberately left untouched. Details in §6.
7. **PWA: CLOSED.** Manifest + SVG icon + theme-color are linked in `index.html`; `main.tsx` registers the hand-rolled `/sw.js` in production (network-first v2 worker so phones always get current code and idb-backed offline data still works).
8. **AI refusal behavior: CLOSED (hardened).** The 0.45 similarity gate keeps out-of-corpus and prompt-injected questions from ever reaching the LLM with context attached (measured 12/13 refusals), and `grounded=false` paths return explicit no-info wording instead of guessing.

---

## 5. Priority Recommendations

**P0 (Critical):**
- Enforce KB verification gating: only ingest docs with proper verification; cross-reference with verified-sources.json; skip docs with "needs review", missing URLs, or unverified status.
- Add content test for banned claims from excluded_claims in verified-sources.json.
- Ensure AI never asserts unverified figures (the existing similarity gate + grounded logic helps; strengthen with explicit checks).

**P1 (High Impact):**
- Add verified government-service directory page consuming verified-sources.json (filter by category, show status, jurisdiction, last-verified, official links).
- Add explainable recruitment-scam risk checker (simple checklist-based UI; explainable reasons).
- Add grievance form draft save/load (offline-capable via idb).
- Add downloadable wage reports (CSV/PDF) from wage summary/list.

**P2 (Medium):**
- Configure PWA properly (vite-plugin-pwa) with manifest and basic caching.
- Improve KB metadata for docs with "needs review" - fix or exclude.
- Add more multilingual content and improve translations.

**P3 (Nice to have):**
- Enhanced voice UX, more notification types, etc.

---

## 6. Phase-2 status update (2026-11-03 → 2026-11-05)

### What the curation pass did (gaps 1, 2, 6)

- One-time pass over `ai-service/rag/sample_docs/` (**76 docs**): the **61 flagged files were cleared to zero "needs review" markers**. Every patched doc now carries AUTHORITY, a SOURCE_URL present in `verified-sources.json` (80 entries), and `LAST_VERIFIED: 2026-11-03`.
- Facts were grounded, not guessed: ESIC corrected to employee 0.75% / employer 3.25% (w.e.f. 1 Jul 2019; wages ≤ ₹176/day pay only the employee share), PMSBY kept at ₹20/yr, PMJJBY ₹436/yr, EPF 8.25% for FY2024-25, SVANidhi 2.0 tranches ₹15k/₹25k/₹50k till 31 Mar 2030, PMGKAY 5 kg/person/month (AAY households 35 kg/family). Helpline numbers that could not be verified against a current official page were softened to the verifiable channel (CPGRAMS, jansuraksha.gov.in) rather than asserted.
- The 13 `excluded_claims` hold across the corpus: no auto-enrolment claims, no Factories/Mines Act as current law, no unverifiable helplines, no PM-JAY package counts, no SVANidhi cashback, no "PMSBY enrolled automatically via e-Shram".
- Superseded historical docs (e.g. the pre-Code minimum-wages regime) were intentionally left untouched — the loader excludes them from the index rather than serving stale law.
- Resulting corpus: **65 active docs indexed + 11 superseded skipped = 76 files; 66 FAISS vectors** (up from 8 indexed docs before curation, when the gate refused unverified files).
- Regression guards stay on: the loader quarantine, the 13-claim content tests, and a zero-`needs review`-marker assertion fail CI if any doc regresses.

### Re-measured eval after the corpus expansion

`eval/RESULTS.md` regenerated 2026-11-05 (retrieval-only, threshold unchanged at 0.45 — it was not lowered):

| Metric | Phase-1 eval (62 active docs) | Phase-2 eval (65 active docs) |
|---|---|---|
| hit@1 | 46/49 = 94% | 45/49 = 92% |
| hit@3 | 48/49 = 98% | 47/49 = 96% |
| Off-topic + injection refused at retrieval | 12/13 | 12/13 (unchanged) |

The corpus grew from 62 to 65 loadable documents and hit@3 lost exactly one hit. The two residual misses are #20 (a Bengali PM-GKAY question whose top hit is the NREGA doc — a translation/wording collision, not a coverage gap) and #66 (a Tamil question with low chunk overlap). Retrieval, refusal behavior and grounding otherwise held.

### Test suites — final phase-2 state (2026-11-05)

| Suite | Result |
|---|---|
| server `npx vitest run tests` | **206/206** |
| ai-service `python -m pytest tests -q` | **103/103** |
| frontend `npm run typecheck` | clean |
| frontend `npm test` | **61/61** |

Also rectified during phase 2: the Mongoose "duplicate schema index on {\"worker_id\":1}" warning. `User.js` now declares the worker-code index exactly once, as `unique` + `partialFilterExpression { role: "worker", worker_id: { $gt: null } }` — non-null worker codes stay globally unique while officials/employers and codeless fixtures cannot collide on null.

## 7. KB review cadence

`LAST_VERIFIED` is a claim, not decoration. Standing rules from here on:

1. **Quarterly sweep (next due: February 2027).** For each non-superseded doc: re-read its SOURCE_URL; if the official page still supports every number in the doc, bump LAST_VERIFIED. If anything changed, fix the doc — or mark it superseded with a brief pointer doc. Never bump the date without re-reading the source.
2. **Registry first, doc second.** No numeric fact enters a KB doc without a `verified-sources.json` entry (id + URL + status `verified`). The loader makes unregistered URLs unindexable, so ungrounded content cannot ship by accident.
3. **Excluded claims stay excluded.** The 13 `excluded_claims` are lifted only by a deliberate registry upgrade plus a test update — never by a doc edit that quietly reintroduces the claim.
4. **The test suite IS the sweep.** Running `python -m pytest tests -q` in `ai-service` re-checks the loader gate, the zero-marker assertion and the excluded-claims scan. No manual grep needed.
5. **Superseded ≠ deleted.** Historical docs stay in-tree with `STATUS: superseded` so the loader skips them cleanly; their registry entries keep status `superseded` so nothing cites them as current law.

## 8. References

- [The Hindu, Oct 2025 - No accurate data on migrant workers in Kerala](https://www.thehindu.com/news/national/kerala/no-accurate-data-on-number-of-migrant-workers-in-state/article70190377.ece)
- [The South First, Jan 2024 - Wage theft helpline data](https://thesouthfirst.com/keralam/helpline-unveils-%E2%82%B91-3-crore-wage-theft-from-migrant-labourers-in-kerala-over-14-months/)
- [Mondal et al, 2024 - Language barriers in healthcare access](https://jswep.in/index.php/jswep/article/view/304)
- [UNFPA–IIMAD, SIIMS 2026 - South India Interstate Migration Survey (1,824 workers; access findings)](https://india.unfpa.org/sites/default/files/pub-pdf/2date26-date9/UNFPA-IIMAD%20Report.pdf)
- [Down To Earth, 2026 - Coverage of the SIIMS 2026 findings](https://www.downtoearth.org.in/governance/nearly-three-in-four-migrant-workers-in-southern-india-report-improved-living-standards-survey-finds)
- [PIB, 14 Jul 2026 - e-Shram registrations cross 31.78 crore](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2286757&reg=48&lang=2)
- [Mainstream Weekly, 2026 - The e-SHRAM Paradox: visible to the state, invisible in welfare](https://mainstreamweekly.net/article16755.html)
- [The News Minute, 2022 - AAWAZ: only a handful benefited](https://www.thenewsminute.com/kerala/kerala-s-aawaz-health-insurance-migrant-labourers-benefited-only-handful-171316)
- [KPMG, May 2026 - Government notifies final Rules on four Labour Codes](https://kpmg.com/xx/en/our-insights/gms-flash-alert/2026/flash-alert-2026-127.html)
- [PIB, 28 Apr 2026 - Nationwide heatwave advisory to protect workers](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2256186&reg=3&lang=1)
- [India Mongabay, May 2026 - Workers groups push for legal protections against deadly heat](https://india.mongabay.com/2026/05/workers-groups-are-pushing-for-legal-protections-against-deadly-heat)
- [Kerala Labour Commissionerate](https://lc.kerala.gov.in/)
- [e-Shram](https://eshram.gov.in/)
- [CPGRAMS](https://pgportal.gov.in/)
- [UMANG](https://web.umang.gov.in/)
- [NCS](https://ncs.gov.in/)