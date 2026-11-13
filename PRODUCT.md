# Product

Foundry — the private community platform for Imperial College London's startup
ecosystem, operated by Imperial Entrepreneurs.

## Platform

web

## Stack

Next.js 16 (App Router, RSC + server actions), React, TypeScript, Tailwind v4
(`@theme` token layer in `src/app/globals.css`), Supabase (Postgres, RLS, GoTrue
auth, SECURITY DEFINER RPCs), Upstash Redis (cache + rate limiting), Resend
(transactional mail via a queue table drained by a cron route), Cloudflare
Turnstile, Vercel hosting behind Cloudflare. pnpm. Playwright + Vitest.

## Users

Membership is closed and verified — every account is an Imperial affiliate. Six
audiences, taken from the live `/` copy:

- **Current students** — undergrad, postgrad and PhD, building while they study.
- **Recent grads** — within three years of graduating, figuring it out and moving fast.
- **Alumni founders** — Imperial alumni who have been through it and want to give back.
- **Mentors** — operators and experts who make themselves available to the community.
- **Angel investors** — angels actively looking at early-stage Imperial-connected startups.
- **Staff & faculty** — researchers and professors bridging academia and the startup world.

Students are admitted automatically on a verified `@imperial.ac.uk` / `@ic.ac.uk`
address; everyone else passes a manual admin check. Membership is free.

*Assumption (not user-confirmed): the dominant device split. The build treats
mobile as first-class regardless.*

## Product Purpose

Turn a scattered campus network into one place where introductions are warm,
opportunities are real, and membership is earned. Members build a profile
(skills, sectors, what they're looking for), browse a verified directory, and
post or find opportunities, events, and VC/grant listings.

## Positioning

Not a job board and not a public social network. A closed, verified directory
where the scarcity is the point: the value comes from everyone in it being a
real, checked Imperial affiliate. Its nearest comparators are alumni networks
and invite-only founder communities, not LinkedIn.

## Operating Context

Members read mail in Microsoft 365 (Imperial's tenant) and arrive largely from
campus networks and shared links. Traffic is bursty around events and term
milestones rather than steady. Admin review is a queue worked in batches, so
bulk actions are a real usage scene, not an edge case.

## Capabilities and Constraints

- Three listing types share one generic pipeline: opportunities, events, VC/grants.
- Admin review queues with bulk approve/reject, paged in Postgres.
- The whole app is dark-only and declares `color-scheme: dark`.
- Strict enforce-mode nonce CSP built in middleware — **any new script, style or
  WebGL surface must work under it, and inline script needs the nonce**.
- Upstash free tier: cache and rate limiter share one database and a 500K
  monthly command budget.
- PostgREST caps reads at 1000 rows; paging is mandatory, not optional.

## Brand Commitments

- **The logo is the fixed point** and the brief for the visual system: a white
  rocket roundel and a condensed grotesque wordmark on a black starfield, with
  the hand-lettered tagline "GO DO SHIT." Since 2026 the roundel is redrawn: the
  rocket is larger and **breaks out of the ring** through a gap at its top. The
  2025 logo is retired everywhere on the site and must not come back. Rules: one
  flat colour (white on the night), never rotated, cropped, outlined or crossed,
  ring at least 45 px, lockup at least 51 px tall, a quarter of the mark's height
  clear, never a word set beside the roundel alone (docs/design-system/logo.md).
- The product name **Foundry** sits alongside the organisation name **Imperial
  Entrepreneurs**; both appear in the nav lockup and in metadata.
- Data controller is IC Founders Ltd (Companies House 17171277).
- **Decided 2026-08-27 (superseded 2026-11-13 by the Lumen decision below):** the
  site's visual world is rebuilt around the logo — monochrome and high-contrast,
  condensed grotesque headlines, near-black surfaces, starfield as real texture.
  Gold is retired as the primary accent and survives only as a rare signal. The
  previous gold + DM Serif Display world is anti-reference.
- **Decided 2026-11-13:** the whole front end moves onto **Lumen** (DESIGN.md,
  docs/design-system/). Colour is light direction, not decoration: a night with
  six lights, where cream (sun) is the one action and the focus ring, amber
  (warm) is light itself and is never an action fill, and nothing is purple.
  Funnel Display for headings, Host Grotesk for everything else, no monospace.
  The landing page matches the Lumen mock; the signed-in app keeps a labelled
  left sidebar in the same language. Only the look changed: no content or
  behaviour. Live-page extras the mock left out (event spot counts and Reserve
  buttons, the mock signup form in Apply, per-card skills and sectors) are held
  back for the owner's later decision (docs/design-system/landing-extras.md).
- **Decided 2026-08-27:** the site's existing measured copy voice wins over the
  tagline's register. The tagline lives on the artwork; it does not set the tone
  for body copy, and copy is not to be rewritten as part of the redesign.

## Evidence on Hand

Real product content already written and live: six audience definitions, the
membership rules, three listing types with real fields, and a working directory.
Member-facing example cards on `/` are illustrative placeholders, not real
members. No customer logos, testimonials, metrics or press to draw on — and none
may be invented.

## Product Principles

- Earned access over open reach; the directory is the asset.
- Say what actually happened: no success screen over an unchanged database.
- Never leak who is registered — flows stay anti-enumeration by default.
- Accessibility is load-bearing, not a pass at the end.

## Accessibility & Inclusion

Already in place and **not to be regressed**: a single `:focus-visible` ring with
an offset chosen so it stays visible on filled buttons; `--color-border-strong`
at 3:1 for pressable boundaries (WCAG 1.4.11); a `prefers-reduced-motion` block
that lands entrance animations on their final state rather than leaving them at
`opacity: 0`, with a deliberate exception keeping spinners rotating slowly
because a frozen spinner reads as a hung request; a skip link; `color-scheme:
dark` so UA chrome and autofill do not paint light-on-light.

Any new motion — including the WebGL hero — must honour that reduced-motion
contract and must not become the LCP element.
