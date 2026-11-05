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

# ShramSetu — Implementation & Verification Guide (Phase 2 fixes + production hardening)

This document covers what changed in this pass, exactly what's been verified automatically vs. what needs your own credentials to confirm live, and a step-by-step checklist to get every feature genuinely working end-to-end.

---

## 0. Production hardening (this pass)

On top of the Phase 2 bug fixes (section 1 below), this pass makes the stack production-ready:

| Area | What changed |
|---|---|
| Database | Real connection pool for Postgres (`pool_pre_ping`, configurable size/overflow, recycling). Real Alembic migrations — `backend/alembic/versions/` has a verified initial migration for all 7 tables (applies and rolls back cleanly), run automatically via `RUN_MIGRATIONS_ON_START=true` in `docker-compose.yml` |
| File storage | New `S3StorageService` — works with real AWS S3 or free-tier Cloudflare R2/Backblaze B2 via `STORAGE_BACKEND=s3`. Downloads use short-lived signed URLs instead of streaming bytes through the API, for both documents and grievance attachments |
| Chatbot readiness | Embedding model + FAISS index now load at **app startup**, not on the first user's request — no cold-start surprise. Best-effort: falls back to lazy loading if offline at boot |
| Secrets | App refuses to boot with `ENV=production` and a placeholder/short JWT secret (catches both the code's own dev default and `.env.example`'s placeholder) |
| Abuse hardening | OTP requests now rate-limited per mobile number (`OTP_RESEND_COOLDOWN_SECONDS`, default 30s), on top of the existing per-code attempt cap |
| Containers | Non-root user, Docker `HEALTHCHECK`, multi-worker Uvicorn (`WEB_CONCURRENCY`) |
| Storage efficiency | (carried over from the previous pass) Paginated list endpoints, indexed `Grievance.category` |

`docker compose up` now runs in `ENV=production` by default — see the README's **Production Deployment** section for what that implies and the Quick Start for the one extra step (generating a real `JWT_SECRET_KEY`) it now requires.

---

## 1. What was actually broken, and what was fixed (previous pass)

| Issue reported | Root cause | Fix |
|---|---|---|
| Grievances not forwarded to Labour/Police Dept | Forwarding never existed — grievances were only stored, never emailed anywhere | New `notification_service.py`: on filing, emails the relevant authority based on category, logs a "Forwarded to: ..." entry on the complaint's own timeline so the worker can see it happened |
| Chatbot "not working properly" | The RAG service caught **every** exception (bad API key, network failure, malformed model output) and silently returned the same generic "no verified information" message as a real no-match — so real outages were indistinguishable from normal behavior, and nothing was logged | Split into `_no_info_response` (genuine no-match — business-as-designed) vs `_error_response` (something broke — now logged with `logger.exception` and shown to the user as a distinct "technical problem, please retry" message in all 6 languages) |
| Voice not working (mobile) | Text-to-speech worked; speech-to-text was entirely missing — Expo Go can't run native STT modules | Added `/chat/transcribe` backend endpoint using Groq's free Whisper API (same key as the chatbot). Mobile now records audio with `expo-av`, uploads it, gets text back. Wired a working mic button into the chat screen. |
| "Storage should be efficient" | Document/grievance/chat-history list endpoints had no pagination — every request pulled the entire table for that worker, and `Grievance.category` wasn't indexed | Added `limit`/`offset` params (capped at 100) to documents, grievances, and chat history endpoints; added a DB index on `Grievance.category`; verified `owner_id` indexes already existed on all list-heavy tables |

---

## 2. What's verified automatically (you can trust these without extra setup)

