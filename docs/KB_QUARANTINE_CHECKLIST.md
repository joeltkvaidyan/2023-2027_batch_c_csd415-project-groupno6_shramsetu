# ShramSetu — KB Legal Quarantine Checklist

**Purpose:** a standalone, language-neutral verification artifact: the legal corrections ShramSetu's knowledge base must satisfy before any trusted answer about current wage, worker-protection or grievance law is shown to a user.
**Why standalone:** the actual ShramSetu codebase was not present in the execution environment during this work, so this is framed as a checklist against risk, not as code changes to an already-audited repository.
**Relationship to other docs:** `docs/RESEARCH_AND_GAP_REPORT.md` (evidence), `docs/verified-sources.json` (ingest registry), `docs/KNOWLEDGE_BASES.md` (corpus inventory template to fill in once the actual KB is visible).

---

## 0. How to use this checklist

1. Before any KB content or AI answer about current Indian wage/worker/grievance law is served as trusted, run every row below.
2. A row marked **FAIL** means the relevant KB item must be corrected, quarantined, or shown with explicit "needs confirmation" language before ShramSetu can answer from it as trusted.
3. Primary-source links are provided per row. Where a rule is re-stated from a secondary source but the primary source is also listed, the primary source wins in any conflict.
4. Every retained answer should be traceable to an entry in `docs/verified-sources.json` with `status = verified` and a usable `url`.

---

## 1. Highest-risk corrections (do these first)

### 1.1 The Inter-State Migrant Workmen Act, 1979 is NOT current law

**FAIL if any KB item, answer, or UI copy:**
- treats the Inter-State Migrant Workmen (Regulation of Employment and Conditions of Service) Act, 1979 as in force; or
- describes "the 1979 Act" threshold ("five or more interstate migrant workmen") as the current rule.

**Correct framing:**
- The Act was replaced by the Occupational Safety, Health and Working Conditions Code, 2020.
- The OSH Code came into force from 21 November 2025.
- The relevant successor framework is the OSH Code, with the OSH (Central) Rules, 2026 notified on 8 May 2026.

**Primary sources:**
- OSH Code 2020 bare act (UGC/MoLE PDF): `https://dgfasli.gov.in/public/Admin/Cms/AllPdf/650059fbb8f1a9.98699174.pdf`
- PIB factsheet, OSH Code 2020: `https://www.pib.gov.in/FactsheetDetails.aspx?Id=150475`
- LinkedIn post by PC Agrawal citing MoLE notification of 21 November 2025 as the commencement date for the OSH Code (secondary, corroborates date): `https://www.linkedin.com/posts/pc-agrawal-78569614_oshwc-code-2020-comes-into-force-from-today-activity-7397580859387592704-4lO8`
- Pattic library page stating the OSH Code came into force from 21 November 2025 and that the Inter-State Migrant Workmen Act is addressed under it (secondary, corroborates): `https://library.pattic.org/books/labour-codes-2025-pacta/page/occupational-safety-health-and-working-conditions-code-2020`
- CLLRNUSRL article: OSH Code came into force November 2025, draft rules pre-published 30 December, OSH (Central) Rules 2026 notified 8 May 2026 (secondary, corroborates timing): `https://cllrnusrl.com/2026/09/12/can-a-single-code-replace-thirteen-laws-the-impact-of-the-osh-code-2020-on-indian-labour-law/`
- IJLR paper: OSH Code 2020 consolidated/replaced 13 central labour statutes including the Inter-State Migrant Workmen Act (secondary, corroborates): `https://ijlr.iledu.in/wp-content/uploads/2026/04/V6I525.pdf`

**Edge cases:**
- A historical question ("what did the 1979 Act say?") can still answer historically, but must state it is no longer the current governing law and point to the OSH Code as the current successor.
- Do not present the old "five or more" threshold as current. Under the OSH Code, the migrant-worker coverage threshold is different and is keyed to 10 or more inter-state migrant workers (see §5).

**Quarantine test:** search the entire codebase (KB items, frontend copy, prompts, seed data, docs, tests, app metadata) for the phrase "Inter-State Migrant Workmen Act" without a clear historical frame; flag every hit for review.

---

### 1.2 The wage-claim route under current law is Code on Wages, 2019 — not the Payment of Wages Act, 1936

