# Cloudflare surge runbook

Repeatable team procedure for a known traffic spike (a launch, a packed event) or an unplanned one.
Tracked in git, unlike `production-runbook.md` (gitignored personal ops notes) — this has no secrets
in it and nobody should have to re-derive it under pressure. No Cloudflare API token exists anywhere
in this repo (confirmed — `gh secret list`/`gh variable list` come back empty of anything
Cloudflare-related, per `production-runbook.md`), so everything below is a dashboard checklist, not a
script.

## What's actually safe to cache, and why the list is short

**Cacheable at the edge: exactly `STATIC_CSP_ROUTES` in `frontend/src/lib/csp.ts` — `/`, `/privacy`,
`/terms`, `/cookies`. Nothing else, even though several other pages are publicly readable.**

The reason is CSP, not content sensitivity, and it's worth being precise about it because it's easy
to assume "public page" means "cacheable page" — it doesn't, here:

- Every other page (`/committee`, `/events*`, `/opportunities*`, `/vcs*` included) is rendered with a
  **per-request CSP nonce** (`proxy.ts` + `buildCsp()`). Caching a response that embeds a nonce
  doesn't just risk a stale/broken page — Cloudflare caches the full response, headers included, so a
  cached hit would actually serve headers and body that still match each other. The real problem is
  quieter: the SAME nonce then gets replayed to every visitor for the cache's whole TTL, which
  defeats the nonce's actual security property (unpredictability). A cached nonce is a guessable
  nonce, and `script-src 'nonce-…'` protection against injected `<script>` tags is only as strong as
  that unpredictability.
- `csp.ts`'s own module comment states this directly: *"a statically rendered page CANNOT carry a
  per-request nonce... a route is either dynamic-with-strict-CSP or static-with-unsafe-inline. There
  is no third option."* `STATIC_CSP_ROUTES` is deliberately narrow — a page qualifies only if it (a)
  is reachable signed out, (b) needs no session, (c) renders **no user-supplied content of any kind**.
- `/committee`, `/events`, `/opportunities`, `/vcs` all fail (c): they render database-sourced,
  member/admin-authored text (committee bios, listing descriptions). They were deliberately kept off
  `STATIC_CSP_ROUTES` for exactly that reason — see that file's comment and
  [[cv-matchmaker-phase1-shipped]]'s sibling session note on B3.4, which originally assumed
  `/committee` could join this list and found the CSP coupling only after reading `csp.ts` directly.
  Don't repeat that assumption here: page-level Cloudflare caching has the identical coupling to
  Next's own ISR, since both are "the HTML gets reused across requests" regardless of which layer
  does it.
- `frontend/next.config.ts`'s `AUTHENTICATED_SEGMENTS` array independently corroborates this for the
  listing pages — `events`, `opportunities`, `vcs`, `members`, etc. already get `Cache-Control:
  no-store` from Next itself, because per-visitor state (bookmarks, admin controls, session) can
  change what's on the page even where the underlying listing is public-ish.

If a genuine need to cache one of these pages ever comes up, the fix is the same one `/` already
went through: audit the page's whole component tree against `STATIC_CSP_ROUTES`'s three criteria,
add it there (which also means giving up the strict nonce policy for that page — a real trade, not a
free one), and update `proxy.ts`'s matcher — not a Cloudflare-only cache rule layered on top of a
route that's still dynamically nonce-rendered.

## Explicit exclusions — never cache, cache rule or otherwise

Everything in `next.config.ts`'s `AUTHENTICATED_SEGMENTS` (`home`, `profile`, `settings`, `admin`,
`calendar`, `community`, `intake`, `onboarding`, `members`, `opportunities`, `events`, `vcs`,
`messaging`, `my-activity`, `my-bookmarks`, `my-submissions`, `pending`, `rejected`, `connections`), plus:

- `/api/*` — every route here either mutates state, serves the CV/GitHub image redirect (which itself
  must never be cached — see B3.4: each hit needs a fresh SAS), or is a cron endpoint.
- `/auth/*`, `/login`, `/reset-password` — session-bearing or credential-taking; the highest-value
  phishing/XSS targets in the app, and `csp.ts`'s own comment calls `/login` out by name as
  deliberately excluded from the static list even though it's public.
- `/contact` — same reasoning as `/login`: public, but takes user input.
- `/committee` — public, but not on `STATIC_CSP_ROUTES` (see above) — do not add a Page Rule for it.

