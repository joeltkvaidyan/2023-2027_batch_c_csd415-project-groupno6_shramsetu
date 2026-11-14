> # ⛔ ARCHIVED — NOT A DESCRIPTION OF THE CURRENT SYSTEM
>
> **This document describes a version of ShramSetu that no longer exists** (built
> on FastAPI + SQLModel/SQLite). The project now runs on **Node.js/Express +
> MongoDB**, with a separate Python/FastAPI **AI service** for RAG only.
>
> Every specific claim below is stale on purpose: file paths, test counts, ports,
> commands and credential examples. Several of the problems it reports have since
> been fixed. Reading this as a statement of the present would be wrong.
>
> For the current system see [README.md](../README.md),
> [ARCHITECTURE.md](../ARCHITECTURE.md) and [SECURITY.md](../SECURITY.md).
> To be explicit: everything after this line is history.

# ShramSetu — Final Remediation Report

Status after remediation: **99 backend tests passing, frontend builds clean, mobile typechecks clean, migrations round-trip verified.**

---

## 1. PROJECT HEALTH SCORE

| Area | Score | Notes |
|---|---|---|
| Architecture | 8.5/10 | Clean FastAPI + service/repository layering, storage abstraction, scope enforcement centralized in one module |
| Security | 8/10 | All critical holes closed (dev-OTP backdoors, worker-token government endpoints, IDOR, wildcard CORS, leaked API key); limits documented |
| Backend | 8.5/10 | Validated schemas, honest error handling, request IDs, real pagination totals, wired middleware |
| Frontend | 7.5/10 | Builds clean, i18n complete for new flows; deep component-reuse refactor not done (out of scope) |
| Mobile | 7.5/10 | Typechecks clean now (it previously could not compile at all — see changes); SecureStore already used for tokens |
| AI/RAG | 8/10 | Multilingual retrieval + dedupe + rerank + citations + honest no-info behavior; confidence explicitly labeled as retrieval similarity, not answer probability |
| Database | 8/10 | Real COUNT(*) pagination, new indexes, migrations aligned with models and CI-verified; SQLite in dev, Postgres in compose |
| Testing | 8/10 | 99 tests across auth, OTP, RBAC, documents/IDOR, grievances, notifications, pagination, startup checks |
| UX | 7/10 | Real OTP login flow on web + mobile now; visual design untouched by request |
| Scalability | 7/10 | Redis-backed rate limiting optional, stateless JWT, storage abstraction; single-DB write path remains |
| **Overall final-year project quality** | **8/10 — Strong final-year project** | Technically substantive and now honest about its limits |

## 2. CHANGES MADE (summary — file → problem → fix → why better)