**FAIL if any KB item or answer:**
- cites the Payment of Wages Act, 1936 as the current wage-claim route for post-commencement wage periods; or
- cites Industrial Disputes Act s.33C(2) as the current route for computing a current award/benefit without noting it is superseded for post-commencement matters.

**Correct framing:**
- The Code on Wages, 2019 is the governing wage law from 21 November 2025 onward.
- Claims for unpaid/underpaid wages for wage periods on/after that date are heard and determined by an authority appointed by the appropriate government under **section 45** of the Code on Wages.
- Section 45(6) prescribes a **three-year** limitation period to file a claim, with a proviso allowing late filing on sufficient cause.
- Section 59 puts the **burden of proof** on the employer where a claim alleges non-payment, underpayment or unauthorised deduction.

**Primary sources:**
- Code on Wages, 2019 enacted act PDF (MoLE): `https://www.labour.gov.in/static/uploads/2025/06/c328da14bbb15fc4ad571dc33e7a4ab3.pdf`
- Indian Kanoon text, section 45 (claims authority): `https://indiankanoon.org/doc/138728918/`
- SSRN paper confirming 3-year limitation under section 45(6) (secondary, corroborates): `https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID3749858_code4175519.pdf?abstractid=3749858&mirid=1`
- Taxmann blog confirming section 45(6) 3-year limitation with sufficient-cause proviso (secondary, corroborates): `https://www.taxmann.com/post/blog/analysis-the-code-on-wages`
- Comply4HR section 59 text (burden of proof) (secondary, corroborates section number/content): `https://comply4hr.com/showsec.asp?seccode=CWA59`
- Karnataka "Highlights of Code on Wages" PDF confirming s.58 burden of proof + 3-year claim period (secondary, corroborates): `https://karmikaspandana.karnataka.gov.in/storage/pdf-files/Acts%20and%20Rules/Highlights%20code%20on%20wages.pdf`
- PIB factsheet, Code on Wages 2019, including proof of payment / wage slip language under s.50(3) read with rule 34 (secondary, corroborates): `https://www.pib.gov.in/FactsheetDetails.aspx?Id=150481`

**Edge cases:**
- For a wage period before 21 November 2025, or for a pending proceeding, a savings question may arise; the answer should be framed as "claim under the Code on Wages where the wage period is on/after 21 November 2025; older periods may involve different transitional questions — confirm with the relevant authority." Do not assert one blanket answer for all periods.
- Section 33C(2) should not be described as the current primary route for a new post-commencement wage-claim without noting transitional uncertainty.

**Quarantine test:** any KB query about "my employer has not paid me" or "file a wage complaint" must resolve to a trusted answer grounded in the Code on Wages, section 45 (claims) and section 59 (burden of proof), with a 3-year limitation and at least one cited primary or official source. If the answer cites the Payment of Wages Act 1936 for a post-commencement period, that is a FAIL.

---

### 1.3 Wage slips and registers are section 50 — section 17 is payment timing

**FAIL if any KB item or answer:**
- says "wage slips are provided under section 17"; or
- conflates wage-payment timing with the record/payment-of-dues provisions.

**Correct framing:**
- **Section 17** of the Code on Wages prescribes when wages are payable:
  - daily-paid employees: end of the shift;
  - weekly-paid: before the weekly holiday;
  - fortnightly-paid: by the second day after the fortnight;
  - monthly-paid: before the seventh day of the following month;
  - on removal/dismissal/retrenchment/resignation: within two working days.
- **Section 50** deals with records and payment:
  - **50(1)** employer must maintain a register of persons employed, muster roll, wages and prescribed particulars;
  - **50(3)** employer must issue wage slips in the prescribed form and manner, before/on payment;
- **Section 59** burden of proof on the employer for non-payment/underpayment/unauthorised deductions (cross-reference, not part of s.17).
- The Central Rules (2026) specify the form: Rule 52 of the Code on Wages (Central) Rules, 2026 requires wage slips in **Form V** on or before payment. Rule 51 permits registers to be maintained **electrically or physically**, preserved for **5 years** after the last entry.

**Primary/secondary sources:**
- LawGist section 50 text (secondary, corroborates register + wage slip duty under s.50): `https://lawgist.in/minimum-wages-act/50`
- PIB factsheet, Code on Wages 2019, s.50(3) + Rule 34 wage-slip language (secondary, corroborates): `https://www.pib.gov.in/FactsheetDetails.aspx?Id=150481`
- Karnataka "Highlights of Code on Wages" PDF (secondary, corroborates): `https://karmikaspandana.karnataka.gov.in/storage/pdf-files/Acts%20and%20Rules/Highlights%20code%20on%20wages.pdf`

