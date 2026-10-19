# ShramSetu — Presentation Notes (deck vs. code, verified 2026-10-12)

Companion to the deck `ShramSetu_Final.pdf`. Every claim below is checked against
the running repo (server/, ai-service/, frontend/). Numbers are the ones you can
reproduce live — see the commands at the bottom.

---

## Slide 6–7 — Proposed Solution (what to say, what is provably true)

| Deck claim | Verdict | Evidence in code |
|---|---|---|
| Six languages: English, Hindi, Bengali, Telugu, Tamil, Malayalam | ✅ True | `frontend/src/i18n/locales/` (6 bundles, parity-tested), accepted by server + AI service |
| Ask by text or voice | ✅ True | `ai-service/app/services/stt_service.py` (faster-whisper, per-language fine-tuned checkpoints) + TTS (`tts_service.py`, IndicParler-TTS with local MMS VITS fallback) |
| Retrieve from indexed official documents | ✅ True | FAISS index over `ai-service/rag/sample_docs/`, **62 active docs (11 superseded skipped)**, each with provenance header (source URL, verification date, status) |
| Answer constrained to retrieved evidence | ✅ True | `rag_service.answer_question`: similarity gate → BM25/RRF rerank → Groq with numbered sources; a `grounded=false` refusal is returned whenever evidence is insufficient |
| Show source metadata or explicit no-match | ✅ True | Citations carry `source_document`, `government_department`, last-verified date + "informational only, not legal advice" disclaimer (`_disclaimer`) |
| Secure worker document wallet | ✅ True (say *how*) | AES-256-GCM per file, per-file keys wrapped under `DOC_MASTER_KEY` (`wrapped:v1:`). **If asked about the wallet PIN: it is screen-lock convenience only, not encryption — the docs say so deliberately** |
| Portable employment and salary records | ✅ True (with caveat) | `server/src/models/WageEntry.js` + `/api/v1/wages`; paid-day is locked (409). **Caveat to volunteer: wage entries are self-reported, nothing verified against employers** |
| Grievance submission with attachments | ✅ True | `routes/grievances.js`; magic-byte validated uploads (PDF/JPEG/PNG/WEBP) |
| **Category-based routing to Labour or Police Department "mailbox"** | ⚠️ **Overstated — fix the wording** | Actual: grievances route to **jurisdiction-scoped officials** (state/district, fail-closed `scope.js`) with a status workflow (Submitted → UnderReview → ActionTaken/Rejected → Escalated), in-app worker notifications, and an audit log. A `department` field exists on officials/notifications, but **there is no Labour/Police dispatch and no SMTP e-mail routing anywhere in the server code** |
| Source traceability + privacy controls | ✅ True | Provenance headers + PII stripped before *any* external AI call (`pii.py`); audit log for government actions (append-only in-app) |

**One-line framing that always scores:** "Everything on this slide is implemented;
the only wording I correct is 'routed to a department mailbox' — in the build
grievances route to the right *official* by filing-time jurisdiction, which is
stronger than a mailbox because it is enforceable, tested, and audited."

---

## Slide 8 — System Architecture (say the real architecture)

```
Browser (React 18 + TS PWA, 6 languages)
      │ REST + JWT   (never calls the AI service directly)
      ▼
Express API :8000  (Node 22, Mongoose 8)
  auth (OTP + JWT, rate limits) · fail-closed jurisdiction scoping
  grievances · document wallet (AES-256-GCM) · AI proxy (X-Internal-Key)
      │                         │
      ▼                         ▼
MongoDB :27017            FastAPI AI :8100 (Python 3.10)
workers·grievances        RAG: multilingual embeddings → FAISS
documents·wages·audit     → gate ≥0.45 → BM25/RRF → Groq LLM
notifications             STT faster-whisper · TTS local · PII strip
```

Three talking points, all provable:

1. **Why a separate Python AI service:** FAISS/SentenceTransformers/faster-whisper
   have no mature Node equivalents; failure isolation (a 2 GB model crash must not
   take auth/grievances down); different scaling profile.
2. **Browser never touches the AI service:** only Express calls it, and every call
   carries `X-Internal-Key`. Provider keys never leave the server.
3. **Fail-closed scoping:** an official's jurisdiction is a query filter, not a UI
   filter — out-of-scope records return 404 (not 403) so they aren't even
   discoverable. Locked by 40 dedicated security tests.

⚠️ **The SQL/SQLModel diagram on this slide is a leftover from the old design.** The
python-single-backend version was replaced by Node/Express + MongoDB — say so
proactively if the examiner compares against the proposal.

---

## Slide 9 — Use Case Diagram (what the actors can actually do)

- **Worker:** register with OTP (hashed, expiring, only printed to the dev
  terminal) · pick one of 6 languages · ask questions by text *or voice* and hear
  answers back (TTS) · upload documents into the encrypted wallet · keep a wage
  diary (with a one-click pre-filled unpaid-wages grievance) · view the QR digital
  ID · file & track grievances · read notifications.
- **Government official:** dashboard scoped by jurisdiction (state = all its
  districts; district = that district only) · act on grievances within the
  workflow and its SLA dates · send notifications (never out-of-scope —
  rejected with 403).
