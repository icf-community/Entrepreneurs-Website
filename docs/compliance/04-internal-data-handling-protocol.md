# 04 · Internal Data Handling Protocol

How the Imperial Entrepreneurs team accesses, secures and minimises personal data.
DRAFT for the controller's review. Describes controls as built, plus the operational
practices the team commits to.
**Controller:** IC Founders Ltd (Companies House 17171277) — see `02-ropa.md` §1.

---

## 1. Principles

- **Data minimisation.** Only the fields needed to run a member community are collected
  (names, email, optional profile links/bio, interests). No CID, DOB, address, phone,
  payment or special-category data is requested.
- **Least privilege.** Members can only read/write their own data plus what is shared with
  the community by design. Elevated actions require admin status, which cannot be self-granted.
- **Defence in depth.** Every privileged write passes through multiple independent checks
  (client → server validation → database RPC guard → constraint/RLS).

## 2. Access control (enforced in the database)

- **Row-Level Security (RLS) is enabled on all tables.** A signed-in user cannot read or
  modify another user's private rows; policies scope access to `auth.uid()`.
- **Privileged writes** go through `SECURITY DEFINER` functions with a fixed `search_path`;
  admin-only functions begin by checking `is_admin()` and raise `Forbidden` otherwise.
- **The `admins` table is write-locked** for ordinary authenticated users (SELECT-only) — a
  user cannot promote themselves to admin. Admin grants are made deliberately, out of band.
- **The Supabase `service_role` key** (which bypasses RLS) is used **only in server-side code**
  (e.g. the email-drain route) and is never exposed to the browser.

## 3. Who has access, and how

| Role | Access | Controls |
|------|--------|----------|
| Member | Own account + community-shared data, in-app only | RLS; magic-link / Google auth |
| Admin | Review queues, member management, audit log | `is_admin()` gate; actions logged in `admin_actions` |
| Operators (IAA) | Supabase dashboard / Vercel / vendor consoles | ⚠ Each must use individual accounts with MFA — **no shared logins or shared passwords** |
| Inbox monitors | contact@ / appeals@ forwarded mail | Access the monitored inbox individually; no credential sharing |

> **Commitment:** every administrative console (Supabase, Vercel, Cloudflare, Resend, PostHog,
> Sentry, Upstash, the email inbox) is accessed via **individual named accounts with
> multi-factor authentication enabled**. Shared passwords are prohibited.

## 4. Secrets management

- All credentials (Supabase keys, `RESEND_API_KEY`, `CRON_SECRET`, Upstash tokens, DSNs) live
  in **environment variables** — in Vercel for production and in a **gitignored** `.env` locally.
  They are **never committed** to the repository.
- The cron endpoint authenticates with a bearer secret compared in **constant time**.
- **Key rotation:** secrets are rotated on any suspected exposure and on operator offboarding
  (see **05 · Breach Response** for the rotation runbook).

## 5. Input safety & abuse prevention

- All user input is validated client-side, re-validated server-side (Zod schemas), and
  bounded by database CHECK constraints (length caps, URL-format and length limits, name
  character rules).
- Output is auto-escaped by React; no raw HTML injection (`dangerouslySetInnerHTML` is not
  used for user content). Email templates HTML-escape names and never place them in headers.
- **Cloudflare Turnstile** guards sign-up and public forms. Two rate-limit layers protect the
  service: a **Cloudflare edge rule** (`flood-backstop`: 500 requests / 10 s per IP on all paths)
  as the flood/DDoS shield, and **Upstash** application-layer sliding-window limits
  (60/min per IP, 10/hour per user) for precise per-identity abuse control.

## 6. Data subject support

- Members can **edit** their profile and **delete their entire account** (and all owned
  listings and joins) themselves from Settings.
- Access / portability requests are currently fulfilled **manually** by an operator exporting
  the user's rows from Supabase. ⚠ This manual procedure should be written up and a response
  SLA agreed with the DPO.

## 7. Change management

- All code changes go through Git with CI (lint, type-check, tests, RLS smoke test, end-to-end
  tests) before deploy. Database changes are version-controlled SQL migrations under
  `supabase/migrations/`.
- Production deploys are made via Vercel's GitHub integration from the `main` branch.

## 8. Operator offboarding checklist

When a team member leaves:
1. Remove their access from every console (Supabase, Vercel, Cloudflare, Resend, PostHog,
   Sentry, Upstash, inbox).
2. Remove their `admins` row if they were an admin.
3. Rotate any shared-by-necessity secret they could have seen.
4. Record the change.