**Edge cases:**
- The small-employer exemption: the register/wage-slip obligation in s.50 does not apply to an employer employing no more than five persons for agricultural or domestic purposes; instead the employer must produce reasonable proof of payment on demand. Any generalised statement that "all employers must keep registers and issue wage slips" is incomplete without the exemption caveat.
- State-sector vs central-sector: the 2026 Central Rules apply to central-sector establishments; Kerala state-sector rules and procedures should be confirmed separately. Do not overgeneralise the 2026 Central Rules to Kerala in a way that implies they are the only applicable rules.

**Quarantine test:** a KB query about "how often does my employer have to pay me" resolves to section 17 timing; a query about "should my employer give me a wage slip / keep a record" resolves to section 50 with the small-employer exemption and the Form V reference; a query about "prove payment" resolves to section 59. No trustworthy answer should say wage slips come from section 17.

---

### 1.4 Do not assert a single Kerala minimum wage

**FAIL if any KB item or UI copy:**
- asserts one Kerala minimum wage figure (e.g. "the Kerala minimum wage is ₹X/day") without specifying sector, skill class, area, and the notification date; or
- treats any generic "₹783", "₹827", "₹827/day" or similar headline figure as a current Kerala-specific rate without confirming the sector/notification.

**Correct framing:**
- There is no single Kerala minimum wage. The applicable rate depends on the scheduled employment, skill/class, area/zone, and any variable dearness allowance or later revision.
- The authoritative source of record is the Kerala Labour Commissionerate Minimum Wage Notifications page, which lists notifications by sector and distinguishes preliminary vs final notifications.
- Any quoted figure must be tied to a specific sector, skill class, area, and notification/date.

**Primary source:**
- Kerala Labour Commissionerate — Minimum Wage Notifications (official source of record): `https://lc.kerala.gov.in/en/minimum-wage-notifications`

**Secondary/corroborating sources (these describe variability, not a single Kerala figure):**
- Simpliance "Latest Minimum Wages for Shops & Establishment, Kerala" noting that with the new Labour Codes in effect from 21 November 2025, the corresponding rules are yet to be notified: `https://www.simpliance.in/India/LEI/minimum_wages/state-wise-details/kerala`
- India Briefing guide-to-minimum-wage-in-India (secondary, general reference, not a Kerala-specific authority): `https://www.india-briefing.com/news/guide-minimum-wage-india-19406.html/`
- Central Minimum Wages Revised From 01 October 2026 page (central rates, distinct from Kerala; useful only to avoid conflating central and state rates): `https://labourlawhelp.com/central-minimum-wages/`
- Sankhlaco "Minimum Wages in India 2026: State-wise Guide" corroborating that minimum wages remain notification-driven post-commencement (secondary): `https://sankhlaco.com/minimum-wages/`

**Edge cases:**
- Wages for a worker are not determined by migration status; a worker is not exempt from the applicable minimum wage because they are an interstate migrant. That principle is sound, but the specific applicable figure still depends on sector/skill/area/notification.
- If the worker's sector is shops and establishments, do not silently apply a construction figure or vice versa.

**Quarantine test:** if the KB ever computes a minimum wage, it must ask for sector + skill/class + area and present the figure with its source, notification, and date; it must not emit a bare number. If it cannot determine those inputs, it must refuse to state a number.

---

### 1.5 List only verified helplines; do not broadcast "155214" as a Kerala labour helpline

**FAIL if any KB item or UI copy:**
- lists "155214" as a Kerala labour helpline without labelling it as a Karnataka number.

**Correct framing:**
- Verified channels (from official pages):
  - Kerala Labour Call Centre: **1800 42555 214**
  - Kerala Citizen Call Centre: **155300**
  - Kerala CMO (Santhwanam): **1076** (online complaints by docket + registered mobile; ~15-day examination target; complex cases may take longer)
  - NCS helpline: **1514**
  - India Labourline (NGO): **1-800-833-9020**
  - Samadhan (central labour grievance portal): `https://samadhan.labour.gov.in/`