- **Superadmin:** everything + audit logs + officials monitoring.
- **System (hidden actor):** the RAG assistant — retrieves, gates at 0.45
  similarity, refuses with `grounded=false` when evidence is insufficient.

Every edge in that list maps to a route in `server/src/routes/` and a test.

---

## Slides 12–13 — Methodology (10 steps, all implemented except one word)

Steps 1–7, 9, 10 are implemented as written: OTP/JWT access → text/voice intake →
extract/chunk/index with provenance → multilingual embedding + FAISS top-k →
relevance threshold with explicit no-match → grounded generation with
source/department/freshness metadata → worker records → authenticated APIs with
owner-based access → evaluation.

**Step 8 correction (same as slide 6):** grievances capture category, description
and evidence and are routed **to jurisdiction-scoped officials**, not to a
"department mailbox". Say it that way and the slide stays true.

---

## Slides 17–24 — Results: the exact numbers you may quote

| Metric | Value | Where it comes from |
|---|---|---|
| Corpus | 62 active docs indexed, 11 superseded correctly skipped | `rag/` loader, eval header |
| hit@1 (49 factual Qs) | **46/49 = 94 %** | `eval/ANALYSIS.md` headline table |
| hit@3 | **48/49 = 98 %** | same |
| Off-topic + injection refused at retrieval | **12/13** | same |
| End-to-end safety (live LLM, 10-question set) | **10/10 refused, 0 system errors** | `eval/RESULTS_FULL.md` |
| Test suites | server 49/49 · AI service 92/92 · frontend 50 · 34 live E2E checks | `VIVA_QA.md` §9 |
| Frontend entry JS | 592 → 406 kB (−31 %) after code-splitting | `VIVA_QA.md` §6 |

**Honest-limits sound bites (volunteer these; defended limitations score well):**
- The one remaining hit@3 miss is a measured **translation** failure (MGNREGA
  machine-translated as "Resource Employment Program"); hand-translated the same
  query hits the right doc at 0.641 as top-1. Fixed by better translation, not by
  lowering the 0.45 gate — lowering it would leave only 0.008 margin over the
  off-topic band.
- Cold start is ~30 s, bounded at 90 s (`WARMUP_WAIT_SECONDS`); readiness vs
  liveness split explains it in one sentence.
- No real SMS gateway (OTP prints to the dev terminal), no browser-E2E suite,
  in-process rate limiting, no backups/DR.
- 8 in-domain "unanswerable" questions are refused by the LLM's `grounded` flag,
  which retrieval-only eval cannot measure — don't quote a number for those.

⚠️ **Do not screenshot `eval/RESULTS.md` right now.** It was **regenerated** on
2026-10-04 from an ad-hoc 25-question run (translation off) and shows hit@1 72 %,
which contradicts the deck's 94 %. Before the presentation either re-run
`python -m eval.run_eval` with the default 70-question set (≈30 s, no API key; it
overwrites RESULTS.md with the 94/98 figures) or cite `ANALYSIS.md`. Cite
`RESULTS_FULL.md` for the live-LLM 10/10 safety run.

---

## Slide 16 — Software Requirements: three corrections before you present

| Deck says | Reality | Fix on the slide |
|---|---|---|
| Python FastAPI + **SQLModel**, JWT | FastAPI yes (AI service only); the backend is **Node/Express + Mongoose 8** | Replace |
| **PostgreSQL** prod / SQLite dev | **MongoDB** (embedded dev instance or real server; Docker volume `mongo_data`) | Replace |
| **SMTP** for notifications | No SMTP anywhere in the code. Notifications are an in-app inbox; FCM token endpoint exists but real push is future work | Downgrade honestly |
| React Native + Expo companion client | The active repo ships the PWA; the RN app exists only in an old backup zip at the workspace root | Say "PWA (installable), mobile client is native wrapper work" |

React/TS/Vite/Tailwind, LangChain+Sentence-Transformers+FAISS+Groq, and
Whisper-based transcription: ✅ all true as written.

---

## Slide 25 — Conclusion: the one-line pitch

*"ShramSetu is a worker-facing platform where every AI answer is either grounded
in a cited, dated official document or explicitly refused; records live encrypted
under the worker's own account; and grievances reach the official with real
authority over the filing jurisdiction. It deliberately does not replace official
verification — it makes the evidence reachable."*

---

## Reproduce everything live (during the viva)

```bash
cd server     && npm test                                # 49 passed
cd frontend   && npm test                                # 50 passed
cd ai-service && venv/Scripts/python -m pytest           # 92 passed
cd server     && npm run verify                          # 34 live checks, both services
cd ai-service && venv/Scripts/python eval/run_eval.py    # regenerates RESULTS.md with the 94/98 numbers
```

Demo logins: `ADMIN001/Admin@123`, `KL001/Kerala@123`, `EKM001/Ernakulam@123`,
workers `9555500101…110` / `Worker@123` (dev-seeded; try asking EKM001 about a
Kochi-vs-Kollam grievance to *demonstrate* scoping).
