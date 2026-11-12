> ⚠ **Correct before sending (12 Nov 2026).** This draft predates the legal reconciliation. Before
> it goes to ICT: the data controller is **IC Founders Ltd** (Companies House 17171277), which runs
> Foundry for Imperial Entrepreneurs, an Imperial College Union society — not the society itself;
> the lawful basis for accounts and the directory is **contract**, not consent (Privacy §3); and
> the "What data Foundry collects" table is incomplete (CVs, connections, AI, analytics; see
> `docs/compliance/02-ropa.md`). The Microsoft sign-in work is parked.

# Foundry — Imperial Microsoft Sign-In Consent Request

**Prepared by:** [SOCIETY NAME], a registered Imperial College Union society
**Contact:** [PRESIDENT NAME], President — [EMAIL]
**Date:** [DATE]

---

## What Foundry is

Foundry is a private community platform for Imperial College London students interested in entrepreneurship and venture-building. It is built and maintained by [SOCIETY NAME].

Members use the platform to:

- Discover opportunities (internships, accelerators, grants, hackathons)
- Find events run by Imperial entrepreneurship societies
- Browse a curated directory of VCs, angels, and accelerators relevant to student founders
- Connect with other Imperial student founders via verified profiles

Access is restricted to Imperial students. Email-domain verification (`@imperial.ac.uk`, `@ic.ac.uk`) is enforced at the database level and cannot be bypassed by users.

## What we are asking ICT for

We have registered a multi-tenant Microsoft Entra ID application. For Imperial students to sign in with their Imperial Microsoft account, Imperial's tenant must grant admin consent to the application. Specifically:

> **Grant tenant admin consent in Imperial's Entra ID for the application "Foundry Supabase Auth"**, application (client) ID `[CLIENT_ID]`, for the delegated scopes `openid`, `profile`, `email`, and Microsoft Graph `User.Read`.

No app-only, write, or elevated permissions are requested. The app does not read mailboxes, files, calendars, OneDrive content, or any data beyond a user's basic profile and email.

## Who runs Foundry

- **[PRESIDENT NAME]** — President, [SOCIETY NAME]
- **[TECH LEAD NAME]** — Technical lead and accountable point of contact
- **Society committee:** [BRIEF NOTE]

Data protection point of contact: [NAME], [EMAIL].

## What data Foundry collects

| Field | Source | Purpose |
| --- | --- | --- |
| Email address | Microsoft sign-in / direct sign-up | Account identification, domain verification |
| Display name | User-entered | Profile display |
| Profile fields (course, year, bio, portfolio links) | User-entered | Member-facing directory |
| Sign-in timestamps | Supabase Auth | Standard auth logging / abuse prevention |

We do **not** collect: payment details, special-category personal data (UK GDPR Article 9), location, device telemetry beyond standard auth logs, or any data outside what a user voluntarily enters.

## Where it is hosted

- **Frontend:** Next.js, deployed on Vercel (EU region)
- **Backend / database:** Supabase, **EU West 2 (London)** region
- **Authentication:** Supabase Auth with row-level security on all user-data tables

All user data remains within UK / EU jurisdictions.

## Security posture

- HTTPS enforced everywhere
- Row-level security on Supabase tables; users can only read their own private data
- Email verification on all sign-ups
- Secrets stored in Vercel and Supabase environment configuration only — never in source
- Account deletion and password change available to users from the in-app settings page
- Planned hardening before public launch: Cloudflare rate limiting on auth endpoints, Sentry error monitoring, CI/CD with automated tests

## Lawful basis (UK GDPR)

**Consent.** Users opt in by creating an account, agree to a privacy notice at sign-up, and can delete their account and all associated data from the in-app settings page at any time.

## Governance and sponsorship

This request is made on behalf of [SOCIETY NAME], a registered Imperial College Union society, with the support of [ICU SOCIETIES OFFICE CONTACT or RELEVANT FACULTY SPONSOR].

## Next steps and offer

We are happy to:

- Provide a more detailed Data Protection Impact Assessment if required
- Demo the platform to ICT
- Meet to walk through the architecture and answer security questions
- Adjust requested scopes if any are considered excessive

Thank you for considering this request.