- The number "155214" appears in search results associated with a Karnataka Labour Department helpline, not Kerala; treat it as Karnataka unless a Kerala authority confirms otherwise.
- Emergency 112 is a national emergency number, not a labour-specific channel.

**Sources:**
- Kerala Labour Commissionerate (register complaint + Kerala Labour Call Centre 1800 42555 214 + Citizen Call Centre 155300 on its site): `https://lc.kerala.gov.in/en`
- Kerala CMO help page (1076; online complaint by docket + registered mobile; ~15-day examination target): `https://cmo.kerala.gov.in/help-en.php`
- NCS FAQ (helpline 1514): `https://ncs.gov.in/faq`
- India Labourline: `https://workingpeoplescharter.in/india_labour_line/`
- Samadhan: `https://samadhan.labour.gov.in/` and contacts: `https://samadhan.labour.gov.in/contacts/`

**Quarantine test:** the KB must not present 155214 as a Kerala number. Any helpline must be either confirmed from an official page or clearly labelled as unverified.

---

## 2. Secondary-risk corrections

### 2.1 Occupancy / principal-employer and contractor identity must be captured before any wage claim guidance

**FAIL if the KB or workflow assumes the worker always knows the liable party.**

**Correct framing:**
- The documented failure mode is workers not knowing the full name/address of the employer or contractor, and not having written wage records. Therefore trusted wage-evidence capture must record **principal employer + contractor + worksite + agreed rate**, not just "employer".
- This is not a legal conclusion; it is evidentiary capture. House it as a record, not a determination.

**Sources (evidence base):**
- India Labourline reporting via The Hindu / The New Indian Express: workers often cannot name the person responsible for wages; many wage complaints come through IDWTO (India Labourline) helpline.
- Secondary accounts of wage complaint volumes (these are complaint-channel figures, not official Kerala wage-theft counts):
  - The Hindu, 19 May 2024 (approx ₹2.41 crore / 1,227 complaints in ~18 months): `https://www.thehindu.com/news/cities/Kochi/migrant-workers-lodge-complaints-of-wage-theft-amounting-to-241-crore-in-18-months/article68185925.ece`
  - The New Indian Express, 24 Feb 2024 (India Labourline complaints; contractor identity difficulty): `https://www.newindianexpress.com/states/kerala/2024/Feb/24/exploited-migrants-find-voice-to-report-pay-violations`

**Quarantine test:** any "wage claim" or "evidence" KB article or AI answer must include principal-employer and contractor fields as part of the record template, and must not assume the walker already knows the liable party.

---

### 2.2 Wage evidence: label artefacts as supporting evidence, not proof

**FAIL if the KB or app implies a bank/UPI record, SMS screenshot, or self-kept diary is proof of the claim.**

**Correct framing:**
- A bank/UPI record shows a transfer occurred, date, amount, often sender and reference — it does not, by itself, prove the agreed wage, the period worked, or the outstanding balance.
- An SMS/WhatsApp screenshot may record rate/period/promise/acknowledgement — but can be challenged on authenticity, context and sender identity; preserve whole conversations, not crops.
- A self-kept diary is a contemporaneous supporting record; weight depends on corroboration and chronology; no verified rule says labour authorities must accept it as sole proof, and no verified rule says they must reject it.
- In formal judicial proceedings, the Bharatiya Sakshya Adhiniyam, 2023 (in force from 1 July 2024) governs electronic evidence including sections 61–63 and a Schedule certificate; earlier Evidence Act s.65B(4) case law still informs when a certificate is needed for computer output vs production of the original device. A labour authority or mediation may be less formal than court.
- Do not auto-generate a "BSA/Evi. Act certificate" as if it were a legally effective determination.

**Sources:**
- Vidhi Centre for Legal Policy, *The Evolving Enigma* (electronic evidence, s.65B/BSA): `https://vidhilegalpolicy.in/blog/the-evolving-enigma/`
- Veritect BSA digital-evidence provisions comparison (secondary, corroborates BSA electronic-evidence structure): `https://veritect.ai/old-law-new-law/digital-evidence-new-provisions`
- Aajeevika, "What We Do": workers often lack contracts/records and rely on piecing together "thin evidence" (secondary, corroborates evidence-capture value): `https://aajeevika.org/what-we-do-program/`
- Disha Foundation — legal empowerment materials (secondary, corroborates grievance/legal-assistance framing): `https://dishafoundation.ngo/legalempower.html`, `https://dishafoundation.help/how-we-help/`

