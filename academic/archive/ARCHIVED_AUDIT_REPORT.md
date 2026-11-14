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

# ShramSetu — Phase 1 Audit Report

**Date:** 2026-09-12 · **Scope:** backend, frontend, mobile, RAG, infra, CI, tests, env files
**Baseline test run:** `46 passed / 2 failed` (failures are real config drift, see CRIT-8)
**No code was modified during this audit.**

Priorities: **CRITICAL** = exploitable or breaks core flows today · **HIGH** = must fix before demo/deploy · **MEDIUM** = quality/correctness debt · **LOW** = polish.

---

## CRITICAL

### C-1. Live-looking Groq API key committed to the repository
- **Problem:** Both `.env.example` (root) and `backend/.env.example` contain a real-format Groq API key (`gsk_…`).
- **Why it matters:** `.env.example` files are conventionally committed; anyone cloning the repo gets the key. This is a leaked credential and violates the project's own "never commit secrets" rule. Billing/quota abuse risk.
- **Current implementation:** Placeholder files contain actual key material instead of `your-groq-api-key-here`.
- **Fix:** Revoke/rotate the key in the Groq console **now**; replace values in both `.env.example` files with obvious placeholders; add a pre-commit secret scan (e.g., `gitleaks`) in CI; verify git history and consider a history scrub before any public push.
- **Files:** `shramsetu/.env.example`, `shramsetu/backend/.env.example`, `.github/workflows/ci.yml`

### C-2. Hardcoded dev OTP `123456` wired into **government** login
- **Problem:** `backend/app/api/v1/auth.py` (lines ~142–179) accepts fixed OTP `123456` on `/auth/otp-login` when `DEBUG`-mode flags are on, for *government* login, and auto-creates a government user with a **hardcoded password** (`gov123`) and `role=WORKER` (role mismatch).
- **Why it matters:** A single forgotten `DEBUG=True` in a deployed container hands anyone who knows any mobile number a working account. The project brief explicitly forbids a hardcoded production OTP.
- **Fix:** Delete the fixed-code path from production code entirely. Move dev OTP behind a *development-only provider* (`settings.environment == "development"` + explicitly selected `DevOtpProvider` that logs to console only); production wires a real provider (or a documented configurable one) and **refuses to start** if only the dev provider is configured. Government login must go through the normal government-user flow with proper roles.
- **Files:** `backend/app/api/v1/auth.py`, `backend/app/services/otp_service.py`, `backend/app/core/config.py`

### C-3. Dev OTP `123456` is advertised in shipped UI text (all locales + mobile)
- **Problem:** `frontend/src/pages/WorkerLoginPage.tsx` (fallback `otpVal || "123456"` and a visible "devModeHint"), all six i18n locale files (`otpPlaceholder: "…(dev: 123456)"`), and `mobile/src/screens/LoginScreen.tsx` ("Developer mode: enter 123456…") ship the bypass code to end users.
- **Why it matters:** The demo credential is baked into the UI a viva examiner will open — it looks like a backdoor even if backend gating were correct, and the client-side fallback can mask real OTP failures.
- **Fix:** Gate hints on an explicit "dev mode" flag delivered by the backend (or build-time env), never hardcode in locale strings; remove the `|| "123456"` fallback.
- **Files:** `frontend/src/pages/WorkerLoginPage.tsx`, `frontend/src/i18n/locales/*.json` (6 files), `mobile/src/screens/LoginScreen.tsx`

### C-4. CORS: `allow_origins=["*"]` together with `allow_credentials=True`
- **Problem:** `backend/app/main.py` configures wildcard origins with credentials.
- **Why it matters:** This combination is rejected by browsers per spec (credentials + wildcard are mutually exclusive), so it either silently breaks credentialed requests or, when relaxed, permits any origin. Either way it is wrong and unsafe.
- **Fix:** Environment-configured origin list (`CORS_ORIGINS`), split and validated at startup; fail fast in production if empty. Keep `allow_credentials=True` only for the explicit list.
- **Files:** `backend/app/main.py`, `backend/app/core/config.py`, `.env.example`

### C-5. Security middleware exists but is never wired; rate limiting is dead code
- **Problem:** `backend/app/core/security_middleware.py` (headers, request ID, size limits, rate limiting) is not added to the FastAPI app; `main.py` defines a limiter but never enforces it on any route/middleware.
- **Why it matters:** The project *appears* to have rate limiting and security headers but has none at runtime — a misleading "production-ready" claim. Login/OTP endpoints are open to brute force.
- **Fix:** Wire the middleware into `app` (correct order: request-ID → size limit → headers), enforce limits on `/auth/*`, `/documents/*`, and chat endpoints. Use Redis-backed storage when `REDIS_URL` is set (multi-instance safe), in-memory only for dev/tests.
- **Files:** `backend/app/main.py`, `backend/app/core/security_middleware.py`

