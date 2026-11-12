# Imperial Entrepreneurs — Data Protection & Governance Portfolio

These documents describe the actual technical implementation of the Imperial
Entrepreneurs ("Foundry") platform as built. The data controller is **IC Founders Ltd**
(Companies House 17171277) — see `02-ropa.md` §1 — not Imperial College London, which is
not a joint controller of this service. Copies are shared with Imperial where the
platform's own governance decides that is useful (e.g. its DART 2.0 record, given the
platform's affiliation with the College), but Imperial does not own or sign off this
portfolio.

> **Status:** DRAFT for the controller's review. Authored from the live codebase, not
> from assumptions. Items marked **⚠ CONFIRM** require a factual input only the project
> owner can supply (e.g. vendor account region settings, named role-holders). Nothing
> here is legal advice — the controller's data protection contact and legal team own the
> final wording and sign-off.

## Contents

| # | Document | Purpose |
|---|----------|---------|
| 00 | (Owner-supplied) DART 2.0 Registration draft | Imperial's internal registration form |
| 01 | [Architecture & Data Flow Map](./01-architecture-data-flow-map.md) | What the system is, what data flows where, which processors touch it |
| 02 | [Record of Processing Activities (ROPA)](./02-ropa.md) | Art. 30 UK GDPR record: data, purpose, basis, retention, recipients |
| 03 | [Third-Party Processor & DPA Register](./03-third-party-dpa-register.md) | Every sub-processor, the data they handle, and DPA status |
| 04 | [Internal Data Handling Protocol](./04-internal-data-handling-protocol.md) | How the team accesses, secures, and minimises data |
| 05 | [Data Breach Incident Response Plan](./05-data-breach-incident-response-plan.md) | Detection, containment, ICO/Imperial notification, recovery |
| 06 | [Information Items Checklist](./06-info-items-checklist.md) | Outstanding factual inputs |
| 07 | [DPIA Screening — Community, Connections, CV intake](./07-dpia-screening.md) | Art. 35 screenings, and why a full DPIA is not required for each; includes the 12 Nov 2026 re-screen of the CV worker pipeline and GitHub connection |
| 08 | [Retention Decision — Moderation Log](./08-retention-decision-moderation-log.md) | Why a takedown record survives account deletion, and the sign-off that decision needs |
| 09 | [OSA Illegal Content Risk Assessment](./09-osa-illegal-content-risk-assessment.md) | Online Safety Act duty — separate from, and additional to, the Art. 35 screening in 07 |
| 10 | [Moderation Response Standard](./10-moderation-response-standard.md) | Who reads reports, how fast, and what happens automatically |
| 11 | [DPIA — Foundry AI](./11-dpia-ai-matching.md) | Full Art. 35 DPIA for AI search, matching and assessment (profiling); gates every AI flag |
| 12 | [UK Legal Gap Analysis](./12-uk-legal-gap-analysis.md) | Every UK law tested against the code and live copy; gaps, severities, action plan (2026-11-12) |
| 13 | [OSA Children's Access Assessment](./13-osa-childrens-access-assessment.md) | Mandatory two-stage OSA test; draft conclusion "child user condition not met", solicitor to confirm |
| 14 | [Legitimate Interests Assessments](./14-legitimate-interests-assessments.md) | One three-part test per legitimate-interests purpose in Privacy §3 |
| 15 | [Admin Confidentiality Undertaking](./15-admin-confidentiality-undertaking.md) | Signed by every admin before access is granted |
| 16 | [Member notice: Terms and Privacy update](./16-member-notice-terms-privacy-2026-11.md) | Draft email; 30 days' notice to existing members |

## Sign-off register (every decision that needs the controller, 12 Nov 2026)

Community and Connections are **already live**, so the first four rows are overdue rather than
"before go-live". None of these can be completed by engineering. Leave a row blank until it is
genuinely decided.

| # | Decision | Document | Needed before | Decided by / date |
|---|----------|----------|---------------|-------------------|
| 1 | Approve the moderation log surviving erasure (Art. 17(3)(e)) | 08 §7 | Already live | |
| 2 | Adopt the OSA illegal-content risk assessment; name the escalation decision-maker for CSAM and credible threats | 09 §6, §8 | Already live | |
| 3 | Name a primary moderator and a deputy; agree response times | 10 §2, §3 | Already live | |
| 4 | Approve the corrected privacy page (CV text stored and sent to OpenAI; GitHub; retention lines; OpenAI as processor) | PR #120 / `privacy/page.tsx` | Already live: the old page is inaccurate | |
| 5 | Decide how to treat members who ticked the older CV consent wording | 07 re-screen; ROPA T | Soon | |
| 6 | Confirm or amend the CV worker pipeline re-screen conclusion | 07 re-screen | Soon | |
| 7 | Sign off the Foundry AI DPIA and its open points (1 to 4), including consulting members | 11 §2, §6 | **Any AI flag** | |
| 8 | Lawful basis for a member's own job matches (contract or legitimate interests) | 02 item S | **Any AI flag** | |
| 9 | Approve the `/ai-notice` wording | `ai-notice/page.tsx` | **Any AI flag** | |
| 9a | **Public wording that must change before any AI flag** (found in the 12 Nov 2026 review): (a) the privacy page has **no section on Foundry AI** (lawful basis per toggle, OpenAI as recipient for matching, 7-day and 30-day retention, the profiling statement, a link to `/ai-notice`); (b) privacy page section 7 and the Terms say a CV is visible "only to you and our admins", but with `evidence_sharing` consent a recruiter can see up to two short CV lines; (c) `/ai-notice` is dated 6 Oct 2026 and says matching never uses gender, ethnicity, nationality, religion or sexuality, but on 10 Nov it was decided that **Build your network** may take those as search terms (`policy.py` `_AFFINITY`). Re-check the sentence against that behaviour and add a line saying so | `privacy/page.tsx`, `terms/page.tsx`, `ai-notice/page.tsx` | **Any AI flag** | |
| 9b | Cookie Policy (dated 29 Aug 2026) and Terms (dated 20 Sep 2026) were **not** re-verified against the current code in the 12 Nov 2026 review | `cookies/page.tsx`, `terms/page.tsx` | Soon | |
| 9c | **Status of 9a and 9b after the 12 Nov 2026 closure work ([12](./12-uk-legal-gap-analysis.md) §8):** 9a(a) privacy §2c added; 9a(b) privacy §2a/§7 and Terms §4 now state the two-line recruiter exception; 9a(c) `/ai-notice` re-dated and corrected (network mode now allows gender and nationality only); 9b Cookie Policy and Terms re-verified and rewritten. The controller still has to approve the wording | `privacy`, `terms`, `cookies`, `ai-notice` | Approve | |
| 10 | Items 20 and 21 of `owner-decisions.md` (spend caps; strictness of the protected-characteristic screen) | owner-decisions | **Any AI flag** | |
| 11 | Signed copy of the OpenAI DPA | 03 | 19 Nov 2026 | |
| 12 | Confirm the Imperial relationship (independent controller vs joint) is acceptable for DART 2.0 | 02 §1 | Before DART submission | |

## Blocking sign-offs before Community goes live (original list)

Documents 08, 09 and 10 each end with a sign-off block. All three are decisions
a human with authority has to make, not engineering work:

1. **08 §7** — approve the moderation log surviving erasure (Art. 17(3)(e)).
2. **09 §8** — adopt the OSA risk assessment; **09 §6** needs a named escalation
   decision-maker for CSAM and credible threats.
3. **10 §2** — name a primary moderator *and a deputy*, and agree the response
   times in **10 §3**.

## Three inputs needed before these are presentation-ready

1. ~~**Supabase project region**~~ — confirmed UK (London) on 12 Nov 2026.
2. **Vendor data-residency settings** — **Sentry** is confirmed EU (12 Nov 2026). Still to confirm: the **Upstash** Redis database region and the **Resend** account region.
3. **Named role-holders** — the **Information Asset Owner (IAO)** (the staff member /
   faculty sponsor / Union officer legally accountable) and the **Information Asset
   Administrator (IAA)** (the student running day-to-day operations).
