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
| 07 | [DPIA Screening — Community posts](./07-dpia-screening.md) | Art. 35 screening for the member-to-member feed, and why a full DPIA is not required |
| 08 | [Retention Decision — Moderation Log](./08-retention-decision-moderation-log.md) | Why a takedown record survives account deletion, and the sign-off that decision needs |
| 09 | [OSA Illegal Content Risk Assessment](./09-osa-illegal-content-risk-assessment.md) | Online Safety Act duty — separate from, and additional to, the Art. 35 screening in 07 |
| 10 | [Moderation Response Standard](./10-moderation-response-standard.md) | Who reads reports, how fast, and what happens automatically |

## Blocking sign-offs before Community goes live

Documents 08, 09 and 10 each end with a sign-off block. All three are decisions
a human with authority has to make, not engineering work:

1. **08 §7** — approve the moderation log surviving erasure (Art. 17(3)(e)).
2. **09 §8** — adopt the OSA risk assessment; **09 §6** needs a named escalation
   decision-maker for CSAM and credible threats.
3. **10 §2** — name a primary moderator *and a deputy*, and agree the response
   times in **10 §3**.

## Three inputs needed before these are presentation-ready

1. **Supabase project region** — confirm in the Supabase dashboard (Settings → General).
   The DART draft assumes UK; this must be verified, not assumed.
2. **Vendor data-residency settings** — confirm the **Sentry** org is an EU-region org,
   the **Upstash** Redis database region, and the **Resend** account region. Each supports
   EU residency; the configuration choice must be confirmed per account.
3. **Named role-holders** — the **Information Asset Owner (IAO)** (the staff member /
   faculty sponsor / Union officer legally accountable) and the **Information Asset
   Administrator (IAA)** (the student running day-to-day operations).