### C-6. Government portal is unusable out of the box — seeding is claimed but not implemented
- **Problem:** `main.py` lifespan comments say "Seed default government admin" but the code does nothing; meanwhile `frontend/src/pages/GovernmentLoginPage.tsx` advertises `GOV-ADMIN-001 / Admin@12345`, which does not exist. Creating gov users requires an existing superadmin → chicken-and-egg.
- **Why it matters:** Core demo flow (government dashboard) fails on a fresh install; the advertised credential is misleading documentation.
- **Fix:** Implement an idempotent, explicitly-enabled bootstrap (`BOOTSTRAP_ADMIN_*` env, dev-only default), create the superadmin with a hashed password from env, and document it in README; make the frontend hint match reality.
- **Files:** `backend/app/main.py`, `backend/app/api/v1/government_auth.py`, `frontend/src/pages/GovernmentLoginPage.tsx`, README

### C-7. Alembic migration is stale vs. models — fresh deploys are broken
- **Problem:** `backend/alembic/versions/2ba85729621f_initial_schema.py` is missing tables `governmentuser`, `auditlog`, `pushnotification`, `workernotification`, `grievancecomment` and newer grievance columns; `entrypoint.sh` runs `alembic upgrade head` — so a fresh container starts with a schema the code expects but the DB doesn't have (or relies on silent `create_all`).
- **Why it matters:** Both project rules — "use Alembic consistently" and "do not silently create production schemas" — are violated; Docker demo can crash on first query.
- **Fix:** Generate an autogenerate migration against the current models; make startup fail loudly if models and DB diverge in production (no silent `create_all`).
- **Files:** `backend/alembic/versions/*`, `backend/entrypoint.sh`, `backend/app/db/session.py`

### C-8. Config drift already failing tests: `OTP_RESEND_COOLDOWN_SECONDS` undefined
- **Problem:** Code/settings reference `OTP_RESEND_COOLDOWN_SECONDS` but it's never defined; baseline test run: `46 passed, 2 failed` for exactly this reason.
- **Why it matters:** Confirms settings are drifting from code; today it's tests, tomorrow it's runtime `AttributeError` in the OTP path.
- **Fix:** Add the setting (with sane default + validation), and add a startup test that constructs `Settings` for each environment.
- **Files:** `backend/app/core/config.py`, `backend/tests/test_otp.py`

---

## HIGH

### H-1. Mobile-number normalization is broken (JS regex in Python)
- **Problem:** `mobile.replace("\D", "")` — `"\D"` is the string `D` (escaped `D` is just `D`), and Python's `str.replace` is not regex. This silently does nothing.
- **Why it matters:** Numbers like `+91 98765 43210` won't be normalized → duplicate accounts, failed lookups, OTP sent to malformed numbers.
- **Fix:** `re.sub(r"\D", "", mobile)` (or `phonenumbers` lib), applied consistently at schema-validation layer, and a regression test with `+91 `-formatted inputs.
- **Files:** wherever normalization occurs (auth flow, schemas)