Anything not explicitly listed as cacheable above defaults to **not cacheable** — don't infer
safety from "it's public" alone; confirm against `STATIC_CSP_ROUTES` first.

## Order of operations

**Free plan — 3 Page Rules total, shared with anything else already using them.** Confirm current
usage in the dashboard before spending one here.

### Pre-emptive (flip before a known event, e.g. a launch or a scheduled push)

1. Dashboard → **Rules → Page Rules** (or **Cache Rules**, the newer equivalent — prefer Cache Rules
   if available on the zone, since they don't compete with the legacy 3-rule cap).
2. Create a rule matching exactly the cacheable path list above (`imperialentrepreneurs.com/`,
   `/privacy`, `/terms`, `/cookies` — no wildcards that could accidentally widen the match to a
   dynamic sub-path).
3. Setting: **Cache Level → Cache Everything**, with a bounded **Edge Cache TTL** (start at 5-10
   minutes, not hours — these pages do occasionally change, e.g. legal copy updates, and a long TTL
   trades staleness for cache-hit rate).
4. Confirm the rule is live: `curl -I https://www.imperialentrepreneurs.com/` from a residential IP,
   look for `cf-cache-status: HIT` on the second request.

### Reactive (during an unplanned spike, not pre-flighted)

1. **Cloudflare "I'm Under Attack" mode** (Security → Settings) — a JS challenge in front of every
   request. Last resort: it will also challenge every legitimate visitor, and per
   `production-runbook.md`'s existing findings, this zone's Bot Fight Mode (Free plan) already
   sometimes flags legitimate automated traffic (GitHub Actions runners got a false-positive `403` —
   see that file's CI gotchas section) — "Under Attack" mode is a strictly heavier version of the
   same tool and will catch more false positives, not fewer. Use only if the site is genuinely
   struggling to serve real traffic, not as a first response.
2. **Bump the cacheable-pages TTL** temporarily (the rule from the pre-emptive section, if not already
   live — create it now) — reduces origin load for the highest-traffic pages fastest, since `/` is
   the app's most-requested route (per C2 Finding 6, 12.3s p95 at 500 VUs before it joined
   `STATIC_CSP_ROUTES`).
3. **nginx flood guard on the upload gateway** (`infra/vm/nginx-foundry-gateway.conf`) is a separate
   surface from the frontend — already tuned for launch scale (`rate=10r/s`/`burst=300 nodelay`, see
   `production-runbook.md`). If the gateway specifically is the bottleneck (image/CV uploads, not
   general page traffic), that config's own comment block covers retuning it — not a Cloudflare-side
   fix.
4. Do **not** reach for a WAF custom rule to solve a traffic-volume problem — confirmed dead end for
   this zone's plan tier (`production-runbook.md`'s Bot Fight Mode section: Free-plan Bot Fight Mode
   doesn't run on the Ruleset Engine at all, so no custom rule — Skip or otherwise — can carve out an
   exception for it; only paid Super Bot Fight Mode supports that).

## Rollback checklist

A stale cache-everything rule left on after the spike is its own bug class — stale directory/event
data (well, not directory/events, since those were never cached — but stale legal-copy or homepage
content) served for hours to some fraction of visitors depending on edge cache distribution.

1. Delete or disable the Page/Cache Rule created above (dashboard → **Rules**).
2. Purge cache for the affected paths (**Caching → Configuration → Purge Cache → Custom Purge**,
   enter the exact URLs) rather than waiting out the TTL — a purge is immediate, a TTL expiry is not.
3. Confirm: `curl -I https://www.imperialentrepreneurs.com/`, look for `cf-cache-status: DYNAMIC` or
   `MISS`, not `HIT`.
4. If "I'm Under Attack" mode was enabled, turn it back to **Essentially Off** or **Low** — it is not
   meant to be a standing setting.

## Cross-references

- `production-runbook.md` — the CI health-check `403` investigation (Bot Fight Mode dead end, the
  WAF-skip-rule attempt that couldn't have worked on Free plan) and the nginx flood-guard tuning.
  Read before re-attempting either during an incident; both were already tried and ruled out or fixed.
- `frontend/src/lib/csp.ts` — `STATIC_CSP_ROUTES` and the reasoning above in full.
- `frontend/next.config.ts` — `AUTHENTICATED_SEGMENTS`, the canonical never-cache list.
