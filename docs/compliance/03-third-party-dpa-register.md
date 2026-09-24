# 03 · Third-Party Processor & DPA Register

DRAFT for the controller's review. Lists every external service that processes (or could
incidentally process) personal data on behalf of the platform, the data it handles, and the
status of a Data Processing Agreement (DPA) / international transfer safeguard.
**Controller:** IC Founders Ltd (Companies House 17171277) — see `02-ropa.md` §1.

> **Action for the owner:** for each row, locate the vendor's standard DPA (links below are the
> typical locations as of early 2026 — **verify the current URL**), accept/sign it where required,
> and retain a copy in the controller's own file (a copy can be shared with Imperial for its
> DART 2.0 record, but this register is not Imperial's to hold or approve). Most of these
> vendors expose a self-serve DPA that is accepted on account creation or available on their
> legal/trust page.

| Processor | Role | Personal data it handles | Region | DPA location (verify) | Transfer safeguard |
|-----------|------|--------------------------|--------|----------------------|--------------------|
| **Supabase** | Processor — database & auth | Email, names, profile fields, listings, auth records | ⚠ CONFIRM (UK or EU) | `supabase.com/legal/dpa` | SCCs / UK IDTA per region |
| **Vercel** | Processor — hosting/compute | Request data in transit (incl. any data in a request body) | Frankfurt (EU) | `vercel.com/legal/dpa` | EU region pinned (`fra1`) |
| **Cloudflare** | Processor — DNS, WAF, Turnstile, email routing | IP addresses, Turnstile token, forwarded inbound email | Global edge | Cloudflare customer DPA (dashboard/legal) | SCCs / UK IDTA |
| **Upstash** | Processor — Redis rate-limit counters | Short-lived counters keyed to user-id / IP (no profile data) | EU (⚠ confirm DB region) | Upstash trust/legal page or on request | SCCs / UK IDTA |
| **Resend** | Processor — transactional email | Recipient email address + message body | EU (⚠ confirm account region) | `resend.com/legal/dpa` | SCCs / UK IDTA |
| **PostHog** | Processor — cookieless analytics | Event data tied to user-id; IP at network level | EU (`eu.i.posthog.com`) | `posthog.com/dpa` | EU cloud selected |
| **Sentry** | Processor — error monitoring | Error traces (may incidentally include user-id) | EU via DSN (⚠ confirm org) | `sentry.io/legal/dpa` | EU region org |
| **Inbox/email provider** (Gmail forward target for contact@ / appeals@) | Recipient of forwarded mail | Inbound contact/appeals messages | Global (Google) | Google DPA / Workspace terms | SCCs |

## Notes for the controller's data protection contact

- **No data is sold or shared for marketing.** Every external recipient above is a service
  provider acting on instructions for hosting, delivery, security or diagnostics.
- **Cloudflare** is the only inherently-global layer (edge DNS/WAF). Its processing is limited
  to network-level data, bot-check tokens, and forwarding inbound mail. Its transfer mechanism
  should be recorded explicitly.
- **Supabase Auth SMTP** (used for magic-link/confirmation email) is part of the Supabase
  relationship; the sending domain/SMTP configuration lives in the Supabase dashboard.
- **Sub-processor lists:** Supabase, Vercel, Cloudflare, Resend, PostHog and Sentry each publish
  their own sub-processor lists. These should be reviewed and monitored for change.
- **"Standard contractual" gaps to confirm:** the three ⚠ region rows (Supabase, Upstash, Resend,
  Sentry) determine whether the "no transfers outside UK/EEA" statement in the DART is accurate.
  Confirm each account's region before that statement is made to Imperial.
