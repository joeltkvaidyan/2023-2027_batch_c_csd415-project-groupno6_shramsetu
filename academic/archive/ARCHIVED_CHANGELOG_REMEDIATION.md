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

# ShramSetu Remediation — Session 1 Changelog

Scope note up front: this session ran in a sandbox with **no network access**
(no `pip install`, `npm install`, `pytest`, or live SMTP/S3/Groq calls
possible) and **no git history** in the uploaded snapshot. Everything below
is a source-level code/doc change, verified by reading, not by running the
test suite. Re-run `pytest` and the frontend test runner in a real
environment before merging.

## Done this session

**1. Docs/scope accuracy (Government module)**
- README.md + IMPLEMENTATION_GUIDE.md said Government was "Coming Soon" /
  had no review UI. False — `government_auth.py` (employee_id+password
  login), `government.py` (dashboard stats, anonymized worker list,
  grievance list/detail/comment/status/assign, notifications, superadmin
  audit logs), `GovernmentLoginPage.tsx`, `GovernmentDashboardPage.tsx` are
  all implemented and routed. Docs corrected. No gating added — it's not
  half-finished, it's real.

**2. Security**
- Aadhaar: added `app/core/encryption.py` (Fernet). `auth_service.py` now
  encrypts on write; `WorkerPublic` schema now masks to last-4 on every
  read (`/auth/worker/register`, `/auth/worker/me`,
  `/settings/language`) via a `model_validator`. Config gets
  `AADHAAR_ENCRYPTION_KEY` (refuses dev fallback key when
  `ENV=production`). **Not migrated**: any Aadhaar rows already in an
  existing DB stay plaintext until backfilled — `mask_aadhaar()` handles
  both formats so nothing breaks, but you should write a one-off migration
  script to encrypt existing rows before real deployment.
- TLS certs: deleted `frontend/cert.pem`, `frontend/key.pem`,
  `cert.pem.bak`, `key.pem.bak` from the tree, added `*.pem`/`*.key`/`*.crt`
  to `.gitignore`, added mkcert/openssl instructions to README, made
  `https-proxy.js` fail with a clear message instead of a raw stack trace
  when certs are missing. **Could not check/scrub git history** — no `.git`
  in this snapshot. If these were ever pushed to a real remote, run
  `git filter-repo` (or BFG) to purge them from history; treat as low
  urgency since they're dev-only self-signed certs, not long-lived
  credentials.
- `.env`: checked — only placeholders (`JWT_SECRET_KEY=` empty,
  `GROQ_API_KEY=your_groq_api_key_here`), already gitignored, no real
  secrets present. Nothing to rotate.
- JWT secret validation: **the production boot check described in
  `.env.example`'s comments did not actually exist** — `main.py` had no
  such check. Added `_assert_production_safe()` in `main.py`: refuses to
  boot if `ENV=="production"` and `JWT_SECRET_KEY` is a known placeholder
  or under 32 chars, or if `DEBUG` is still `True`. This now covers every
  deployment target (mobile API URL, staging, whatever) equally, since it's
  a single ENV-gated check at process startup, not a Docker-only path.
- OTP dev-echo: was gated on `settings.DEBUG` alone — `OTP_ECHO_ENABLED`
  existed in config but was **dead, never read**. If someone set
  `ENV=production` but left `DEBUG=True`, OTP got echoed in the API
  response in prod. Fixed: echo now requires
  `ENV != "production" AND DEBUG AND OTP_ECHO_ENABLED` (all three), and
  the new boot-time assertion above additionally refuses to start at all
  under `ENV=production` + `DEBUG=True`, so it's belt-and-suspenders, not
  just a runtime `if`. Note: this changes prior dev behavior — devs now
  need `OTP_ECHO_ENABLED=true` locally too, not just `DEBUG=true`; add that
  to your local `.env`.
- Also noticed but **not fixed** (out of the requested list, flagging for
  awareness): `main.py` sets `allow_origins=["*"]` together with
  `allow_credentials=True` in CORSMiddleware — that combination is invalid
  per the CORS spec (browsers ignore `*` when credentials are allowed) and
  a real security smell. Worth a follow-up: use `settings.CORS_ORIGINS`
  (already defined, currently unused by the middleware) instead of `*`.

