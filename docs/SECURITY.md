# ShramSetu — Security Notes (threat model & honest limitations)

Final-year project scope, stated plainly: what is enforced, what is not.

## Assets and who might attack them

| Asset | Threat actor | Main risk |
|---|---|---|
| Worker PII (mobile, Aadhaar-adjacent data, documents) | outsiders, insiders with DB access | identity theft, surveillance of migrants |
| Document wallet files | server compromise, DB dump theft | decryption without the master key |
| Worker sessions | token theft | account takeover |
| Government data boundaries | curious officials | cross-jurisdiction snooping |
| AI pipeline | prompt injection, PII leakage to third parties | manipulated answers, privacy loss |
| The service itself | scripted abuse | OTP spam, credential stuffing, DoS |

## Controls in place (with where to verify)

**Authentication & sessions**
- bcrypt password hashing.
- The browser holds **no token**. A sign-in sets three cookies: a 15-minute
  access JWT (`st_access`, httpOnly), a 30-day opaque refresh token
  (`st_refresh`, httpOnly, path-scoped to `/api/v1/auth`), and a readable CSRF
  value (`st_csrf`). Every unsafe cookie-authenticated request must echo the
  CSRF value in `X-CSRF-Token` (double submit), so a cross-site page cannot
  drive the API with the worker's session.
- Refresh tokens rotate on every use and only their SHA-256 is stored
  (`models/Session.js`). Presenting an already-rotated token revokes the whole
  chain — that is the signature of a copied cookie — and logout revokes
  server-side, so a stolen token dies with the session instead of living out a
  12-hour window. Bearer tokens still work for API clients and scripts; they
  are not exposed to a browser page and cannot be forged cross-site.
- OTPs: 6 digits, hashed at rest, expiring, resend cooldown, printed **only
  to the server terminal** in dev (`OTP_ECHO_ENABLED`); production boot
  refuses echo mode.
- Unverified accounts cannot password-login; re-registration of an
  unverified number re-sends the OTP and never overwrites a verified
  account.
- `authenticate` re-checks user existence + `is_active` per request via a
  30 s cache; disabled users lose access immediately (within TTL); DB
  failure during the check → **503, never fail-open**.

**Authorization**
- Fail-closed jurisdiction scoping for every government route
  (`server/src/utils/scope.js`): superadmin → all; state/district officials
  → their jurisdiction; **no jurisdiction → zero rows**.
- Object access returns **404** (not 403) so out-of-scope records are not
  discoverable. Notification targeting rejects `all`/out-of-scope with 403.
- Worker JWTs are rejected on every government route; workers can only read
  their own grievances/documents (ownership checks).
- Locked in by `server/tests/security.test.js` (40 tests).

**Data protection**
- Document wallet: AES-256-GCM per file; per-file keys wrapped under
  `DOC_MASTER_KEY` (32-byte base64, env-only; production refuses to boot
  without it) — `wrapped:v1:` format, migration script included.
- Uploads: in-memory handling, magic-byte validation (PDF/JPEG/PNG/WEBP) +
  size + extension checks, temp-file cleanup on every failure path,
  RFC 5987 download filenames.
- PII (10-digit mobiles, 12-digit Aadhaar-like numbers) is stripped from
  chat text **before** any external AI provider call
  (`ai-service/app/services/pii.py`), applied to both text chat and voice
  transcription flows.
- Duplicate records from retried submissions: grievance and wage writes accept a
  client `client_request_id` (or `Idempotency-Key` header), scoped per worker by
  a partial unique index, so a retry after a lost reply returns the record that
  already exists (200 + `Idempotent-Replay: true`) instead of filing a second
  complaint or tripping the paid-day lock. A malformed or absent key changes
  nothing — those requests behave exactly as before.

**Network & abuse**
- `helmet` security headers; CORS allowlist whenever `CORS_ORIGINS` is set.
- Rate limits: general API limiter plus strict per-route limiters (OTP
  request/verify, worker login, government login, register), env-tunable.
- AI service: requires `X-Internal-Key` (except the health paths `/health`,
  `/health/live` and `/health/ready` — a container probe has no way to present
  the Node server's key, and a readiness probe must never be the thing that
  fails), per-IP rate limit, request-size cap.

**Availability / operations**
- Liveness/readiness split on the AI service. `/health/live` is 200 whenever
  the process is up; `/health/ready` stays 503 until the required warm-up
  (embedding model + FAISS index) has finished. `start-all.ps1` waits on
  readiness and prints which model is still loading, so a restart no longer
  reports "ready" and then stalls the first question until the proxy aborts.
  Liveness deliberately does *not* track warm-up: restarting a warming service
  restarts the very load it was waiting on.
