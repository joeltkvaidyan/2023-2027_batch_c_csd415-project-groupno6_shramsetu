# ShramSetu — Social Impact Document

**Date:** 2026-10-20 · **Revised:** 2026-10-22 (phases A–C) · **Companion to:** [RESEARCH_AND_GAP_REPORT.md](RESEARCH_AND_GAP_REPORT.md) · All figures year-stamped and sourced there.

---

## 1. Thesis: access, not registration

India now measures migrant welfare by **registration counts**; nobody measures **benefits received**. e-Shram crossed **31.78 crore** registrations by July 2026 (PIB) with no published outcome data, and Kerala's AAWAZ card reached **under 0.1% of cardholders** over four years in actual medical benefits (News Minute 2022). Registration is bookkeeping; the unmet need is the **last mile**: knowing what your card is for, which hospital takes it, which form to file, and which authority converts unpaid wages into a claim — in your own language.

ShramSetu is therefore scoped as an **access layer**, deliberately not another registry:

> A multilingual, voice-first assistant and evidence kit that converts what a worker *has* (a card, a phone, a counted wage day) into what the worker *claims* (a filed grievance, an understood entitlement, an escalated dispute).

## 2. Evidence → response → measurable outcome

| # | Society's problem (evidence, dated) | ShramSetu response (shipped) | Social metric the platform can produce |
|---|---|---|---|
| 1 | **Access, not registration.** 73.3% of 1,824 surveyed workers had trouble accessing welfare; 86.4% no written contract; 57.6% cash wages (SIIMS 2026, UNFPA–IIMAD) | AI Welfare Assistant: grounded RAG over cited government documents, with **voice in/out in 6 languages** and honest refusals when sources don't cover a claim | Share of included workers whose questions are answered with a cited source (per-language, in `eval/RESULTS.md`) |
| 2 | **Workers don't know what their card does** (AAWAZ ~0.07% benefited; causes: card seen as work ID, empanelled hospitals unknown, Malayalam/English-only outreach) | KB answer "What does AAWAZ cover / is it active / how to claim" with **honest uncertainty language** (`kerala-aawaz-health-scheme.txt`); Service Directory with jurisdiction-scoped official services | # of sessions that surface an empanelment/claim step the worker did not know; refused-claim prefill to authority list |
| 3 | **Wage theft is the top complaint** — 98% of 1,093 Kochi Labourline complaints were unpaid wages, with weak evidence because workers kept no records | **Wage Diary** (paid-day locked, tamper-evident upsert discipline) → **pre-fills the unpaid-wages grievance** from the recorded days | Wage days recorded before dispute; grievance draft completeness (days × amounts attached); document the intent in every viva: records = evidence |
| 4 | **New rights are unclaimable if unknown.** Final Labour Code Rules (8 May 2026): GRC mandatory at 20+ workers; contract-labour grievance → principal employer's committee → Inspector-cum-Facilitator after 30 days | KB document `labour-codes-grievance-path-2026.txt` with the escalation path, the 30-day clock, and reminders to keep records from day one | Sharable fact: a worker can now recite who to go to and when their case escalates |
| 5 | **Heat safety is advisory-only** (MoLE nationwide heatwave advisory, 28 Apr 2026, non-binding) | Worker-side heat guidance in the worker's language (work scheduling, water/rest rhythm, buddy system, red-flag symptoms) + home-screen entry point (`heat-stress-advisory.txt` + dashboard tile) | Heat-guidance sessions during IMD heat-alert periods; no dependency on employer compliance |
| 6 | **Recruitment scams** (fees, withheld IDs, mismatched promises) | Explainable **scam checker** checklist + fee-warning banner in job matches | Scam checks run before job applications from the platform |
| 7 | **Jurisdiction confusion** — which office, which number (155214 is Karnataka's, not Kerala's — registry-banned) | **Government dashboard** with strict state/district scoping; KB carries verified helpline numbers | Zero unverified helpline numbers served (enforced by registry + tests) |
| 8 | **Platform trust needed gatekeeping.** Until 2026-10-22, ANY phone-verified account could become an employer and rate workers anonymously at scale — the same power asymmetry the worker-side gate exists to counteract. **No named public dataset measures this; the argument is architectural, not statistical** | **Labour-office gated employer onboarding**: new employer accounts start `pending`; a state/district-scoped official accepts or rejects them in a dedicated `Employers` queue; acceptance is what unlocks posting listings publicly and rating workers. Listings carry an honest `employer_accepted` signal (8/100 match weight) — never "verified listing" | Employers accepted vs rejected per scope; 100% of public employer-authored postings traceable to an accepted account (server-enforced, integration-tested) |
| 9 | **Access must be mutual.** SIIMS 2026: 86.4% of surveyed migrant workers have no written contract and 57.6% are paid cash — work is arranged verbally, with no recorded channel and no vetting. Households have no safe way to find a verified worker without a middleman, and workers' numbers were never publishable by design | **Citizen (household) accounts + service requests**: the household posts a district-scoped request ("trade, what, where, when"); the same explainable scorer (`scoreServiceRequest`, occupation/district/area/recency with reason chips) ranks it for workers; a signed-in employer or household sees an accepted worker's contact number in the directory (never public), while a request acceptance reveals both sides at once; either path ends in a plain `tel:`/`sms:` handoff — no chat logs stored | Requests posted → accepted (7-day window) → marked done; zero public phone leaks (the open `/public/workers` API omits numbers and the open directory UI is removed); `/directory/workers` requires an employer/household session (integration-tested) |