**Quarantine test:** any KB answer or UI that describes a bank/UPI record, screenshot or diary must label it "supporting evidence — not proof of your claim", and must not promise admissibility or auto-generate a certificate.

---

### 2.3 Refuse generation of entitlements that are not in the KB

**FAIL if the KB or AI invents scheme names, benefit amounts, deadlines, or eligibility conclusions not traceable to a verified source.**

**Correct framing:**
- The assistant must refuse to assert a scheme, amount, or legal entitlement unless it is traceable to a `verified` source in `docs/verified-sources.json` (or a source explicitly imported into the KB as verified).
- For eligibility, the answer must state the published criteria and that the responsible department/board decides — not that ShramSetu decides or guarantees the outcome.

**Sources (directory/eligibility grounding):**
- e-Shram FAQ (registration is free; Aadhaar + Aadhaar-linked mobile normally required; UAN is not cash/insurance/job/proof of enrolment): `https://eshram.gov.in/faqs`
- ATHIDHI (registration system; not a welfare scheme; no public third-party API found): `https://play.google.com/store/apps/details?id=com.nic.athidhi_kerala`
- KBOCWWB (statutory board for registered construction workers; not a general migrant-worker registry; per-benefit conditions apply): `https://kbocwwboard.kerala.gov.in/kboc/`
- CPGRAMS (grievance portal; not a court/tribunal; excludes RTI/sub judice/religious/most govt-employee service matters; no public filing API for arbitrary third parties): `https://pgportal.gov.in/` and disclaimer: `https://pgportal.gov.in/Home/Disclaimer`
- ONORC/Mera Ration (portability of existing NFSA entitlement; does not issue a card or create entitlement): `https://play.google.com/store/apps/details?id=com.nic.onenationonecard`

**Quarantine test:** a query like "will I get the Kerala scheme?" must not be answered with a definitive yes/no or a made-up amount; it must be rejected or routed with the published-criteria framing and a citation.

---

## 3. Minimum-quarantine assertions (fast pre-commit checks)

Run these before any release that exposes KB content or AI answers to a user:

- [ ] No KB item written as current law cites the Inter-State Migrant Workmen Act, 1979 without a clear historical frame and a successor pointer to the OSH Code 2020.
- [ ] No KB item or answer states "the Kerala minimum wage is ₹X" without sector/skill/area/date/source.
- [ ] No KB answer for "my employer has not paid me" gets routed to anything other than the Code on Wages, 2019, section 45 (claims, 3-year limitation) and section 59 (burden of proof), with a cited primary/official source.
- [ ] No KB answer names wage slips under section 17; wage slips / registers are section 50, with the Form V / small-employer exemption caveat where relevant.
- [ ] No helpline broadcast lists 155214 as a Kerala number.
- [ ] No KB content publishes a prohibited claim from §5 below.

---

## 4. What ShramSetu must not claim (prohibited-claims list)

Do not assert, as if true, any of the following unless a specific authorisation/integration/evidence exists:

- "official", "government-approved", "integrated", "registered in a government system", "insured", "benefit approved", "complaint filed", "real-time eligibility", "job guaranteed", in relation to any government service the app has not actually integrated with and verified.
- That ATHIDHI registration activates AAWAZ cover.
- That an e-Shram card itself pays benefits.
- That ONORC creates a ration entitlement.
- That generating a PDF means a grievance has been filed/received.
- That a public link is an API, or that a user's saved copy is an official record.
- That a specific employer or agent is "criminal", "fraudulent" or a "trafficker" based on the app's own judgment.
- A definitive current statistics figure about interstate migrant worker headcount, language shares, agent fees, trafficking prevalence, or workplace-injury/death series that could not be verified.

---

## 5. What ShramSetu may legitimately do without an official integration

With appropriate user consent, privacy/security safeguards, and compliance with the destination's terms:

- Deep-link to official portals/apps/grievance forms/helplines, clearly identifying the destination as a government service.
- Store the worker's own records (dates worked, employer + contractor + principal employer, wages, receipts, card images, complaint reference numbers), with access controls and deletion.
- Help organise evidence and generate a **draft** complaint letter/PDF, labelled unambiguously "DRAFT — NOT SUBMITTED".
- Explain public eligibility rules, translate, prepare document checklists, and help identify the right official route — while stating that the department/board decides eligibility.
- Integrate officially only where written authorisation from the responsible department exists and the integration follows its authentication/consent/data-use/security requirements.

