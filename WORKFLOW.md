# ShramSetu — Full Code & Workflow Study Guide

*A complete walkthrough of the current architecture, with real code from this
repository. Every file path below exists — open it live in your viva.*

> Earlier documents that describe the old FastAPI/SQLite version live in
> [academic/archive/](academic/archive/) with a banner. This file describes the
> Node.js/Express + MongoDB codebase as it is today.

---

## 1. The One-Paragraph Summary

> **ShramSetu is a multilingual digital welfare platform for migrant workers.**
> A React + TypeScript PWA talks to a Node.js/Express API over
> JWT-authenticated REST backed by MongoDB. Workers register with OTP
> verification (plus explicit consent for third-party AI processing), manage
> an encrypted document wallet, and file grievances with auto-derived
> priority and SLA. An AI assistant answers welfare-scheme questions via
> **RAG (Retrieval-Augmented Generation)** over curated government documents
> — with Whisper for speech input and a local neural voice for speech output.
> Government officers get a **fail-closed, jurisdiction-scoped** dashboard
> with notifications and audit logs.

---

## 2. The Layered Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  FRONTEND — React 18 + TypeScript + Vite + Tailwind              │
│  pages/ (screens)  api/ (HTTP clients)  i18n/ (6 languages)      │
│  context/AuthContext (token)  hooks/ (voice)  components/ui/     │
└──────────────────────────┬───────────────────────────────────────┘
                           │  REST + JWT  (Vite proxies /api → :8000)
┌──────────────────────────▼───────────────────────────────────────┐
│  API LAYER — Express (server/src/)                               │
│  routes/: auth.js · grievances.js · documents.js · government.js │
│  chat.js · notifications.js · workers.js                         │
│  middleware/: authenticate (JWT + liveness cache) · rateLimit.js │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│  LOGIC + DATA — Mongoose models (server/src/models/)             │
│  utils/scope.js (jurisdiction) · utils/docKeys.js (key wrapping) │
│  utils/fileValidation.js (magic bytes) · utils/audit.js          │
└──────────────────────────┬───────────────────────────────────────┘
                           │  X-Internal-Key
┌──────────────────────────▼───────────────────────────────────────┐
│  AI SERVICE — FastAPI :8100 (ai-service/)                        │
│  main.py (guard middleware, PII strip)                           │
│  app/services/: rag_service · translation_service · stt/tts      │
│  rag/: loader (provenance headers) · ingest (FAISS build)        │
└──────────────────────────────────────────────────────────────────┘
```

**Key point for the viva:** the Express layer never holds business state;
authorization is centralised in `middleware/auth.js` + `utils/scope.js`;
the AI service never trusts the network (every request except the `/health*`
probes must carry the shared internal key) and never sees raw PII.

---

## 3. A Request's Journey (the single flow to memorize)

*"Worker files a grievance."*

```
GrievanceFormPage.tsx                    (frontend — collects input)
        │  POST /api/grievances  {category, subject, description}
        ▼
api/client.ts → axios attaches JWT (single token key, AuthContext)
        ▼
middleware/auth.js authenticate          (verify JWT → live user re-check)
        ▼
routes/grievances.js POST /
        │  validate category/subject/description (422 with field errors)
        │  derive priority from category, SLA from priority
        │  denormalise owner_state / owner_district at creation
        ▼