Run the backend test suite — **30/30 tests pass**, covering:
- Auth + OTP flow (registration, verification, login gating, resend cooldown)
- Document wallet (upload/list/rename/delete, pagination)
- Grievances (file/list/detail/attach/withdraw, forwarding to Labour Dept / Police, pagination)

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
pytest -v
```

The Alembic migration was verified to actually apply and roll back cleanly against a fresh database (not just written and assumed correct):
```bash
cd backend
alembic upgrade head    # creates all 7 tables + indexes
alembic downgrade base  # drops them all cleanly
```

Both frontends were also verified to actually compile and bundle (not just "look right"):
- Web: `npx tsc -b` clean, `npm run build` succeeds (Vite production bundle)
- Mobile: `npx tsc --noEmit` clean, `npx expo export --platform web` succeeds — **640 modules bundled with zero errors**, which proves navigation, i18n, contexts, the new voice-recording code, and every screen actually wire together, not just type-check in isolation

## 3. What needs YOUR credentials to verify live (can't be tested in this environment)

These require real API keys/mailboxes this environment doesn't have network access to reach:

- **Chatbot generation** (Groq LLM calls) — needs `GROQ_API_KEY`
- **Voice transcription** (Groq Whisper) — needs the same `GROQ_API_KEY`
- **Embedding model download** (`sentence-transformers`) — needs internet access to Hugging Face on first run
- **Real email delivery** to Labour/Police departments — needs `SMTP_HOST`/`SMTP_USERNAME`/`SMTP_PASSWORD` (or it defaults to logging the email to console, which is enough to verify the *routing logic* but not real delivery)
- **S3-compatible storage** — needs a real bucket + credentials (AWS S3, or a free Cloudflare R2/Backblaze B2 account); `STORAGE_BACKEND=local` (the default) needs none of this and was fully exercised by the test suite

None of this is a code gap — it's simply that live LLM/email calls can't be exercised without live credentials. Section 4 below is the checklist to confirm they work in your environment.

---

## 4. Step-by-step: get everything to 100% working

### 4.1 Backend setup
```bash
cd backend
cp .env.example .env
```
Edit `.env`:
```
GROQ_API_KEY=your_key_from_console.groq.com   # free tier
```
Free-tier Groq covers both the chatbot's text generation and voice transcription — one key, two features.

### 4.2 Confirm the chatbot end-to-end
```bash
uvicorn app.main:app --reload
```
On first chatbot request, the FAISS index builds automatically from `backend/rag/sample_docs/` (needs internet for the embedding model download — one-time). Then test:
```bash
curl -X POST http://localhost:8000/api/v1/chat/ask \
  -H "Authorization: Bearer <token from login>" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the e-Shram card?", "language": "en"}'
```
Expect a grounded answer citing the e-Shram document. Ask something off-topic ("what's the weather") and expect `"grounded": false` with the "not available" message — **not** an error. If you get the new *error* message instead, check the backend console logs (now configured to print `ERROR`-level tracebacks) — that will show exactly what broke (usually an invalid/missing `GROQ_API_KEY`).

### 4.3 Confirm grievance forwarding
File a test grievance via the app or:
```bash
curl -X POST http://localhost:8000/api/v1/grievances \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"category":"harassment_abuse","subject":"Test","description":"Test complaint"}'
```
With no `SMTP_HOST` set (the default), check the backend console — you'll see a `[DEV EMAIL to police-cell@example.gov.in]` and `[DEV EMAIL to labour-dept@example.gov.in]` log line. Fetch the grievance's detail endpoint and confirm the timeline includes a `"Forwarded to: Labour Department, Police Department"` entry.

**To send real emails:** set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USERNAME=<your gmail>`, `SMTP_PASSWORD=<a Gmail App Password, not your normal password>` (Google Account → Security → App Passwords — this is free), and set `LABOUR_DEPARTMENT_EMAIL` / `POLICE_DEPARTMENT_EMAIL` to real addresses. **The placeholder `@example.gov.in` addresses in `.env.example` are not real — replace them before relying on this in production.**