## 3. The access funnel (design commitment, not a shipped dashboard)

ShramSetu's own measurement principle, for when a pilot dashboard is built:

```
registered → informed → assisted → filed → resolved
   (count)   (cited     (draft     (grievance (authority
              answer)    generated)  in system) action)
```

What society got wrong with e-Shram and AAWAZ was stopping at the first box. Every ShramSetu design review must ask: **which step does this feature move?** If it only moves box 1, it is probably an e-Shram clone.

## 4. Honest limitations (defensible in viva)

- **No live government integration.** The platform does not file anything with an official API (none exist publicly for e-Shram, ATHIDHI, ONORC, UMANG, KBOCWWB — registry `excluded_claims`); it drafts and prepares the worker. A generated draft is not a filed complaint.
- **Registry freshness.** Corpus documents carry LAST_VERIFIED dates; the 2026 rules document is scoped to *central-sector* establishments because state rules may still be drafts.
- **AAWAZ status is genuinely uncertain** — the KB says "confirm with the Labour Department" rather than advertising cover.
- **Heat guidance is advisory-based** public-health practice (NCDC/PIB), not legal entitlement.
- **Numbers are survey/helpline counts, never presented as prevalence** — echo-consistent with `excluded_claims` in the registry.
- **Employer acceptance ≠ business verification.** The office reviews the *account* (and can reject it); it does not certify company registrations, GST or wage promises. The UI therefore says "labour-office accepted" and applying workers still see every listing as `unverified`.
- **Citizen requests are brokered introductions, not mediation.** ShramSetu stores no chat and cannot arbitrate a dispute arising from an accepted request; it points both sides back to the statutory grievance channels (and the wage diary for evidence).
- **The gate is procedural, not forensic.** Acceptance depends on an officer acting within their jurisdiction; there is no biometric or company-registry cross-check in this version.

## 5. How the demonstration exercises the social case (6 minutes)

1. Ask the assistant in **Malayalam (voice)**: "എൻ്റെ ഏഴു ദിവസത്തെ കൂലി ലഭിച്ചില്ല — ഞാൻ എന്ത് ചെയ്യണം?" (My 7 days of wages were not paid — what do I do?) → cited answer naming the s.45 claim route and the employer's burden of proof.
2. Open the dashboard **Heat Safety** tile → prefilled heat question answered from the 28 April 2026 MoLE advisory document.
3. Show the **wage diary**: 7 days recorded, 3 marked partially paid → **File grievance pre-fills** from those records → demonstrates the 98%-stat answer: evidence by default.
4. Government dashboard (dist. official): the grievance arrives jurisdiction-scoped — show the audit log and the answer "which office does this go to".
5. **Employer gate**: register a fresh employer account → employer dashboard shows "Pending review" with posting and rating locked; the district official accepts the account in the new **Employers** tab; the employer posts a listing; the worker's job list shows the honest "labour-office accepted" chip — while the listing itself still reads `unverified`.
6. **Household flow**: log in as a citizen → post "help replacing tiles, Ernakulam" → the worker dashboard **House requests** tile shows it with explainable match chips (trade/district/area/recency) → worker accepts → both dashboards now show `tel:`/`sms:` buttons for each other. The employer/household dashboard also lists accepted workers' numbers with Call/SMS for signed-in accounts only; the public listing and request lists show **no phone numbers**.