models/Grievance.js → Mongo document (+ first timeline entry + audit row)
```

Return path: a government officer sees it on the dashboard **only if it
falls inside their jurisdiction** (`utils/scope.js`), changes its status
(timeline + audit), and the worker sees the update. One loop through the
whole system.

---

## 4. Module-by-Module, With Real Code

### 4.1 Jurisdiction scoping — fail-closed (`server/src/utils/scope.js`)

```js
/** Mongo filter over User (workers) for this official. Fail-closed. */
export function workerScopeFilter(official) {
  const { state, district, superadmin } = scopeParts(official);
  if (superadmin) return { role: "worker" };
  if (!state) return { role: "worker", _id: null }; // fail closed — matches nothing
  const f = { role: "worker", current_state: state };
  if (district) f.current_district = district;
  return f;
}
```

Grievances are scoped by **where they were filed** (denormalised
`owner_state`/`owner_district` at creation), with a fallback to the live
worker set — so a worker who moves districts takes their old grievance
visibility with them, and the filing district is preserved. Object routes
re-check with `officialCanSeeGrievance()` and return **404 (not 403)** so an
out-of-scope worker's existence is never even discoverable. Notifications:
`notifiableWorkerIds()` rejects `target="all"` and out-of-scope
states/districts with `{ forbidden: true }` → **403**.

**Explain the rules:**

| Officer | Sees |
|---|---|
| Superadmin | everything (incl. audit logs) |
| State set (e.g. `KL001`) | only that state |
| State + district (e.g. `EKM001`) | only that district |
| **Nothing set** | **nothing at all** (fail-closed, never fail-open) |

These rules are locked in by `server/tests/security.test.js` (40 tests).

### 4.2 Auth — OTP + password, hardened (`server/src/routes/auth.js`, `middleware/auth.js`)

- Passwords: bcrypt (`models/User.js`). Sessions: JWT, **12 h expiry**.
- OTPs are 6 digits, hashed at rest, expiring, one-per-60 s per number
  (then HTTP 429 via `otpRequestLimiter`), and in dev printed **only to the
  server terminal** (+ `logs/otp-dev.log`). The UI never displays or
  auto-fills them; `OTP_ECHO_ENABLED=true` fails the production boot guard.
- An **unverified** account cannot password-login (403) and cannot be
  hijacked by re-registering the same number — re-registration re-sends the
  OTP and never overwrites a verified account (409).
- `authenticate` re-checks liveness (user exists + `is_active`) on every
  request through a **30 s in-memory cache**, so deactivating a user cuts
  access within a TTL window, not at next token expiry.

```js
// middleware/auth.js
const USER_TTL_MS = 30_000;
// ... cached liveness check; DB failure → 503 (never fail-open)
```

### 4.3 Defence-in-depth on the API surface (`server/src/config.js`, `middleware/rateLimit.js`)

- `helmet` on the app + a general API limiter; strict limiters on OTP
  request/verify, worker login, government login and register — all
  configurable from env (`config.rateLimits`).
- `assertProductionSafe()` **refuses to boot** in production with a default
  admin password, OTP echo, demo seeding, missing `DOC_MASTER_KEY`,
  missing JWT secret, or an in-memory MongoDB.
- Admin bootstrap is **create-only**: an existing admin's password is never
  reset on boot.

### 4.4 Document wallet crypto (`server/src/utils/docKeys.js`)

Each wallet file is encrypted with its own AES-256-GCM key; that key is
itself **wrapped** with a master key from the environment:

```
Storage format in Document.encryption_key:
  "wrapped:v1:" + base64( iv(12) || tag(16) || ciphertext )