---

## 6. If the actual codebase is available, run these next

1. Run a full-repo text search for "Inter-State Migrant Workmen Act", "Payment of Wages Act 1936", "Section 33C", and bare "155214" / "minimum wage is ₹" patterns from §1 and §3; triage each hit.
2. Search AI prompt templates / system prompts for the same phrases plus "benefit approved" / "real-time eligibility" / "insured" in a government-service context.
3. Where the KB is structured (JSON/YAML/DB), add the fields: `source_url`, `publisher`, `jurisdiction`, `verified_at`, `status` (verified / unverified / uncertain / superseded), `supersedes`, `superseded_by`, and a `last_updated` timestamp per answer cluster.
4. Gate retrieval so only `status = verified` entries are eligible for a trusted answer about current law; `superseded` entries may be indexed for historical questions but excluded from current-law answers.
5. Add the fast pre-commit checks in §3 to CI, and fail the build if any prohibited claim in §5 is present in user-visible text without an override that is itself documented.
6. Once the corpus is inventoried, populate `docs/KNOWLEDGE_BASES.md` with a per-corpus list (files, formats, source URLs, verification status, owners), and re-confirm each entry against `docs/verified-sources.json`.

---

## 7. Unverified items explicitly excluded from trusted answers (mirrors `docs/verified-sources.json → excluded_claims`)

Do not assert as verified, and state as "needs confirmation / unknown", any of:

1. A current India-wide count specifically of interstate migrant workers.
2. Representative Kerala language-share or origin-state-share percentages.
3. A typical agent fee for domestic recruitment into Kerala.
4. A Kerala-specific trafficking-prevalence estimate.
5. An official, complete Kerala series for migrant workplace injuries and deaths.
6. Any official state-wide wage-theft count for Kerala.
7. The exact Mahatma Gandhi University (Sep 2025) health-coverage percentage (only the URL slug suggests 9.8%; the page was not read).
8. The Kerala 2025 amendment fee table for the Inter-State Migrant Workmen Rules.
9. Whether ATHIDHI registration currently confers any active AAWAZ cover.
10. Post-Code Kerala rules/forms/fees/procedures under the four Labour Codes (still listed as draft on the Kerala Labour Commissionerate page).
11. Whether the OSH Code carries forward the 1979 Act's accommodation/medical/protective-clothing entitlements, and in what terms.
12. Any Code successor to the old 50%/₹75 displacement allowance.
13. Central Rules PDFs dated 8–9 May 2026 (403 on fetch); contents not read.
14. The Delhi Labour Court diary-rejection decision (surfaced in search; judgment text not retrieved).
15. Aajeevika's wage-protection report's specific recommendation on informal documentation (PDF not retrievable).
16. Whether "155214" is a Kerala labour helpline (evidence points to Karnataka).
17. Any public third-party API for ATHIDHI, e-Shram, NCS, ONORC, UMANG, CPGRAMS, KBOCWWB or eMigrate.

---

## 8. Source list for this checklist

Primary/official:

- OSH Code 2020 bare act (MoLE PDF): `https://dgfasli.gov.in/public/Admin/Cms/AllPdf/650059fbb8f1a9.98699174.pdf`
- PIB factsheet, OSH Code 2020: `https://www.pib.gov.in/FactsheetDetails.aspx?Id=150475`
- PIB factsheet, Code on Wages 2019: `https://www.pib.gov.in/FactsheetDetails.aspx?Id=150481`
- Code on Wages, 2019 enacted act PDF (MoLE): `https://www.labour.gov.in/static/uploads/2025/06/c328da14bbb15fc4ad571dc33e7a4ab3.pdf`
- Indian Kanoon, section 45: `https://indiankanoon.org/doc/138728918/`
- Kerala Labour Commissionerate — Minimum Wage Notifications: `https://lc.kerala.gov.in/en/minimum-wage-notifications`
- Kerala Labour Commissionerate: `https://lc.kerala.gov.in/en`
- Kerala CMO help: `https://cmo.kerala.gov.in/help-en.php`
- NCS FAQ: `https://ncs.gov.in/faq`
- e-Shram FAQ: `https://eshram.gov.in/faqs`
- ATHIDHI app listing: `https://play.google.com/store/apps/details?id=com.nic.athidhi_kerala`
- KBOCWWB: `https://kbocwwboard.kerala.gov.in/kboc/`
- CPGRAMS: `https://pgportal.gov.in/` · disclaimer: `https://pgportal.gov.in/Home/Disclaimer`
- Mera Ration (ONORC) app listing: `https://play.google.com/store/apps/details?id=com.nic.onenationonecard`
- Samadhan: `https://samadhan.labour.gov.in/` · contacts: `https://samadhan.labour.gov.in/contacts/`
- India Labourline: `https://workingpeoplescharter.in/india_labour_line/`