### 4.4 Confirm voice (mobile)
```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8000/api/v1 npx expo start
```
Open in Expo Go on a phone on the same Wi-Fi. In the chatbot screen: tap 🎤, speak, tap ⏹ — the recording uploads to `/chat/transcribe`, and the transcribed text sends as your question automatically. If nothing happens, check that the phone granted microphone permission and that `EXPO_PUBLIC_API_URL` actually reaches your machine (test by opening `http://<your-lan-ip>:8000/health` in the phone's browser first).

### 4.5 Confirm storage efficiency
```bash
curl "http://localhost:8000/api/v1/grievances?limit=5&offset=0" -H "Authorization: Bearer <token>"
curl "http://localhost:8000/api/v1/documents?limit=5&offset=5" -H "Authorization: Bearer <token>"
```
Both should return at most 5 items each, respecting `offset`. Requests without `limit`/`offset` still default to 20 (both web and mobile frontends explicitly request up to 100 so existing users with more than 20 items don't see their lists silently truncated).

### 4.6 Confirm S3-compatible storage (optional — production only)
Get a free Cloudflare R2 bucket (10GB free, S3-compatible API) or use real AWS S3. Set in `.env`:
```
STORAGE_BACKEND=s3
S3_BUCKET_NAME=your-bucket
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com   # omit for real AWS S3
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```
Upload a document, then hit its `/download` endpoint — you should get a `307` redirect to a signed URL on your bucket's domain rather than the file streaming directly from the API.

### 4.7 Confirm production startup validation
```bash
ENV=production JWT_SECRET_KEY=change_this uvicorn app.main:app
```
Should refuse to start and print a clear error about the placeholder secret. With a real secret (`openssl rand -hex 32`), it should start normally and log a warning if `GROQ_API_KEY` is missing or `DATABASE_URL` is still SQLite.

---

## 5. Honest current limitations (not hidden, still true after this pass)

- **Aadhaar numbers are stored as plain text**, not encrypted at rest or verified against UIDAI. Fine for a dev/demo deployment; **must** be addressed (field-level encryption at minimum) before handling real workers' data.
- **Government-side grievance review exists.** The Government portal (`government_auth.py` for employee_id/password login, `government.py` for the dashboard API) lets officials list/filter grievances, comment, move them through `submitted`→`under_review`→`resolved`/`rejected`, assign an officer, and send push notifications — all audit-logged. Officials only ever see anonymized worker data (no Aadhaar/address/phone/email). Audit-log viewing is gated to superadmin.
- **Document/attachment downloads now work from the mobile system browser regardless of `STORAGE_BACKEND`.** Previously, `Linking.openURL` hit `/documents/{id}/download` (or the grievance attachment equivalent) directly, which required an `Authorization` header the system browser can't send — a functional dead end on mobile for `STORAGE_BACKEND=local`, and *also* broken for `STORAGE_BACKEND=s3` since the redirect-to-signed-URL step still sat behind that same header check. Fixed with a short-lived (5 min), single-resource download token: the mobile app now calls `/documents/{id}/download-link` (or `/grievances/{id}/attachments/{id}/download-link`) with a normal authenticated request first, gets back a url with `?dl_token=...`, and opens *that* via `Linking.openURL` — no header needed for the second hop. See `app/core/security.py` (`create_download_token`/`decode_download_token`) and `app/api/deps.py` (`CurrentUserForDocumentDownload`/`CurrentUserForAttachmentDownload`). Web frontend was unaffected (its axios client already attaches the header on every request, including downloads).
- **Voice transcription has a round-trip delay** (record → upload → transcribe → respond), not real-time streaming, since it goes through a server-side Whisper call rather than on-device recognition.
- **The 4 seeded government documents are illustrative**, not an exhaustive or currently-accurate legal reference. Treat them as a working example of the RAG pipeline, not a production knowledge base — expand `backend/rag/sample_docs/` with verified current documents before relying on this for real welfare guidance.
- **The RAG chatbot's vector index is FAISS on local/attached disk** (persisted via a Docker volume), not a managed vector database. Fine at this scale (a handful of government documents); if the document corpus grows into the thousands, a managed vector DB would scale better, but that's a genuine scale problem to have, not a bug today.