**Backend — critical security**
- `app/api/v1/grievances.py` — legacy `/grievances/government/*` endpoints accepted **worker** JWTs and exposed/let workers mutate every grievance → removed dead+dangerous block; the real, jurisdiction-scoped surface is `government.py`.
- `app/api/v1/notifications.py` — rewritten: DB-backed device tokens (`models/push_token.py`, migration included), `/send` now requires a **government** JWT (was worker-accessible → push spam), honest `not_configured` status instead of fake success. Router was also never registered in `main.py` (the web app's register/unregister calls were 404ing) → wired in.
- `app/api/v1/government.py` — status updates now enforce the transition matrix (no more resolved→submitted), priority changes validated, illegal moves are 400s; audit details use real old/new status.
- `app/main.py` — global exception handler returns `{detail, request_id}` (no stack traces/SQL to clients).

**Backend — Phase 5 document security**
- `app/services/file_validation.py` (new) — magic-byte signature validation (PDF/JPEG/PNG/WEBP) + size cap + extension gate in one reusable function.
- `app/services/document_service.py`, `grievance_service.py`, `api/v1/auth.py` (profile photo) — all uploads pass through it (previously extension-only).
- `api/v1/documents.py`, `api/v1/grievances.py` — document/attachment downloads now write audit-log entries.

**Backend — Phase 8 database**
- `models/grievance.py` — duplicate `GrievancePriority` class and duplicate `priority` column removed (second definition silently shadowed the first); `created_at` indexed; stale docstring corrected.
- `models/user.py` — indexes on `current_state`, `current_district`, `occupation` (jurisdiction filters scan these); Aadhaar comment now describes the real encryption behavior.
- `models/notification.py` — composite indexes for the worker inbox/unread queries.
- `alembic/versions/61ecf258eaef_*.py` (new) — aligns schema with models: `governmentuser`, `auditlog`, `pushnotification`, `workernotification`, `grievancecomment` tables, SLA columns, indexes; `alembic/env.py` now imports all models (autogenerate missed tables).
- `alembic/versions/61cc62edf0a9_*.py` (new) — `devicepushtoken` table.
- `app/db/session.py`, `main.py` — `init_db` imports every model so SQLite dev bootstraps completely.

**Backend — Phase 9/10 RAG**
- `app/services/rag_service.py` — near-duplicate chunk dedupe (overlapping chunks no longer waste prompt slots), light lexical-overlap reranking, `sources[]` citations (title/department/authority/version/last_verified/similarity), `confidence_basis: "retrieval_similarity"` so the score can never be mistaken for answer probability.
- `rag/loader.py` — full provenance headers (AUTHORITY, SOURCE_URL, VERSION, PUBLISHED_DATE, EFFECTIVE_DATE, LAST_VERIFIED, STATUS); `STATUS: superseded` documents are skipped on rebuild.
- `rag/ingest.py` — content hash per document in chunk metadata.
- `schemas/chat.py` — response carries `sources` + `confidence_basis`.

**Backend — Phase 11/12 workflow & notifications**
- `services/grievance_service.py` — `VALID_STATUS_TRANSITIONS` state machine; `notify_authorities` returns `(notified, failed)`; failed forwarding now writes an honest timeline entry instead of silence.
- `services/notification_service.py` — unconfigured mailbox / failed SMTP send reported as failed, never as forwarded.
- `schemas/grievance.py` — `user_id` optional on comments (government comments have no user row — previously **500'd the worker's detail view** as soon as an officer commented); `is_internal` exposed.
- Worker grievance detail strips `is_internal` comments.

**Frontend/Mobile**
- (Earlier in this remediation) real OTP request→verify login on web + mobile, `verifyButton`/`otpSentNotice` keys in all 6 locales, dead legacy screens deleted, `mobile/App.tsx` comment-termination bug fixed (mobile could never have compiled).
- Verified this session: `npm run build` ✓, `tsc --noEmit` ✓.

**CI/CD (`.github/workflows/ci.yml`)**
- Full `pip install -r requirements.txt` (was a hand-picked subset), full test suite, syntax compile check, frontend typecheck+build, mobile typecheck (with documented `--legacy-peer-deps`), **migration round-trip + `alembic check` drift gate**, pip-audit + npm-audit.

## 3. REMAINING LIMITATIONS (honest)

**Technical**
- Chat history, audit writes, notification fan-out are synchronous; fine at project scale, not at thousands of concurrent users.
- FAISS index rebuilds lazily on first query when absent — first chat after cold start is slow.
- Uploads buffer in memory up to MAX_UPLOAD_MB per request (multipart spillover mitigates; streaming would be better).
- In-memory rate limiter is per-process unless `REDIS_URL` is set.

**AI**
- `confidence_score` is retrieval similarity, not answer correctness — now labeled as such but still not a calibrated probability.
- Sample-doc knowledge base (68 files) is static; quality depends entirely on what departments publish in `rag/sample_docs/`.
- No reranker model / no BM25 hybrid — the lexical signal is intentionally tiny and cheap.

**Security**
- JWTs are stateless — no server-side revocation/denylist; logout is client-side.
- No UIDAI verification of Aadhaar (format validation + encryption at rest + masking only).
- Groq/FCM/SMTP are trusted third parties in the data path.

**Deployment / data / legal**
- Single-Postgres write path; no read replicas or horizontal DB scaling.
- OTP delivery requires real SMS credentials (Fast2SMS) in any real rollout; console provider is dev-only and production-refused.
- DPDP Act compliance needs DPIA, retention policy, and consent flows beyond this codebase.
- Authority emails are placeholders (`example.gov.in`) by design until real contacts exist.

## 4. VIVA EXPLANATIONS (one-liners)

- **FastAPI** — async performance + automatic OpenAPI docs + Pydantic validation at the boundary.
- **React** — component model + TS types + huge ecosystem for the dashboard-heavy UI.
- **PostgreSQL** — ACID guarantees for money-adjacent grievance records; SQLite stays for zero-config dev.
- **JWT** — stateless auth that survives horizontal scaling; download tokens show scoped/short-lived variants.
- **OTP** — proves phone ownership without password memorization for low-literacy users.
- **RAG** — grounds the LLM in verified government documents; answers cite sources or refuse.
- **FAISS** — fast local vector search over multilingual embeddings; swappable behind one function.
- **Sentence Transformers (multilingual MiniLM)** — one embedding space across 6 Indian languages so a Hindi question retrieves the English circular.
- **Groq** — free-tier fast LLM inference for a student budget.
- **RBAC** — jurisdiction-scoped so a Bihar officer cannot read Karnataka grievances; enforced server-side, fail-closed.
- **Field-level encryption** — Aadhaar is Fernet-encrypted at rest, masked in every API response, never logged.
- **Audit logging** — every sensitive action attributable (who/what/when/IP) — required for a government-facing system.
- **Hallucination prevention** — retrieval threshold + grounded=false contract + refusal text in 6 languages; the model may only use provided context.
- **If no answer** — the bot says verified information is unavailable and points to CSC/14434 helpline instead of guessing.
- **If documents become outdated** — mark old file `STATUS: superseded`, drop in the new one, rebuild; metadata carries version/last-verified.

## 5. FINAL RECOMMENDATION

**C — Strong final-year project.**

It is not "excellent" (D) because real-world hardening (SMS provider contract, DPDP compliance review, load testing, calibrated confidence, server-side revocation) remains demo-grade. It is far beyond "good" (B) because the security architecture is real and tested — jurisdiction-scoped RBAC with fail-closed defaults, IDOR-proof resource access, encrypted PII, an enforced workflow state machine, and a CI gate that fails on schema drift. Every claim in the README can now be demonstrated live in a viva, and every limitation above can be honestly stated when asked.