```

```js
export function wrapKey(perFileKeyBuf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(perFileKeyBuf), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}
```

A stolen DB dump alone no longer decrypts documents. Existing rows are
migrated by `server/scripts/migrate-doc-keys.mjs`. Uploads use
`multer.memoryStorage()`, magic-byte validation (`utils/fileValidation.js`:
PDF/JPEG/PNG/WEBP + size + extension), and are deleted on any DB failure;
downloads set RFC 5987 `filename*=UTF-8''…` with an ASCII fallback.

### 4.5 Grievance workflow (`server/src/routes/grievances.js`)

```js
const SLA_DAYS = { urgent: 7, high: 14, medium: 30, low: 45 };
const priority = PRIORITIES_BY_CATEGORY[category] || "medium";
const slaDays  = SLA_DAYS[priority] ?? 30;
```

Filing auto-derives **priority from category** and **SLA from priority**
(unpaid wages → high → 14 days). The status model is a small state machine:
withdraw is only allowed from `submitted`/`under_review` (400 otherwise),
feedback only once and only on `resolved`, and every official status change
appends a timeline entry + audit row.

### 4.6 Notifications: one collection, per-worker copies (`server/src/routes/notifications.js`)

A `PushNotification` document stores the message + targeting; each recipient
gets a per-worker copy carrying read state, so the inbox and the unread
badge can never disagree, and targeting is a Mongo query through the **same
jurisdiction filter** — a district officer cannot broadcast state-wide.

### 4.7 The RAG assistant (showcase) — `ai-service/rag/` + `app/services/rag_service.py`

**Offline pipeline** (`rag/ingest.py`): parse headers → **skip superseded
documents** → chunk → embed (multilingual MiniLM) → FAISS.

**Corpus provenance** (`rag/loader.py`): every document carries
`SOURCE_URL`, `LAST_VERIFIED`, `STATUS (current|superseded)`. Documents
describing Acts repealed on 21 November 2025 (Minimum Wages Act, Payment of
Wages Act, Equal Remuneration Act, Contract Labour Act, Inter-State Migrant
Workmen Act, BOCW Act, Employees' Compensation Act, Maternity Benefit Act,
Unorganised Workers' Social Security Act, BOCW Cess Act) are marked
superseded and never retrieved; current-law documents (the four Labour
Codes) cite PIB press releases. This is enforced by
`tests/test_corpus_integrity.py`.

**Online pipeline** (`rag_service.answer_question`):

```
strip PII (mobiles → <phone>, Aadhaar-like → <id>)
→ translate Indic question to English (retrieval side only)
→ FAISS similarity search → similarity gate (threshold 0.45)
→ dedupe overlapping chunks → build context → Groq LLM (strict JSON)
→ grounded? answer + disclaimer + citations
  : honest multilingual refusal (+ helpline 14434)
```

```python
threshold = max(settings.RAG_MIN_SIMILARITY, 0.20)
scored = [pair for pair in scored if pair[1] >= threshold]   # ← THE GATE
if not scored:
    return _no_info_response(language)   # honest refusal, not a hallucination
```

The threshold is **0.45** (config default + `.env`), justified by the eval
suite: off-topic/injection questions top out at ≈0.42 similarity while
genuine hits start at ≈0.47 (see `eval/RESULTS.md`). Every substantive
answer ends with a per-language disclaimer: *"This information is for
guidance only and is not legal advice. For help with your specific case,
contact your nearest labour office or Common Service Centre (CSC)."*

**The anti-hallucination story in one sentence:** *retrieval similarity
gate + superseded-doc exclusion + strict JSON contract + the LLM's own
`grounded` self-check + citations with source URL/verification date + an
honest multilingual refusal + a visible disclaimer* — and it is measured,
not claimed: `eval/run_eval.py` reports hit@1 74%, hit@3 87%, 11/11
retrieval refusals across a 50-question, 6-language suite.

### 4.8 Voice + translation (`app/services/stt_service.py`, `tts_service.py`, `translation_service.py`)

- **STT:** faster-whisper (local, small/int8), UI language passed as a hint
  with a degenerate-output detector that retries with auto-detect.
- **TTS:** local Meta MMS VITS (in-process, no provider chain) — honest error
  if the model fails to load. Long text is sentence-chunked before synthesis.
- **Translation:** Google Translate (if a key is set) first, local
  IndicTrans2/NLLB fallback — translation is **retrieval-side only**; the
  answer is always generated in the worker's language.
- All external calls are PII-scrubbed first (`app/services/pii.py`), and the
  worker consents to third-party AI processing at registration (checkbox +
  notice in all 6 locales).

### 4.9 Frontend glue (`frontend/src/api/client.ts`)

One axios instance attaches the JWT to every request; `apiErrorMessage`
normalises array-shaped 422 validation errors into human text. Auth state
(token storage) lives in a single AuthContext; the document-wallet PIN lock
is an explicitly-labelled **client-side convenience lock** (see
docs/SECURITY.md — it is not encryption).

---

## 5. Data Model (MongoDB collections)

```
User (worker) ──1:N──► Grievance (owner_state/owner_district denormalised)
   │                    └─ timeline[] · comments[] · attachments[]
   ├──1:N──► Document (wallet: wrapped:v1 key + AES-256-GCM file)
   ├──1:N──► ChatMessage
   └──1:N──► WorkerNotification ──N:1──► PushNotification