- Production boot guard (`server/src/config.js assertProductionSafe`):
  refuses default admin password, OTP echo, demo seeding, missing master
  key/JWT secret, in-memory Mongo.
- Bootstrap admin is create-only (password never reset on boot).
- Audit log for government actions and auth events (actor, IP, success).

## Known limitations (honest list)

1. **No real SMS.** OTP delivery is a terminal printer. Production needs a
   gateway integration.
2. **No HTTPS termination here.** TLS must be handled by a reverse proxy or
   load balancer.
3. **The document PIN is a server-side access control, and offline copies are
   encrypted with it.** The PIN digest (scrypt), attempt counter and
   five-minute lockout live on the user row, and `GET /documents/:id/download`
   refuses a request without a 10-minute wallet token once a PIN exists — so
   holding a stolen session is not enough to pull Aadhaar cards. Documents
   cached for offline viewing are AES-256-GCM encrypted with a key derived from
   the PIN (PBKDF2-SHA256, 310k iterations, device salt), so the IndexedDB
   contents are unreadable once the wallet locks, and the store is wiped on
   logout. What this does NOT do: it cannot stop someone who knows the PIN from
   reading a cached file, and it does not protect a document already opened in
   another tab's memory.
4. **Liveness cache window.** A deactivated user can keep working for up to
   30 s after deactivation (cache TTL); zero the TTL to trade performance
   for strictness.
5. **Single-node rate limiting.** Limits are in-process; a multi-node
   deployment needs a shared store (the AI service keeps a commented
   Redis hook).
6. **Chat attachments/voice rely on third-party AI providers** (Groq,
   Google) after PII stripping; workers consent explicitly at
   registration, but content is still processed outside the platform.
7. **Prompt-injection defence is layered but not absolute.** Retrieval-time
   injection questions are refused (measured 11/11 in the eval), and the
   system prompt carries no secrets, but generation-time hardening of a
   hosted LLM can never be guaranteed.
8. **Audit log is append-only within the app**, not tamper-evident (no
   hash chain / external sink).
9. **No backups/DR story** in this repository; a real deployment needs
   MongoDB backups and key-escrow procedures for `DOC_MASTER_KEY` (losing
   it makes every wallet file unrecoverable — by design).
10. **Eval coverage is retrieval-only** by default (no LLM key needed);
    generation-time grounding quality should be re-measured with `--full`
    when a key is available.
11. **Known npm advisories in the frontend are unfixed, deliberately.**
    `npm audit` (re-measured 2026-10-03) reports 7 findings in 2 advisory
    groups, none of them in shipped code:
    - **HIGH — `braces`** stack-exhaustion DoS. Reached through
      `tailwindcss@3` → `chokidar` → `braces`, and also through
      `fast-glob` → `micromatch`. Build-time glob expansion only;
      devDependency. The last 3.x release is **3.4.19** and the advisory
      range is `<=3.4.19`, so no in-major patch exists — the only fix is
      `tailwindcss@4`, a breaking major (new config model and plugin API)
      whose migration would land in the middle of a presentation build.
    - **MODERATE — `react-router-dom`** open redirect via a backslash in
      `<Link>`/`useNavigate`, plus an SSR-hydration constructor injection
      that does not apply to this client-only SPA. The advisory range is
      `6.0.0 - 7.17.0` and the last 6.x release is **6.30.6**, so again no
      in-major patch exists. The app uses only stable v6 APIs
      (`BrowserRouter`, `Routes`, `Route`, `Navigate`, `NavLink`,
      `useNavigate`, `useParams`, `useLocation` — no `Switch`, `Redirect` or
      `useHistory`), so a v7 upgrade is plausible; it is left as a scoped
      follow-up rather than smuggled into this phase.
    CI therefore gates on `npm audit --omit=dev --audit-level=high`
    (nothing high or critical in shipped code; currently exit 0) and
    additionally prints the full dev-inclusive audit for visibility.
    The server has zero advisories.

## Secrets handling

- All secrets live in gitignored `.env` files; `.env.example` documents
  them. The repo contains no committed secrets; uploads, logs, the FAISS
  index and model weights are gitignored.
- If a secret ever does leak: rotate `JWT_SECRET_KEY` (invalidates all
  sessions), rotate `DOC_MASTER_KEY` **only** with a re-wrap migration
  (otherwise wallet files become unreadable), and rotate the provider keys
  in the two `.env` files.