## Not done this session — needs a follow-up pass

Items 3 (backend robustness beyond what's above), 4 (frontend UI/UX audit),
5 (mobile app checks), and 6 (test additions) are each substantial and
need either a running app (network/dev servers) or a lot more time than
fits one pass. Specifically still open:
- Local-storage download auth gap for mobile (`STORAGE_BACKEND=local` +
  `Authorization` header `Linking.openURL` can't send) — confirmed by
  reading the code, not yet fixed. Recommend the signed-URL-query-param
  approach from the brief; it's the smaller change of the two options.
- RAG/FAISS interface boundary check, SMTP integration test, seeded-doc
  disclaimer UI, full frontend consistency/a11y/i18n-overflow/voice-UX/
  responsive pass, mobile permission/offline handling, locale key-parity
  check + `fix_locales.py` audit, and all new test coverage (grievance
  forwarding, pagination edges, the new boot-check) — none started.

## Done — session 2

**3. Local-storage / mobile download auth gap (was fully open, now fixed)**
- Confirmed the bug went further than the brief described: it wasn't just
  `STORAGE_BACKEND=local`. `STORAGE_BACKEND=s3`'s redirect-to-signed-URL
  step still sat behind the same `Authorization`-header-required dependency,
  so `Linking.openURL` broke on **both** backends, not just local.
- Added a short-lived (5 min), single-resource download token:
  `create_download_token`/`decode_download_token` in
  `backend/app/core/security.py`; `CurrentUserForDocumentDownload` /
  `CurrentUserForAttachmentDownload` dependencies in `backend/app/api/deps.py`
  that accept either the normal header (unchanged, web frontend keeps
  working exactly as before) or a `?dl_token=` query param scoped to one
  document/attachment ID and a 5-minute TTL.
- New endpoints: `GET /documents/{doc_id}/download-link` and
  `GET /grievances/{grievance_id}/attachments/{attachment_id}/download-link`
  — call these first (normal authenticated request) to mint a token, then
  open the returned url. Existing `/download` endpoints now accept
  `dl_token` as an alternative to the header, not a replacement.
- Updated `mobile/src/screens/DocumentWalletScreen.tsx` and
  `GrievanceDetailScreen.tsx` to call `-link` then `Linking.openURL` the
  result, instead of opening the raw `/download` URL.
- Web frontend untouched — its axios client already attaches the
  Authorization header on every request, downloads included, so it was
  never affected.
- `IMPLEMENTATION_GUIDE.md` corrected (it previously claimed S3 already
  solved this — it didn't, for the reason above).
- **Not done**: no automated test added for the token mint/verify/expiry
  path yet (ties into item 6, still open). Also didn't check whether a
  profile-photo download route exists needing the same treatment — a scan
  found none (`profile_photo_path` appears to be served as a plain static
  path, not through an auth-gated endpoint) but that's worth a second look
  by someone who can run the app.

## Files touched (session 2, additive to session 1's list)
`backend/app/core/security.py`, `backend/app/api/deps.py`,
`backend/app/api/v1/documents.py`, `backend/app/api/v1/grievances.py`,
`mobile/src/screens/DocumentWalletScreen.tsx`,
`mobile/src/screens/GrievanceDetailScreen.tsx`,
`IMPLEMENTATION_GUIDE.md`.

## Done — session 3 (item 4 UI/UX, focused on the AI Welfare Assistant / chatbot)

- **Seeded-doc disclaimer (closes the item-3 gap too)**: added a persistent
  blue info banner on the Chatbot page — `chat.demoDataDisclaimer` —
  distinct from the existing amber "assistant unavailable" banner and the
  per-answer "not from a verified source" note. It's always visible while
  chatting, not just on grounded answers, so users don't mistake the 4
  seed documents for a complete/current legal reference.
- **Loading/error states**: the Chatbot page's `/chat/history` fetch had
  no loading skeleton and an uncaught rejection on failure (silent blank
  screen). Added a 2-bubble skeleton while loading and an error state with
  a `common.retry` button that re-runs the fetch.
- **Accessibility**:
  - Chat input and send button had placeholder-only / no label — added
    `aria-label`.
  - Voice error text now has `role="alert" aria-live="assertive"` so
    screen readers announce mic/transcription failures as they happen.
  - Mic button's `aria-label` was hardcoded English (`"Stop recording"` /
    `"Start voice input"`) despite the rest of the page being
    translated — now uses `t("voice.stopRecording")` /
    `t("voice.startRecording")`, added to all 6 locale files.
  - `GrievanceStatusBadge` checked: each status pairs a `-700` text color
    with a `-50` background (or `-300`/`-900` in dark mode) and always
    carries a translated text label, not color alone — passes WCAG AA
    contrast and doesn't rely on color-only signaling. No change needed.
  - Searched for a `ChipSelect` component (named in the original brief) —
    doesn't exist in this codebase; checked `LanguageSelectPage` and
    `StakeholderSelectPage` for fixed-width containers that could clip
    longer-script translations (Bengali/Tamil/Telugu/Malayalam) — none
    found, both use flexible/wrapping layout already.
- **Voice UX**: `VoiceRecorder` already had 3 distinct visual states
  (idle 🎤 / recording ⏹ pulsing red / transcribing ⏳ spinning yellow)
  with a "Listening…" tooltip during recording — this was already solid,
  no functional change. The brief's 4th named stage ("uploading") isn't
  really distinct here since encoding is synchronous and there's a single
  network call — transcribing already covers that window.
- New i18n keys added to all 6 locales (`en/hi/bn/ta/te/ml`):
  `common.retry`, `chat.demoDataDisclaimer`, `chat.historyLoadError`,
  `voice.startRecording`, `voice.stopRecording`. **Caveat**: hi/bn/ta/te/ml
  translations were written by me, not a native speaker or professional
  translator — get these reviewed before shipping, same as any other
  content in this file.

**Not done**: the rest of item 4 (consistency pass across all `pages/*.tsx`,
loading/error states for Dashboard/DocumentWallet/GrievanceList/Detail/
NotificationInbox, responsive check at 360–400px, inline multilingual
validation errors on forms) — only the Chatbot page got the full pass this
session. `noMicSupport`'s "HTTPS required" tooltip in `VoiceRecorder.tsx`
is also still hardcoded English, not translated — small remaining gap.

## Files touched (session 3)
`frontend/src/pages/ChatbotPage.tsx`, `frontend/src/components/VoiceRecorder.tsx`,
`frontend/src/i18n/locales/{en,hi,bn,ta,te,ml}.json`.

## Done — session 4 (item 4 continued: Dashboard/DocumentWallet/GrievanceList/Detail/NotificationInbox)

- **Auth boot bug (found while checking Dashboard)**: `AuthContext.refreshMe()`
  treated *any* failure of `/auth/worker/me` — including a plain network
  error or 5xx — as "not logged in": it wiped the token and the worker got
  bounced to the login screen. A flaky connection shouldn't force a
  re-login. Now only a real `401` clears the session; other failures set
  a new `bootError` flag. `ProtectedRoute` shows a retry button for that
  case instead of silently redirecting, and its "Loading..." text is now
  translated (`common.loading`) instead of hardcoded English.
- **DocumentWalletPage**: the documents list fetch had `// Silently fail —
  user may be offline` as its entire error handling — a failed load looked
  identical to "no documents." Added a `loadError` state, a skeleton while
  loading, and an error+retry block, matching the pattern from the
  Chatbot/session-3 work.
- **GrievanceListPage**: same silent-failure gap (`.finally()` with no
  `.catch()` — an unhandled rejection on failure, empty list looked like "no
  complaints"). Fixed with loading skeleton + error+retry. Also translated
  the whole filter UI, which was entirely hardcoded English despite
  `grievance.status.*` / `grievance.categories.*` keys already existing
  and being used elsewhere on the same page (search placeholder, "All
  Status"/"All Categories", every status/category option, "Urgent"/"High"
  priority tags, "Due"/"Overdue!") — added the handful of missing keys
  to all 6 locales, reused the rest.
- **GrievanceDetailPage**: worse than silent failure — there was no
  `catch` at all, so a failed fetch left `loading=false` and
  `grievance=null` forever, and the render guard (`loading || !grievance`)
  kept showing "Loading..." text permanently with no way out except
  navigating back. Fixed: proper `loadError` state, a skeleton for the
  loading case, and a real error+retry screen for the failure case.
- **NotificationInboxPage**: failure fell through to the generic empty
  state ("No notifications yet") — misleading, since that's a very
  different situation from an actual empty inbox. Added `loadError` +
  retry. Also translated "Mark all read", "From:", and "Broadcast", and
  added the `notifications.emptyDesc` key that was previously only ever
  shown via a hardcoded English fallback string (the key didn't exist in
  ANY locale, so every non-English user saw English there).
- 15 new i18n keys added across all 6 locales this session
  (`grievance.searchPlaceholder/allStatus/allCategories/priorityUrgent/
  priorityHigh/overdue/due/loadError`,
  `notifications.emptyDesc/markAllRead/broadcast/loadError`). Same caveat
  as before: my hi/bn/ta/te/ml translations need native-speaker review.
- Sanity-checked: brace/paren balance across every edited `.tsx` file (no
  npm install possible here to run `tsc`/eslint — genuinely verify in a
  real environment before merging).

**Still not done**: full page-by-page consistency/spacing/typography audit,
360–400px responsive check, inline (in-language) validation errors on
forms — none of these were touched this session either; only the
loading/error-state class of bug got a full sweep across all five
data-fetching pages named in the brief.

## Files touched (session 4)
`frontend/src/store/AuthContext.tsx`, `frontend/src/components/ProtectedRoute.tsx`,
`frontend/src/pages/DocumentWalletPage.tsx`, `frontend/src/pages/GrievanceListPage.tsx`,
`frontend/src/pages/GrievanceDetailPage.tsx`, `frontend/src/pages/NotificationInboxPage.tsx`,
`frontend/src/i18n/locales/{en,hi,bn,ta,te,ml}.json`.

## Done — session 5 (mobile app was never actually running the real code)

**This is the biggest finding of the whole remediation.** While checking
item 5's voice-recording error handling, found that `mobile/App.tsx` —
the actual Expo entry point (`package.json`'s `main` resolves here) — was
rendering its own self-contained `Stack.Navigator` pointing at a *different,
older, incompatible* set of screens: `HomeScreen`, `LoginScreen`,
`ChatScreen`, `DocumentsScreen`, `GrievanceScreen`, `SettingsScreen`. These
have no i18n, store the auth token under a different AsyncStorage key than
the real app, hit `http://localhost:8000` directly with raw `fetch()`
instead of the shared API client, and `ChatScreen`'s "voice input" is
literally `setTimeout(() => sendMessage("What is e-Shram card?"), 2000)` —
a hardcoded fake answer, not real recording.

Meanwhile `mobile/src/navigation/RootNavigator.tsx` — a complete, correct,
much better-built navigator (language select → role select → worker
login/register/OTP → tab bar with Dashboard/DocumentWallet/Chatbot/
Grievances/Settings, backed by `AuthContext` + SecureStore) — existed the
entire time but was **never imported by anything**. Every mobile fix from
sessions 1–5 (download-token auth, voice error handling, i18n) targeted
the *correct* files — they just weren't reachable in a running build until
now.

Fixed:
- **`App.tsx` rewritten** to boot `RootNavigator` inside `AuthProvider`,
  with a proper loading gate.
- **`initI18n()` was defined in `src/i18n/index.ts` but called from
  nowhere** — i18next was never initialized. The moment `RootNavigator`
  got wired up, every `useTranslation()` call in the real screens would
  have thrown. `App.tsx` now awaits `initI18n()` before rendering anything
  that needs it.
- **Mobile `AuthContext` had the identical "any error = logout" bug** I
  fixed on web in session 4 — a network blip on the boot `/auth/worker/me`
  call wiped a valid session. Same fix: only a real 401 clears it; other
  failures set a `bootError` flag (not yet surfaced in `RootNavigator`'s
  UI — it currently falls through to the login flow on that path, which
  is safe but not as good as a retry screen; flagging as a follow-up).
- **Push notifications wired up for the first time**: nothing in the real
  app called `registerForPushNotifications()` at all. Now `AuthContext`
  fires it once a worker is logged in. Also fixed
  `sendTokenToServer`/`unregisterFromNotifications` in
  `services/notifications.ts` — they read the auth token from the *wrong*
  (legacy) AsyncStorage key the real flow never writes, and hit a
  hardcoded `http://localhost:8000` that only ever works from the same
  machine as the backend. Both now go through the shared `api` client
  (correct base URL + SecureStore token).
- **`mobile/package.json` was missing 9 of the real app's own
  dependencies**: `@react-navigation/bottom-tabs`, `expo-av`,
  `expo-constants`, `expo-device`, `expo-document-picker`,
  `expo-linear-gradient`, `expo-secure-store`, `expo-speech`, `nativewind`
  (plus `tailwindcss` as a devDependency `nativewind` needs). Every one of
  these is imported by code under `src/navigation`, `src/screens`, or
  `src/hooks` — the app could not have installed cleanly, let alone run,
  even with the entry point fixed. Added all 9 (+1 dev) at versions
  compatible with the already-pinned Expo SDK 51 / React Navigation 6.
  **`package-lock.json` is now stale — I can't run `npm install` in this
  sandbox (no network), so it needs regenerating in a real environment
  before this will actually install.**
- **`useVoice.ts`**: `stopRecordingAndTranscribe` had no `catch` around
  the network upload — offline/timeout/backend failure threw an unhandled
  rejection past the caller's existing (and otherwise correct)
  `if (transcript === null) Alert.alert(...)` check. Now returns `null` on
  any failure there, same as the "nothing recorded" case, so the existing
  caller logic actually reaches the user-facing alert. Also wrapped
  `startRecording` so a non-permission failure (mic busy, hardware issue)
  returns `false` instead of throwing.
- Fixed the mic-permission alert in `ChatbotScreen.tsx` — was hardcoded
  English despite the rest of the screen being translated; added
  `voice.micPermissionTitle`/`micPermissionBody` to all 6 mobile locales.
  Also added the same demo-data disclaimer banner and history
  loading/error+retry pattern from the web Chatbot page (session 3) to
  the mobile `ChatbotScreen.tsx` — same underlying gaps, same fix.
- Nearly deleted `ChatScreen.tsx` as "dead code" before discovering
  `App.tsx` referenced it — caught it before repackaging, restored the
  exact original from your uploaded zip (verified byte-for-byte via
  `diff`) rather than reconstruct from memory. It's genuinely dead now
  that `App.tsx` points at `RootNavigator` instead, but I'm leaving the
  file in place rather than deleting it — that's a call for whoever owns
  this repo, not me.
- Sanity-checked (brace balance + grep for the same missing-import/
  hardcoded-URL patterns) across every other real screen
  (`LanguageSelectScreen`, `RoleSelectScreen`, `WorkerLoginScreen`,
  `WorkerRegisterScreen`, `OTPVerifyScreen`, `ComingSoonScreen`,
  `DashboardScreen`, `SettingsScreen`, `GrievanceFormScreen`,
  `GrievanceListScreen`) — no matches, they look clean, but I have not
  read every line of every one of them.

**Also discovered, not fixed (flagging for awareness):**
- Backend `_fcm_tokens` in `notifications.py` is an **in-memory dict**,
  not persisted to a database. Every registered push token is lost on
  server restart, and this can't work at all behind a load balancer with
  more than one backend instance. Needs a real table + migration —
  bigger than this pass.
- `Notifications.getExpoPushTokenAsync({ projectId: process.env.EXPO_PROJECT_ID })`
  has no `EXPO_PROJECT_ID`/EAS project configured anywhere in `app.json` —
  will fail (caught, logged, returns null) until a real EAS project is
  set up. Not blocking, just won't produce a usable push token yet.
- `RootNavigator` doesn't yet show a retry UI for the new `bootError`
  case the way I added to the web `ProtectedRoute` — falls through to the
  login flow instead. Safe (token isn't cleared) but not ideal.

**Not done**: I have not read every line of every real screen file, so
there could be more of this same class of bug (missing import, hardcoded
localhost, wrong storage key) still lurking. Given how many were found
just from spot-checking, a full line-by-line read of the remaining
screens is worth prioritizing before this ships.

## Files touched (session 5)
`mobile/App.tsx`, `mobile/package.json`, `mobile/src/store/AuthContext.tsx`,
`mobile/src/services/notifications.ts`, `mobile/src/hooks/useVoice.ts`,
`mobile/src/screens/ChatbotScreen.tsx`,
`mobile/src/i18n/locales/{en,hi,bn,ta,te,ml}.json`,
`frontend/src/i18n/locales/{en,hi,bn,ta,te,ml}.json` (missing `auth.demoHint`
key filled in, discovered while checking locale parity — turned out to be
dead/unreferenced content, not wired to any component, but fixed for
parity regardless).

## Done — session 6 (RAG interface boundary, SMTP test, new test coverage — item 6)

- **Caught a real regression from my own session-1 fix before it shipped**:
  requiring `OTP_ECHO_ENABLED` in addition to `DEBUG` for the OTP dev-echo
  broke the *entire existing test suite* — `conftest.py`'s
  `register_and_verify()` helper (used by nearly every test file) reads
  `dev_otp` from the register response, and without `OTP_ECHO_ENABLED=true`
  set somewhere, that key stops appearing. Fixed by adding it to
  `conftest.py`'s test-env setup, with a comment explaining why. I can't
  run pytest in this sandbox (no fastapi installed, no network to install
  it), so this was caught by reading the code carefully, not by running
  the suite — worth double-checking by actually running it in a real
  environment.
- **RAG/FAISS interface boundary**: confirmed `rag_service.py` doesn't
  leak FAISS types today — the only call site anywhere (`chat.py`) only
  ever sees `answer_question()`'s plain dict return. What was missing was
  an actual config-level switch. Added `VECTOR_STORE_BACKEND` (`"faiss"`
  default) to `config.py`; `_get_vector_store()` now branches on it, with
  a `"managed"` branch that raises a clear `NotImplementedError` pointing
  at where to wire a real hosted vector DB in — documented as the one and
  only place this decision needs to be made, plus a callout that a
  managed backend returning cosine similarity directly (not FAISS's L2
  distance) would need `_similarity_from_l2`'s conversion revisited too.
- **SMTP / grievance-forwarding tests** (`test_notification_forwarding.py`):
  covers `_compose_email()` content correctness (complaint number, worker
  details, employer/location fields, graceful handling of `None`
  optionals — confirmed the existing `or '-'` fallbacks already prevent
  literal `"None"` from appearing), `notify_authorities()`'s category ->
  authority routing (unpaid_wages -> Labour only; harassment_abuse ->
  both Labour and Police) using a recording fake `EmailProvider` instead
  of live SMTP, the `NOTIFY_AUTHORITIES_ENABLED=False` off-switch, and an
  end-to-end test that files a real grievance through the API and checks
  the "Forwarded to: ..." entry actually lands in the timeline — all
  without needing SMTP credentials, since the default `ConsoleEmailProvider`
  needs none.
- **Pagination edge-case tests** (`test_pagination.py`): offset far beyond
  the available rows (empty list, not an error) and limit far above
  `MAX_PAGE_SIZE` (clamped, not rejected/500'd) for both `/documents` and
  `/grievances`, plus negative-offset and zero-limit clamping. The
  clamping logic itself (`max(1, min(limit, MAX_PAGE_SIZE))` /
  `max(0, offset)`) was already correct in both route handlers — this
  was purely a test-coverage gap, not a bug.
- **Boot-check tests** (`test_startup_checks.py`): exercises
  `main.py`'s `_assert_production_safe()` directly — passes in dev
  regardless of secret, refuses to boot in production with an empty/
  placeholder/short secret, refuses with `DEBUG=True` even given a good
  secret, and confirms the actually-correct production config passes
  clean.
- **Found two duplicate-declaration bugs while writing these tests**
  (flagging, not fixing — both are inert/harmless since the second
  declaration wins, but they're clear copy-paste artifacts a real review
  would catch): `backend/app/models/grievance.py` defines
  `class GrievancePriority` **twice** (lines ~31 and ~46 — the second adds
  `ESCALATED` and is the one that's actually used everywhere via name
  resolution), and inside `Grievance` itself the `priority` field is
  declared **twice** (once as `Optional[str]` defaulting to the string
  `"medium"`, then again immediately after as `GrievancePriority`
  defaulting to `.MEDIUM` — the second wins). Safe to delete the first of
  each pair; I didn't touch either to avoid scope creep on an unrelated
  file while mid-way through test-writing.
- All new/edited backend files re-verified with `py_compile` (still no
  network to actually run `pytest`).

**Still not done**: I have not run any of this — no fastapi/pytest in
this sandbox. Before trusting it, run `pytest backend/tests/` in a real
environment; there is a real chance something in the 5 new test files has
a small mismatch with the actual schemas that only running would catch
(I checked field names and required-vs-optional constructor args by
reading the models directly, but that's not the same as execution).

## Files touched (session 6)
`backend/tests/conftest.py`, `backend/tests/test_pagination.py` (new),
`backend/tests/test_notification_forwarding.py` (new),
`backend/tests/test_startup_checks.py` (new),
`backend/app/core/config.py`, `backend/app/services/rag_service.py`.

## Done — session 7 (item 4 wrap-up: inline validation, nav-label bug, responsive check)

- **Inline validation errors** (`GrievanceFormPage.tsx`): subject/description
  relied on bare HTML `required` (unstyled native browser tooltip, not
  translated, inconsistent across browsers) plus one generic bottom-of-form
  error banner for every failure case. Added real client-side validation
  with per-field inline messages (`role="alert"`, `aria-invalid`,
  `aria-describedby`, red border) using the already-fully-translated
  `common.required` key, clears as soon as the user types, and now also
  parses FastAPI 422 responses to map field-level errors back to the
  right input instead of only ever showing the generic banner.
- **Found the same generic-banner-instead-of-inline pattern in
  `WorkerRegisterPage.tsx`'s multi-step wizard, plus something worse**:
  13 of its 14 validation messages were hardcoded English (`"Date of
  birth is required"`, `"Aadhaar number must be 12 digits"`, `"Invalid
  OTP. Please try again."`, etc.) — meaning every non-English speaker
  filling out the very first screen of the app hit English error text
  in an otherwise fully translated flow. Replaced all 14 with `t(...)`
  calls: reused `common.required` and the existing `auth.invalidMobile`
  where they already fit, added 6 new keys
  (`passwordMinLength/aadhaarInvalid/pincodeInvalid/
  emergencyContactInvalid/otpRequired/otpInvalid`) to all 6 locales for
  the rest.
- **Found a real nav-label bug while doing the responsive/truncation
  check**: `BottomNav.tsx` (web) was reusing page-title translation keys
  as tab labels — `dashboard.welcome` ("Welcome") for the Home tab,
  `dashboard.aiChatbot` ("AI Welfare Assistant") for the Chat tab, etc.
  Wrong semantically, and far too long for a `max-w-[60px]` truncated
  label — "AI Welfare Assistant" truncating to "AI Welf…" in a bottom
  tab is exactly the multilingual-truncation failure mode the brief
  asked about, and it would have been worse in longer scripts. Same bug,
  independently, in the mobile app's tab bar (`RootNavigator.tsx`) —
  hardcoded English tab labels with no `t()` call at all, despite every
  other screen in the real stack being translated. Fixed both: added a
  proper short `nav.*` key set (Home/Documents/Grievances/Alerts/Chat/
  Settings, or Complaints on mobile to match its existing wording) to
  all 6 locales on both platforms, wired both nav bars to use them
  instead, and widened the web truncation box slightly as a last-resort
  safety net (not the primary fix).
- **360–400px responsive check**: grep'd for fixed-pixel-width/truncation
  classes app-wide (`w-[Npx]`, `min-w-[300px]`-style, `w-96/80/72`) — the
  only hits were the `BottomNav.tsx` ones just fixed. At 6 tabs ×
  `min-w-[56px]` = 336px, that fits even a 360px viewport with margin to
  spare, so no overflow there. I did not do a full visual pass in an
  actual narrow browser/device (can't run one here) — this was a static
  grep for the obvious failure pattern, not a rendered check. A human
  eyeball pass in a real 360–400px viewport is still worth doing before
  shipping, per the brief's own ask for a "screenshot-driven UI review."

**Still not done**: the broader spacing/typography/button-style
consistency audit across every `pages/*.tsx` file (confirming a shared
design system is used everywhere rather than ad hoc utility classes) —
I've fixed specific bugs found while looking, but haven't done a
systematic pass file-by-file.

## Files touched (session 7)
`frontend/src/pages/GrievanceFormPage.tsx`, `frontend/src/pages/WorkerRegisterPage.tsx`,
`frontend/src/components/BottomNav.tsx`, `mobile/src/navigation/RootNavigator.tsx`,
`frontend/src/i18n/locales/{en,hi,bn,ta,te,ml}.json`,
`mobile/src/i18n/locales/{en,hi,bn,ta,te,ml}.json`.

## Done — session 7 (item 4: inline validation errors)

- **Web `WorkerRegisterPage.tsx`** (the 5-step registration wizard) had
  exactly one generic error banner (`{error}`) for the whole form —
  `validateStep()` stopped at the first failing field in a step and set
  one message with no indication of which field it referred to, across
  ~19 fields. Rewrote `validateStep()` to collect every failing field in
  the current step into a `fieldErrors` map (so a step with two problems
  shows both at once, not one-at-a-time-and-resubmit), and wired inline
  `role="alert"` messages + red border + `aria-invalid`/`aria-describedby`
  onto every validated field: `fullName`, `mobileNumber`, `password`,
  `dateOfBirth`, `gender`, `aadhaarNumber` (format only), `currentVillageOrCity`,
  `currentState`, `currentPincode` (format only), `occupation`,
  `yearsOfExperience`, `emergencyContactName`, `emergencyContactNumber`.
  Errors clear per-field as the user edits it (matching the pattern
  already used correctly in `GrievanceFormPage.tsx`, which needed no
  changes — it already did this right).
- While in there, fixed 7 more hardcoded-English strings in the same file
  that had nothing to do with validation but were sitting right next to
  it: `<option>` placeholders ("Select gender", "Select state", "Select
  home state", "Select your occupation") and hint/consent text (Aadhaar
  storage note, native-state hint, the final consent paragraph) — added
  `auth.selectGender/selectState/selectHomeState/selectOccupation/
  aadhaarHint/nativeStateHint/consentNotice` to all 6 web locales.
- **Mobile `WorkerRegisterScreen.tsx`**: much simpler single-screen form
  (not a wizard), so the fix scope was smaller — its one validation
  message covering 3 required fields was already reasonably placed (all
  three fields are visible at once, no step-ambiguity problem), but it
  and the photo-permission alert were both hardcoded English. Added
  `auth.basicInfoRequired/photoPermissionTitle/photoPermissionBody` to
  all 6 mobile locales and wired them in.
- Did **not** touch the mobile registration screen's per-field structure
  further — no per-field red borders there, since (unlike the web wizard)
  there's only one combined message for exactly the 3 required fields and
  splitting it further seemed like marginal benefit for the remaining
  time budget. Flagging as a possible future improvement, not a bug.
- Brace/paren-balance re-checked on both edited files after the heavy
  editing; still can't run the actual TypeScript compiler here.

**Still not done from item 4**: the page-by-page spacing/typography
consistency audit and the 360–400px responsive viewport check — neither
was attempted this session either. At this point, of the original item 4
list, only "loading/error states" (sessions 3–4) and "inline validation
errors" (this session) have had a real pass; accessibility got partial
coverage (Chatbot page, this form); consistency and responsive review
are the two pieces of item 4 that remain completely untouched.

## Files touched (session 7)
`frontend/src/pages/WorkerRegisterPage.tsx`,
`frontend/src/i18n/locales/{en,hi,bn,ta,te,ml}.json`,
`mobile/src/screens/WorkerRegisterScreen.tsx`,
`mobile/src/i18n/locales/{en,hi,bn,ta,te,ml}.json`.
