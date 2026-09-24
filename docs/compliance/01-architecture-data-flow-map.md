# 01 · Architecture & Data Flow Map

**System:** Imperial Entrepreneurs ("Foundry") platform — a members-only founder
community for Imperial College London students and alumni.
**Public URL:** https://imperialentrepreneurs.com
**Status:** DRAFT for the controller's review · authored from the live codebase.
**Controller:** IC Founders Ltd (Companies House 17171277) — see `02-ropa.md` §1. Imperial
College London is not the controller or a joint controller of this service.

---

## 1. What the system is

A Next.js 16 web application (React 19, TypeScript) backed by a Supabase Postgres
database. Members create a profile, browse a member directory, and post / browse
opportunities, events and VC/grant listings (all listings are admin-reviewed before
publication). The platform sends transactional email (acceptance, rejection, contact
replies) and runs cookieless product analytics and error monitoring.

There is **no AI/ML processing, no profiling, no automated decision-making with legal
effect, and no special-category data** collected by design.

## 2. Identity & access model

| User type | Sign-in method | Name source |
|-----------|----------------|-------------|
| **Current students** | Supabase magic link (email OTP) to an Imperial email (`@imperial.ac.uk` / `@ic.ac.uk`) | Typed by the user at signup |
| **Alumni** | Google OAuth, then **manual admin verification** before access is granted | Parsed from the Google profile name |
| **Admins** | Same as above; elevated via a write-locked `admins` table (no self-promotion possible) | — |

Authentication is handled by **Supabase Auth**. Confirmation / magic-link email is sent
through **Supabase Auth's own SMTP**, which is a separate path from the application's
transactional email (see §4).

## 3. Personal data inventory

| Data | Where stored | Source |
|------|--------------|--------|
| Email address, auth provider, sign-in timestamps | Supabase (`auth.users`) | User / Google |
| First name, surname | Supabase (`public.profiles`) | User / Google |
| LinkedIn URL, GitHub URL, portfolio URL (optional) | Supabase (`public.profiles`) | User |
| Graduation year, short bio, "what I'm working on" (optional) | Supabase (`public.profiles`) | User |
| Self-selected interests & expertise (skills/sectors) | Supabase (`profile_skills`, `profile_sectors`) | User |
| Listings posted (opportunities/events/VC-grants) incl. a contact email | Supabase (listings tables) | User |
| Contact / appeal messages (free text + email) | Email outbox + forwarded inbox | User |
| Queued outbound email (recipient + body) | Supabase (`outbound_email`), transiently | System |
| Admin audit log (who approved/rejected what) | Supabase (`admin_actions`) | System |

**Not collected:** Student ID / CID, date of birth, address, phone, payment data, and any
special-category data (health, ethnicity, biometrics, etc.). If a user volunteers such data
in a free-text contact message it is incidental — the platform never requests it.

## 4. Data flow (request lifecycle)

```
  Member's browser (HTTPS/TLS only)
        │
        ▼
  Cloudflare ──────────────► DNS, WAF, Turnstile bot-check (sign-up / forms)
        │                     Email routing for contact@ / appeals@
        ▼
  Vercel  (Frankfurt, fra1 — EU)   ── Next.js server + serverless functions
        │
        ├──► Supabase (Postgres + Auth)         [primary data store]   ⚠ CONFIRM region
        │       • Row-Level Security on all tables
        │       • SECURITY DEFINER RPCs gate every privileged write
        │
        ├──► Upstash Redis (EU)                 [rate-limit counters only — no profile data]
        │
        ├──► Resend (EU)                         [transactional email send — app outbox]
        │
        ├──► Sentry (EU via DSN)                 [error traces — errors only, no replay/PII]
        │
        └──► PostHog (eu.i.posthog.com — EU)     [cookieless product analytics]

  Supabase Auth ──► its own SMTP                 [magic-link / signup confirmation email]
```

**Email — two distinct paths (important):**
1. **Application email** (acceptance, rejection, contact replies) is enqueued to a Supabase
   `outbound_email` table and drained by a cron-triggered route (`/api/cron/drain-email`,
   every 5 min) that calls **Resend** in exactly one file. Recipient names are HTML-escaped
   and never placed in email headers.
2. **Auth email** (magic links, signup confirmation) is sent by **Supabase Auth's SMTP**,
   configured in the Supabase dashboard — not in the application code.

**Inbound contact / appeals:** `contact@imperialentrepreneurs.com` and
`appeals@imperialentrepreneurs.com` are **Cloudflare email-routing forwards** to a monitored
Gmail inbox. (This is a forward, not a Google Workspace "delegated access" model.)

## 5. Hosting & residency summary

| Layer | Provider | Region | Notes |
|-------|----------|--------|-------|
| Frontend / compute | Vercel | **Frankfurt (`fra1`), EU** | Pinned in `vercel.json` |
| Database & auth | Supabase | **⚠ CONFIRM** (DART draft assumes UK) | Encrypted at rest; TLS in transit |
| Rate-limit counters | Upstash Redis | EU (⚠ confirm DB region) | No personal data — short-lived counters keyed to user-id/IP |
| Transactional email | Resend | EU (⚠ confirm account region) | Recipient address + message body |
| Error monitoring | Sentry | EU via DSN (⚠ confirm org region) | Errors only; no tracing, no session replay |
| Product analytics | PostHog | EU (`eu.i.posthog.com`) | Cookieless (in-memory only); autocapture off; no session recording |
| DNS / WAF / email routing / bot-check | Cloudflare | Global edge | Turnstile token; inbound mail forwarding |

> **Transfers outside the UK/EEA:** The design intent is to keep storage and compute within
> the UK/EEA. This can only be asserted once every vendor account region in the ⚠ rows above
> is confirmed. Cloudflare operates a global edge network (DNS/WAF) — its role and transfer
> mechanism (UK IDTA / SCCs) should be noted to the DPO.

## 6. Security controls (defence in depth)

- **Transport:** HTTPS/TLS enforced site-wide; nonce-based Content-Security-Policy in middleware.
- **Database:** Row-Level Security enabled on **all** tables; every privileged write goes
  through a `SECURITY DEFINER` function with a fixed `search_path`; admin actions gate on
  `is_admin()`; the `admins` table is write-locked to `authenticated` (no self-promotion).
- **Input:** defence-in-depth validation — client checks → Zod schemas in server actions →
  RPC guards → Postgres CHECK constraints (length caps, URL format, name character rules).
- **Abuse:** Cloudflare Turnstile on sign-up/forms; a Cloudflare edge rate-limit rule
  (`flood-backstop`: 500 requests / 10 s per IP on all paths) as a flood/DDoS shield; and
  Upstash per-identity sliding-window limits (60/min per IP, 10/hour per user) for precise
  application-layer abuse control.
- **Secrets:** held in environment variables (Vercel / gitignored `.env`); the cron endpoint
  authenticates with a constant-time-compared bearer secret; the Supabase `service_role` key
  is used only server-side and never shipped to the browser.

See **04 · Internal Data Handling Protocol** for operational controls.