Secondary/corroborating (used only to corroborate primary sources or flagged as such):

- LinkedIn, PC Agrawal: OSH Code commencement 21 November 2025: `https://www.linkedin.com/posts/pc-agrawal-78569614_oshwc-code-2020-comes-into-force-from-today-activity-7397580859387592704-4lO8`
- Pattic library, OSH Code 2020 page: `https://library.pattic.org/books/labour-codes-2025-pacta/page/occupational-safety-health-and-working-conditions-code-2020`
- CLLRNUSRL: OSH Code impact and 2026 rule timeline: `https://cllrnusrl.com/2026/09/12/can-a-single-code-replace-thirteen-laws-the-impact-of-the-osh-code-2020-on-indian-labour-law/`
- IJLR paper: OSH Code replaced 13 central labour statutes incl. the Inter-State Migrant Workmen Act: `https://ijlr.iledu.in/wp-content/uploads/2026/04/V6I525.pdf`
- SSRN paper: 3-year limitation under section 45(6): `https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID3749858_code4175519.pdf?abstractid=3749858&mirid=1`
- Taxmann: Code on Wages analysis, section 45(6) 3-year limitation with sufficient-cause proviso: `https://www.taxmann.com/post/blog/analysis-the-code-on-wages`
- Comply4HR, section 59 burden of proof: `https://comply4hr.com/showsec.asp?seccode=CWA59`
- Karnataka "Highlights of Code on Wages" PDF (s.58 burden of proof; 3-year claim period): `https://karmikaspandana.karnataka.gov.in/storage/pdf-files/Acts%20and%20Rules/Highlights%20code%20on%20wages.pdf`
- LawGist, section 50: `https://lawgist.in/minimum-wages-act/50`
- Simpliance, Kerala shops & establishments minimum wages: `https://www.simpliance.in/India/LEI/minimum_wages/state-wise-details/kerala`
- India Briefing, minimum wage in India guide: `https://www.india-briefing.com/news/guide-minimum-wage-india-19406.html/`
- LabourLawHelp, central minimum wages from 01 October 2026: `https://labourlawhelp.com/central-minimum-wages/`
- Sankhlaco, minimum wages India 2026 state-wise guide: `https://sankhlaco.com/minimum-wages/`
- Vidhi, *The Evolving Enigma* (electronic evidence / BSA): `https://vidhilegalpolicy.in/blog/the-evolving-enigma/`
- Veritect, BSA digital-evidence provisions: `https://veritect.ai/old-law-new-law/digital-evidence-new-provisions`
- Aajeevika, "What We Do": `https://aajeevika.org/what-we-do-program/`
- Disha Foundation, legal empowerment: `https://dishafoundation.ngo/legalempower.html` · how we help: `https://dishafoundation.help/how-we-help/`
- The Hindu, 19 May 2024: `https://www.thehindu.com/news/cities/Kochi/migrant-workers-lodge-complaints-of-wage-theft-amounting-to-241-crore-in-18-months/article68185925.ece`
- The New Indian Express, 24 Feb 2024: `https://www.newindianexpress.com/states/kerala/2024/Feb/24/exploited-migrants-find-voice-to-report-pay-violations`

---

## 9. Note on verification status of this checklist

This checklist was produced without the actual ShramSetu codebase present in the execution environment during this work. It is therefore a **verification spec**, not a report of changes already made to ShramSetu. Primary/official sources are listed where available; secondary sources are explicitly labelled as corroborating. When the actual KB is visible, this checklist must be re-run against it and the results recorded in `docs/FINAL_VERIFICATION_REPORT.md`.