### H-2. Government users' role/scope not enforced at the endpoint layer
- **Problem:** Government endpoints (`/government/workers`, `/grievances`, `/notifications`, `/audit-logs`) rely on "is authenticated as gov user" without consistent department/state/district scope checks; the multi-role model (STATE_ADMIN, DISTRICT_OFFICER, …) exists in models but is not consistently applied.
- **Why it matters:** Any gov user can potentially enumerate worker data beyond their jurisdiction — the core of the RBAC requirement.
- **Fix:** Central `require_scoped_gov_user(department, state, district)` dependency; filter every gov query by scope; add explicit IDOR tests (worker A's doc/grievance not readable by worker B or out-of-scope officer).
- **Files:** `backend/app/api/v1/government.py`, `backend/app/api/deps.py`, `backend/app/services/government_auth_service.py`

### H-3. Aadhaar: plaintext storage / unmasked serialization risk
- **Problem:** Encryption module exists (`core/encryption.py`) but Aadhaar handling is inconsistent across schemas/models — full values can reach API responses and audit entries.
- **Why it matters:** Highest-sensitivity PII in the system; a serialization slip leaks it. The brief mandates field-level encryption and `XXXX XXXX 1234` masking only.
- **Fix:** Encrypt-at-rest for the raw column, expose only masked value in **all** response schemas, deny-list Aadhaar from log scrubbers, and add tests asserting no response contains a full Aadhaar.
- **Files:** `backend/app/schemas/*.py`, `backend/app/models/user.py`, `backend/app/services/audit_service.py`

### H-4. Document download authorization must be proven IDOR-proof
- **Problem:** Document endpoints must guarantee ownership/scope checks; tests for cross-worker download attempts are missing.
- **Fix:** Enforce owner-or-scoped-officer checks in `document_service`/storage layer; return generic 404 (not 403) for foreign IDs to avoid enumeration; short-lived signed URLs; add explicit tests: worker B requesting worker A's doc → 404.
- **Files:** `backend/app/api/v1/documents.py`, `backend/app/services/document_service.py`, `backend/tests/test_documents.py`

### H-5. Fake authority contact in grievance routing
- **Problem:** Grievance forwarding references `labour-dept@example.gov.in`-style placeholder as if real.
- **Why it matters:** The UI/reporting can claim a complaint was "forwarded" when nothing was sent — precisely the misleading behavior the brief forbids.
- **Fix:** Configurable authority directory per department/state/district; notification status enum `SENT | FAILED | QUEUED | NOT_CONFIGURED`; never render "sent" unless a provider actually accepted it.
- **Files:** `backend/app/services/grievance_service.py`, `backend/app/services/notification_service.py`, `backend/app/api/v1/grievances.py`

### H-6. RAG confidence number is presented as meaningful
- **Problem:** Chat answers carry a confidence figure that isn't derived from anything statistically grounded (retrieval similarity ≠ answer confidence).
- **Why it matters:** Misleading claim, and viva examiners will probe it.
- **Fix:** Rename/report retrieval similarity honestly; compute an explicit groundedness signal (e.g., citation overlap between answer and retrieved chunks) with a clearly documented heuristic; always return sources (doc, department, date, verified date, section).
- **Files:** `backend/app/services/rag_service.py`, `backend/app/api/v1/chat.py`, `backend/app/schemas/chat.py`

### H-7. Notification failures are swallowed
- **Problem:** Notification service logs-and-continues without delivery status, retries, or idempotency keys.
- **Fix:** Persist delivery status + attempt count, bounded retry with backoff, idempotency key per (recipient, event), history endpoint for the worker.
- **Files:** `backend/app/services/notification_service.py`, `backend/app/models/notification.py`

### H-8. Frontend/mobile dev-mode hints and dead status values
- **Problem:** Mobile nav and web reference status values (e.g., `ESCALATED`) that the backend workflow doesn't define; combined with C-3, UI drift from backend reality.
- **Fix:** Single source of truth: backend serves the status enum (OpenAPI), frontend/mobile derive badges from it; remove local enums.
- **Files:** `mobile/src/navigation/RootNavigator.tsx`, `frontend/src/components/GrievanceStatusBadge.tsx`, backend grievance schemas

---

## MEDIUM

- **M-1. Pagination:** some list endpoints derive totals from the returned page instead of `COUNT(*)` (test_pagination exists — verify and fix remaining endpoints). Files: repositories.
- **M-2. Missing indexes:** mobile_number (users), owner/status/category/created_at (grievances), owner (documents), target (notifications). Add via the new Alembic migration (pairs with C-7).
- **M-3. Duplication:** authentication/OTP logic duplicated across worker vs. government flows; consolidate into `auth_service` with role-aware policies.
- **M-4. Error handling:** ad-hoc `HTTPException` details across endpoints; need the structured `{error:{code,message,request_id}}` envelope + global handler that never leaks stack traces/SQL.
- **M-5. Observability:** no request-ID middleware in the live app (see C-5), no structured logs, no `/health/live` vs `/health/ready` separation (readiness should check DB, storage, RAG index, AI provider).
- **M-6. Frontend quality gaps:** inconsistent loading/empty/error states across pages; reusable Modal/Confirm/EmptyState/Table components missing; duplicated API logic between `client.ts` and `governmentClient.ts`.
- **M-7. Web/mobile inconsistency:** chatbot, notifications, and voice behave differently between platforms (web has push hooks; mobile notification handling diverges).
- **M-8. CI gaps:** ci.yml runs tests but not lint/format/typecheck for backend, no frontend/mobile typecheck gates, no dependency audit; also no secret scanning (ties to C-1).
- **M-9. RAG pipeline gaps:** no duplicate-chunk suppression, weak threshold tuning, no rerank step, no explicit "verified information unavailable" path tests.
- **M-10. Document versioning:** knowledge-base docs lack version/hash/last-verified metadata; no re-index flow when official documents update.

## LOW

- **L-1.** `README` / `IMPLEMENTATION_GUIDE.md` / `CHANGELOG_REMEDIATION.md` overstate production readiness; align claims with reality.
- **L-2.** Dead code and unused imports in backend services; obsolete comments contradicting behavior (e.g., the seeding comment in C-6).
- **L-3.** Accessibility polish on web (focus traps in modals, missing labels); keyboard navigation on tables.
- **L-4.** Inconsistent naming (`WorkerNotification` vs `PushNotification` models) — document intent or merge.
- **L-5.** Localized strings drift: same key missing or differing across the six locale files (verified for `otpPlaceholder` — will differ for others).

---

## Verified-working strengths (preserve these)

- Structured layered backend (api/services/repositories/models) — good architecture, keep it.
- 46 passing tests already cover auth, OTP, documents, grievances, pagination, startup checks.
- Mobile already uses `expo-secure-store` via `secureStorage.ts` (do **not** regress to AsyncStorage).
- `.gitignore` correctly excludes real `.env` files; the leak is only in `.env.example` (C-1).
- Multilingual i18n infra (6 locales) present on both web and mobile.

## Suggested fix order

1. **C-1** rotate key + scrub examples (immediate, independent)
2. **C-2/C-3** dev-OTP removal + provider interface (auth correctness)
3. **C-4/C-5** wire middleware, fix CORS, enforce rate limits
4. **C-8** config drift, then **C-7** regenerate migration
5. **C-6** bootstrap admin seeding
6. **H-1..H-8** in order, then MEDIUM batch, CI last so it gates everything.