GovernmentUser (role, state, district, is_superadmin) ──► PushNotification
AuditLog (actor role+identifier, action, resource, ip, success)
OtpCode (hashed, expiring, cooldown-tracked)
```

Migrant-specific fields on `User`: separate `current_*` (work-site) vs
`native_*` (home) addresses, occupation enum, `consent_ai_processing` —
because welfare eligibility depends on *both* locations.

---

## 6. The Full Demo Loop (what to show, in order)

See [DEMO.md](DEMO.md) for the scripted 6-minute version. The short form:

1. Language select → OTP login (OTP from the **server terminal**).
2. File a grievance (auto priority + SLA).
3. AI assistant: current-law answer with citations → off-topic question →
   honest refusal → voice in/out.
4. Document wallet: PIN lock, upload, encrypted download.
5. Government portal **as EKM001** (district scope) vs **ADMIN001**
   (superadmin) — scoping you can see, not just claim.
6. Targeted notification → worker inbox → audit log trail.
7. Close: `cd server && npm test` (40 passed) ·
   `cd ai-service && venv/Scripts/python -m pytest` (35 passed).

---

## 7. Likely Viva Questions & Strong Answers

**Q: Why Express + MongoDB?**
A: The team's strongest stack; Mongoose schemas give validation at the data
boundary, and Mongo aggregation drives the dashboard stats. Dev uses an
**embedded MongoDB** (`MONGODB_URI=memory`) so a fresh machine runs with
zero installs; production points the same variable at a real server.

**Q: How do you prevent AI hallucination?**
A: Layers, in order: PII stripping → translation for retrieval → similarity
gate at 0.45 → superseded-doc exclusion → context-only system prompt → the
LLM's own `grounded` flag → citations with official source URLs and
verification dates → per-language refusal with the e-Shram helpline →
visible "not legal advice" disclaimer. And it's **measured**: the eval
harness (50 questions, 6 languages) reports hit@1/hit@3 and refusal rates
into `eval/RESULTS.md`.

**Q: How do you handle new labour laws?**
A: The four Labour Codes took effect 21 November 2025 (PIB PRID 2192463).
Repealed-Act documents are marked `STATUS: superseded` and are excluded
from retrieval; current-law documents cite PIB/labour.gov.in; corpus
integrity tests fail the build if any doc loses its provenance headers or a
repealed Act is served as current law.

**Q: How is RBAC enforced — and what makes it safe?**
A: Every government query passes through `utils/scope.js`; the design is
**fail-closed** (no jurisdiction → zero rows), object routes return 404 so
out-of-scope records aren't discoverable, notification targeting reuses the
same filter with 403 on out-of-scope targets, and `security.test.js`
(40 tests) proves each rule including worker-JWT rejection on every
government route.

**Q: Is the document wallet really secure?**
A: Files are AES-256-GCM encrypted at rest with per-file keys that are
themselves wrapped under `DOC_MASTER_KEY` (env-only; production refuses to
boot without it) — a stolen DB dump alone doesn't decrypt anything. The
frontend PIN lock is a **UI convenience**, honestly labelled, not
cryptographic.

**Q: Is it production-ready? (be honest)**
A: No — it's production-*oriented*: prod boot guard, rate limiting, helmet,
wrapped keys, fail-closed RBAC, audit logs, PII scrubbing before external
AI calls. What a real deployment still needs: a real SMS gateway for OTPs,
HTTPS/TLS termination, object storage for uploads, push notifications, and
managed MongoDB. See docs/SECURITY.md for the full threat model and
limitations.

**Q: What was the hardest bug?**
A: The voice one — UI in Malayalam forced Whisper into `language=ml` while
the user spoke English, producing degenerate repeated syllables; fixed with
a degenerate-output detector + auto-detect retry. Second: a stale AI
service instance serving an outdated FAISS index on the same port — caught
by the end-to-end smoke test because citations carried empty provenance
fields, which is exactly what the provenance headers make visible.
