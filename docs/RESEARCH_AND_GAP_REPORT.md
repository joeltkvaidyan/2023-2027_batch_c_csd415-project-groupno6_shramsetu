# ShramSetu — Research and Gap Report

**Date:** 2026-10-19  
**Status:** Grounded in actual codebase audit (commit d7ae8d8) + current official research

---

## 1. Executive Summary

ShramSetu is a functional multi-component platform (React/TS frontend, Node/Express backend, FastAPI AI service with RAG/FAISS) with good security foundations (document encryption with key wrapping, content-based validation, jurisdiction scoping, wage locking, audit logging). However, several gaps remain relative to the goal of being a secure, reliable multilingual platform for interstate migrant workers in Kerala:

- **KB verification gap (P0):** Many KB docs have "needs review" in metadata; ingestion doesn't enforce "verified only" from `verified-sources.json`. Need strict gating.
- **Missing UI features:** No verified government-service directory page or recruitment-scam risk checker UI exposed, despite data existing in docs.
- **Offline drafts:** Offline storage infrastructure exists (idb) but explicit "offline drafts" UI/workflows not visible; PWA plugin installed but not configured.
- **KB corpus quality:** 48 docs have "needs review" for LAST_VERIFIED; some missing source URLs. Need curation.

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

### Gaps
1. **KB gating (P0):** `rag/loader.py` skips only `status == "superseded"`, defaults to "active" otherwise. Many docs have "needs review" in metadata; not cross-referenced with `verified-sources.json`. Need strict verification gate.
2. **Verified-sources.json not enforced:** Present in docs but not used by ingestion/RAG - needs integration.
3. **Service directory UI missing:** `verified-sources.json` contains 44 verified service entries but no frontend page to display them as a user-facing directory with status/jurisdiction/last-verified.
4. **Scam checker missing:** No explainable recruitment-scam risk checker UI/logic despite being requested as high-impact feature.
5. **Offline drafts UX:** Offline storage exists but no explicit "save draft offline" flows visible in UI (e.g. grievance form drafts). Need to add.
6. **KB curation:** 48 docs have "needs review" for LAST_VERIFIED; some have "needs review" for SOURCE_URL. Need to either fix or exclude.
7. **PWA not configured:** vite-plugin-pwa installed but not added to vite.config.ts plugins; no manifest/workbox config visible.
8. **AI refusal behavior:** Generally good (grounded=false returns no-info), but could be strengthened to explicitly refuse unverified claims.

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

## 6. References

- [The Hindu, Oct 2025 - No accurate data on migrant workers in Kerala](https://www.thehindu.com/news/national/kerala/no-accurate-data-on-number-of-migrant-workers-in-state/article70190377.ece)
- [The South First, Jan 2024 - Wage theft helpline data](https://thesouthfirst.com/keralam/helpline-unveils-%E2%82%B91-3-crore-wage-theft-from-migrant-labourers-in-kerala-over-14-months/)
- [Mondal et al, 2024 - Language barriers in healthcare access](https://jswep.in/index.php/jswep/article/view/304)
- [Kerala Labour Commissionerate](https://lc.kerala.gov.in/)
- [e-Shram](https://eshram.gov.in/)
- [CPGRAMS](https://pgportal.gov.in/)
- [UMANG](https://web.umang.gov.in/)
- [NCS](https://ncs.gov.in/)