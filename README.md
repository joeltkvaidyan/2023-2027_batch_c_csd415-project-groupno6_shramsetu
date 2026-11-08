# ShramSetu — AI-First Multilingual Welfare Platform for Migrant Workers

Final-year CSE project. ShramSetu connects migrant workers with government
welfare: OTP-verified registration (with explicit AI-processing consent), a
secure encrypted document wallet, grievance filing with tracking, a
jurisdiction-scoped government dashboard with notifications and audit logs,
and a **multilingual AI welfare assistant** — RAG over curated government
scheme documents — with **voice in/out**. The worker dashboard also carries a
**QR digital ID card** and a **wage diary** that can pre-fill an unpaid-wages
grievance (a day already recorded as fully paid is locked from further edits).

Trust is gated on both sides of the work: **new WORKER and EMPLOYER accounts
both start pending and a jurisdiction labour office must accept them** before
they reach the public surfaces (directory, job applications, postings, public
ratings). Accepted employers can self-post job listings that carry an honest
"labour-office accepted" poster signal (never a listing certification), and
**households (the general public) get their own account**: they post area-
scoped work requests, workers see them ranked by the same explainable matcher,
and both the employer and household dashboards list the contact number of
labour-office accepted workers with `tel:`/`sms:` buttons. Contact numbers are
never public — `/public/workers` omits them and the open directory is gone;
only a signed-in employer or household account can read them.
The RAG corpus further answers the questions the 2026 evidence showed are
actually failing on the ground: the 8-May-2026 final Labour-Code grievance
path (GRC at 20+ workers; contract-labour grievance → principal-employer
committee → Inspector-cum-Facilitator after 30 days), the 28-Apr-2026 MoLE
heatwave advisory with NCDC heat-illness guidance (one-tap from a dashboard
**Heat safety** tile, prefilled question in the worker's language), and an
honestly-scoped AAWAZ explainer (status uncertain, enrolment reported closed
2022). The evidence→feature→metric mapping lives in
[docs/SOCIAL_IMPACT.md](docs/SOCIAL_IMPACT.md).

Supported languages: **English, Hindi, Bengali, Telugu, Tamil, Malayalam**.

## Architecture (polyglot microservices)

```
┌────────────────────────────────────────────────────────────┐
│  frontend/         React 18 + TypeScript + Vite + Tailwind │
│                    PWA · i18n (6 languages) · axios        │
└──────────────┬─────────────────────────────────────────────┘
               │ REST + JWT  (Vite proxies /api → :8000)
┌──────────────▼─────────────────────────────────────────────┐
│  server/           Node.js 22 + Express 4 + Mongoose 8     │
│  API + business logic: auth (OTP/password + rate limits),  │
│  fail-closed jurisdiction scoping, grievances, document    │
│  wallet (AES-256-GCM with wrapped keys), notifications,    │
│  government RBAC + audit logs, AI proxy (X-Internal-Key)   │
└───────┬───────────────────────────────┬────────────────────┘
        │                               │ X-Internal-Key
┌───────▼──────────┐          ┌─────────▼───────────────────┐
│  MongoDB         │          │  ai-service/   Python 3.10  │
│  (embedded dev   │          │  FastAPI :8100              │
│   instance or    │          │  · RAG: FAISS + multilingual│
│   real server)   │          │    embeddings + Groq LLM,   │
│                  │          │    similarity gate +        │
│  users·grievances│          │    citations + disclaimer   │
│  documents·notifs│          │  · STT: faster-whisper small│
│  audit·chat      │          │  · TTS: local MMS          │
│  wages           │          │                             │
└──────────────────┘          │  · PII stripped before any  │
                              │    external provider call   │
                              └─────────────────────────────┘
```

- **Node.js backend** (`server/`) — all CRUD/auth/business rules.
- **Python AI microservice** (`ai-service/`) — FAISS retrieval over curated
  government scheme documents (with per-document provenance: source URL,
  verification date, current/superseded status), Groq-grounded answers with
  citations and an "informational only, not legal advice" disclaimer,
  faster-whisper speech-to-text, local MMS text-to-speech, and
  Indic→English query translation (Google Translate if configured, with
  local IndicTrans2/NLLB fallbacks).
- **MongoDB** — Mongoose models; dev uses an embedded instance (zero
  install), production points `MONGODB_URI` at a real server.

Legal currency note: the four Labour Codes (Code on Wages 2019, Industrial
Relations Code 2020, Code on Social Security 2020, OSH Code 2020) came into
force on **21 November 2025**, replacing 29 earlier central Acts
([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2192463)). The RAG
corpus reflects this: repealed-Act documents are marked `STATUS: superseded`
(kept for history, excluded from retrieval) and current-law documents cite
official sources. Repealed-Act docs that remain in the corpus carry a
"REPEALED — HISTORICAL INFORMATION ONLY" notice.

## Run it (development)

Prereqs: Node 22+, Python 3.10 (for the AI service).

### One command (Windows)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File start-all.ps1
```

Starts all services detached, **skipping any already running**, waits for
**readiness** (not just an open port), then prints the URLs:

| Service | URL | Notes |
|---|---|---|
| Node API | http://127.0.0.1:8000 | OTPs appear in the server terminal |
| AI service | http://127.0.0.1:8100 | `/health/ready` is 503 until its models finish loading |
| Frontend (desktop) | http://127.0.0.1:5199 | |

The AI service loads its embedding model and FAISS index in the background at
boot, so its port opens long before it can answer. The launcher waits on
`/health/ready` and prints which model is still loading, rather than reporting
"ready" and then stalling the first question until the Node proxy times out.

Logs land in `shramsetu/logs/` (gitignored). Stop everything with
`powershell -NoProfile -ExecutionPolicy Bypass -File stop-all.ps1`
(kills only these services — MongoDB is untouched).

### Manual (any OS)

```bash
# 1) Backend  → http://127.0.0.1:8000
cd server
npm install
npm run dev
# OTPs print to THIS terminal and to logs/otp-dev.log (dev delivery only —
# the UI never shows or auto-fills the OTP)

# 2) AI service → http://127.0.0.1:8100   (first /ask or /speak downloads models)
cd ai-service
  # Windows
#   venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8100          # macOS/Linux .\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8100

# 3) Frontend → http://localhost:5173
#    (vite.config.ts sets port 5173. It serves HTTPS instead when a dev
#     certificate exists in frontend/.certs/ — see "Run it" above.)
#    start-all.ps1 deliberately runs it on :5199 (HTTP) and :5443 (HTTPS).
cd frontend
npm install
npm run dev
```

`server/.env` and `ai-service/.env` hold dev values (see the matching
`.env.example` files). Both services need `AI_INTERNAL_KEY` (same rando./venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8100 m
value in both files) — the AI service rejects unauthenticated requests.
On boot the server auto-creates the bootstrap admin **create-only** (never
resets its password) and, when `SEED_DEMO_DATA=true` (dev default), seeds
demo workers/grievances if the users collection is empty.

## Demo credentials (development only)

The seeded accounts are fixtures created by `SEED_DEMO_DATA=true`, and their
logins are listed in the `DEV SEED ACCOUNTS` block at the end of
[`server/.env.example`](server/.env.example). They are deliberately not repeated
here: a credential table in a README is the first thing a scraper finds, and the
same table invites carrying a demo password into a real deployment.

The server refuses to boot in production with `SEED_DEMO_DATA=true` or the
default `BOOTSTRAP_ADMIN_PASSWORD`, so these accounts cannot exist in a
production database created by this code.

## Tests and verification

| Suite | Command | Covers |
|---|---|---|
| Server unit/security | `cd server && npm test` | 263 tests: scoping, ownership, upload crypto, document-wallet PIN (scrypt, lockout, wallet tokens), cookie sessions (httpOnly, CSRF, refresh rotation/reuse, logout revocation, one role probe), rate limits, trust proxy, auth hardening, wage parity (incl. paid-day lock), superadmin officials monitoring, employer acceptance gate, job posting and applicant consent-reveal, citizen service requests, engagement loop (offer → accept → confirm shift → payment) with its transition and diary rules |
| Frontend unit/component | `cd frontend && npm test` | 87 tests: session module (CSRF echo, single silent refresh, one role probe, no token storage), role guard states, wallet unlock/idle-lock behaviour, offline-cache AES-GCM round trip and LRU, auth-gate routing, status badge a11y, i18n bundle parity |
| AI service | `cd ai-service && venv/Scripts/python -m pytest` | 92 tests: corpus integrity, loader, RAG contract, PII, prompt injection, cold-start readiness, STT transcribe regression |
| End-to-end checks | `cd server && npm run verify` | 34 live checks across both services (incl. wage round trip, paid-day lock, SOS route removed, officials monitoring). Expects the seeded demo dataset — after registering test workers run `npm run demo:reset` or the seed-count checks fail. A check that needs an external provider we have no working key for prints `SKIP` with the reason instead of silently disappearing, and is never counted as a pass |
| RAG eval harness | `venv/Scripts/python eval/run_eval.py` | hit@1/hit@3, retrieval refusals, per-language → `eval/RESULTS.md` |

All four run in CI on every push (`.github/workflows/ci.yml`): server tests,
AI-service tests, frontend typecheck + tests + build, and a dependency audit.

### Wage slips (Form V) and the muster roll (Form IX)

A wage slip is issued once from a paid engagement
(`POST /api/v1/wage-slips`) and is immutable afterwards: a correction is a new
slip that supersedes the old one, never an edit.

It ships in **exactly two formats, and neither needs a PDF library**:

| Format | Endpoint | How it becomes a PDF |
|---|---|---|
| Printable HTML | `GET /api/v1/wage-slips/:id/print` | the browser (Ctrl/Cmd + P → Save as PDF) |
| Plain text | `GET /api/v1/wage-slips/:id/text?language=ml` | sent over WhatsApp/SMS as-is |

There is no server-side PDF renderer and no binary document generator in this
repository. Rendering a PDF here would mean bundling fonts for six Indic scripts
— a dependency and a licensing question — for something every browser already
does. `?language=` accepts `en`, `hi`, `ml`, `ta`, `te`, `bn` and falls back to
`en`.

The arithmetic is enforced as code, not as display: gross must equal
basic + DA + allowances + overtime **and** the amount actually paid; net must be
gross minus deductions; deductions may not exceed half the period wages; and a
slip may not be dated after the payment it evidences. A slip that would break any
of those is refused with a specific code (`gross_mismatch`,
`deductions_exceed_half`, `slip_after_payment`, …), never silently corrected.

Fields the platform does not hold — UAN, bank account, relation name,
designation, establishment address and registration number, the DA/allowance and
PF/ESI/other splits — are stored as null, listed in `absent_fields`, and printed
as "not recorded". Nothing is invented to fill a statutory box.

The Form IX attendance-cum-muster roll is built only from engagements whose shift
was confirmed as worked: `GET /api/v1/records/muster-roll?month=2027-03` (JSON) or
`…/muster-roll/print` (printable HTML).

### Evidence reaching a complaint, and how a rating is labelled

`GET /api/v1/wages/grievance-prefill?month=YYYY-MM` builds the unpaid-wages draft
on the server, so every day in it states its own evidential weight. An
`employer_confirmed` day cites its engagement, the employer account, the confirmed
wage and any wage slip; a `self_reported` day is labelled as the worker's own
account. The draft never presents the two as equal, and it still produces a draft
when nothing has been confirmed at all. Confirmed days can be cited on the filed
complaint as evidence references through the existing `attachments` array; the
server re-checks every reference against the filer and drops anything that is not
theirs rather than rejecting the filing.

Ratings carry `verification` (`confirmed_engagement` | `public_self_declared`) and
`rater_label` (`verified_employer` | `unverified_public`). An employer account can
rate only after a shift it confirmed as worked; the public form stays open and is
labelled unverified everywhere. The rated worker has a 14-day right of reply; until
they reply (or the window closes) the rating is not final and its author may still
amend it, after which it locks. `shifts_confirmed` and `paid_on_time` are computed
from engagements at read time and never stored, and a low rating never removes a
worker from the public directory — `server/tests/evidenceLoop.test.js` fails if
that ever changes.

### Why `npm test` fails on Git Bash (and `npm run test:direct`)

On Windows under Git Bash, `npm test` can fail before running a single test with:

```
'node' is not recognized as an internal or external command,
```

This is an npm environment problem, not a test failure. npm's run-script hands
its child shell a `PATH` that stops before the Node install directory
(`npm run env | grep ^PATH` shows the truncated value), so the shell cannot
resolve `node` even though `which node` succeeds in the parent shell. The same
thing breaks `npx vitest`.

Both packages therefore expose a `test:direct` script that bypasses the shim and
invokes vitest's binary by path:

```bash
cd server   && npm run test:direct   # node ./node_modules/vitest/vitest.mjs run
cd frontend && npm run test:direct
```

If `npm run test:direct` still reports `'node' is not recognized`, the same
truncated `PATH` is the cause — run the invocation directly, or run the script
through cmd, which gets the intact environment:

```bash
node ./node_modules/vitest/vitest.mjs run        # from the package directory
cmd //c "npm run test:direct"                    # or hand it to cmd
```

All three forms exit non-zero when a test fails; `test:direct` does not swallow
the status. Confirmed counts at the time of writing: **server 120/120**,
**frontend 61/61**.

## Production notes (honest scope)

Not production-ready as-is; it is production-*oriented*. With
`ENV=production` the server **refuses to boot** unless `JWT_SECRET_KEY` is
set, `BOOTSTRAP_ADMIN_PASSWORD` is changed from the default,
`OTP_ECHO_ENABLED=false`, `SEED_DEMO_DATA=false`, `DOC_MASTER_KEY` is set
and `MONGODB_URI` is not the in-memory instance.

Still needed for a real deployment:
- A real SMS gateway for OTP delivery (the terminal printer in
  `server/src/routes/auth.js` must be replaced), and real HTTPS/TLS
  termination.
- Object storage with server-side encryption for uploads if running multi-node.
- The AI service needs a free Groq API key (console.groq.com) for grounded
  LLM answers; retrieval and honest refusals still work without it.
- Push notifications (FCM) and persistent media for chat/attachments.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/SECURITY.md](docs/SECURITY.md) (threat model + known limitations) and
[DEMO.md](DEMO.md) (timed demo script, troubleshooting).
[WORKFLOW.md](WORKFLOW.md) is the code walkthrough, and
[academic/](academic/) holds the presentation deck, viva question bank and the
superseded FastAPI-era documents — none of it is part of the shipped product.

## Deploy (production)

Ship the four-service stack with `docker compose`, which assembles Mongo, the AI
service, the Node API server and the nginx frontend into one Docker Compose file.
Host and CI both do this: run `docker compose up -d` from the repo root, then
wait for readiness before pointing the browser at the public origin.

```bash
# 1. Fill the ROOT .env — docker compose interpolates every bare env name
#    below from it (gitignored; keys documented in .env.example):
#      JWT_SECRET_KEY, GROQ_API_KEY, GROQ_MODEL, HF_TOKEN,
#      AI_INTERNAL_KEY, BOOTSTRAP_ADMIN_PASSWORD, DOC_MASTER_KEY
#    GEMINI_API_KEY / GOOGLE_API_KEY enable the optional fallbacks.
#    Containers do NOT read server/.env or ai-service/.env — compose's
#    `environment:` block is the only runtime source.

# 2. Build & start the stack detached.
docker compose up -d

# 3. Confirm every service is healthy before serving traffic.
docker compose ps          # every service "healthy" (not "starting" or "unhealthy")
curl -s http://localhost:8100/health/ready      # ai-service: true when warm
curl -s http://localhost:8000/health            # server: 200 {status:"ok"}
wget -qO- http://localhost/                     # frontend: index.html (SPA)

# 4. Load a demo worker, verify the proxy chain is live.
#    From a browser (or shramsetu/docs/SECURITY.md) log in as a worker and
#    hit /api/v1/chat or /api/v1/grievances. The nginx frontend -> server on
#    :80 -> :8000 -> ai-service on :8100 chain is exercised on every request.
```

The compose file maps the public origin:
- `mongo:27017` (data in named volume `mongo_data`)
- `ai-service:8100` (FastAPI: RAG + Groq/Gemini LLM, local faster-whisper STT,
  local MMS TTS)
- `server:8000` (Express: auth, grievances, documents, chat, notifications; proxies
  `/api` to `ai-service`)
- `frontend:80` (nginx: static SPA + proxies `/api` to `server`)

Concretely, the four live providers that the platform routes traffic through:
- **LLM:** Groq (primary) → Google Gemini (fallback) → deterministic local JSON
  fallback. The AI service only accepts an internal key from the Node server, so
  the sandbox never calls a provider directly.
- **STT:** local `faster-whisper` (CPU, no key, no cloud call). Language is
  auto-detected, then re-decoded with a per-language fine-tuned Whisper
  checkpoint for non-English (Hindi/Bengali/Telugu/Tamil/Malayalam).
- **TTS:** AI4Bharat IndicParler-TTS (in-process, gated HF model) with a
  local Meta MMS VITS fallback. Returns
  `audio/wav`.
- **Query translation:** English-first retrieval (IndicTrans2 → NLLB fallback).

**Vagrant-equivalent one-liner (WSL2/Windows dev host):** nothing is in Vagrant;
the stack is `docker compose` only. The `start-all.ps1` launcher is the
development equivalent (all four services on 8000/8100/5199) but it is not what
you deploy.

**Pull the live stack onto another host:** `docker compose pull && docker compose up -d`
(preserves `mongo_data` / `ai_index` / `ai_models` / `frontend_uploads` named
volumes, so the FAISS index and model weights survive rebuilds).
