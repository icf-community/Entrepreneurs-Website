# D1 — Scalability and performance

Audit dates: 2026-09-28 to 2026-10-05. Branch `feat/connections`. Local only: the 10k corpus,
the Medium-sized DB container and every measurement below ran against the local Supabase stack
and a `scripts/perf-serve.sh` production build. Nothing touched production.

**Gate (programme Part D):** no query over 100 ms p95 at 10k members; LCP < 2.5 s and
INP < 200 ms on a mid-tier phone; a documented decision on the Auth hops.

**Result: pass, with one accepted exception** (`admin_connection_stats`, admin-only, now served
from a 10-minute cache) and two lab-method caveats (INP is measured in the lab, and the landing
page's WebGL hero can't be judged headless). The E3 prod window is still where the hosted numbers
are confirmed.

## 1. Database: every read the app makes, at 10k members

Harness: `supabase/tests/d1_rpc_timings.sql`. It runs ~70 read RPCs and table reads as
`authenticated` with real JWT claims (RLS and in-body gates paid). Each is run 1 warm-up + 20
times for three callers: a typical member (median degree), the most-connected hub, and an admin.
The whole run is one rolled-back transaction.

Corpus: 10,006 profiles, 196,231 accepted connections (`supabase/snippets/seed_scale_corpus.sql`
at 10k), laptop Postgres.

| Read (caller) | p50 ms | p95 ms | Note |
| --- | ---: | ---: | --- |
| admin_connection_stats (admin) | 199 | 202 | **Over 100 ms.** Admin-only dashboard, no per-member data → `cached("adminConnectionStats")`, 10 min TTL |
| list_directory_cards, page 100 (typical) | 58 | 87 | Offset 2,400; real members page with filters long before this depth |
| admin_profile_facets (admin) | 68 | 71 | |
| list_directory_cards with search (typical) | 56 | 66 | |
| admin_list_profiles with search (admin) | 42 | 46 | |
| list_directory_cards (typical) | 29 | 35 | |
| export_my_data (hub) | 19 | 24 | |
| list_my_connection_facets (hub) | 23 | 24 | was ~100 ms before 20260928000009 |
| list_my_connection_graph (hub) | 21 | 21 | |
| everything else | — | < 20 | 60 reads; 0 errors |

Fixes made in this audit (each A/B-timed with plain `\timing` against the old body, and checked
for identical output before being kept, per `tasks/lessons.md` 2026-09-29):

- `20260928000009_connection_facets_fast.sql`: semi-join on the unique names before
  `array_agg … order by`, `others` narrowed to three columns. Typical 8.5→3.7 ms, hub 100→14 ms
  (5k corpus). Same output on 11 members.
- `20260928000010_flagged_senders_fast.sql`: new `connection_events (event, created_at)` index.
  `sends` is now counted only for members who can be flagged (the threshold arithmetic is in the
  migration header). 105→12 ms; same 108 rows in the same order.
- `admin_connection_stats` cached (see table). Documented exception to "admins don't populate shared
  keys" in `lib/cache.ts`.
- Tried and **rejected**: a set-based `list_my_connection_graph`. It was slower on A/B (hub
  24→38 ms), so the migration was deleted and the 7-arg original restored.
- Harness fix: `supabase/checks/pg_stat_snapshot.sql` was filtering out every PostgREST call,
  because PostgREST wraps queries in `pg_catalog.json_agg`. It now filters catalog tables only.

Earlier fixes in the same programme, already recorded in `tasks/todo.md` (E1b):
- `20260928000007`: facets 200→7 ms; this had been 71% of DB time.
- `my_gate_state()`: 2→1 call per page.
- `cache()` now coalesces concurrent misses.
- The bookmark action no longer re-renders /opportunities.

## 2. Auth hops (F8 / B26): decision

Before this programme, every signed-in page made ≥ 3 sequential round trips to Supabase before
any page data: proxy `getUser()`, guard `getUser()`, then `is_admin` + the profile read. In the
first 250-VU run, GoTrue `getUser` was called 2.8× per page (p50 8 s, 48% timeouts) and caused
the 50.7% error rate.

**Decision (built):**
- `currentUser()` uses `getClaims()`: local JWT verification against the cached JWKS, in the
  proxy, guards, `getActionAuth` and the bookmark action.
- `my_gate_state()` replaces `is_admin` + profile with one RPC.
- Approval status is still read from the DB on every request, so bans stay instant.
- This segment also converted the remaining server `getUser()` callers to `currentUser()`:
  contact, admin layout and the new-listing pages, intake, profile, onboarding, pending, rejected.
- Four `getUser()` callers stay on purpose:
  - settings needs `user.identities`;
  - reset-password and the GitHub connect callback are auth flows;
  - the login client.
- The client `PostHogProvider` no longer calls `getUser()` on every page load. It was a network
  call to Supabase Auth made for analytics only.

**Owner, still open:** asymmetric JWT signing keys must be ON in Supabase (Auth → Signing keys).
On legacy HS256 keys, `getClaims()` silently falls back to a network `getUser()` and the gain is
lost. **Accepted tradeoff:** after "sign out everywhere", page access can lag by up to the JWT
expiry (1 h). Bans don't lag.

**fra1 vs lhr1:** not measurable locally. The comparison is moved to the E3 prod window (one
Vercel region switch, same k6 profile).

## 3. Request fan-out per page view

- **ConnectControl (B25):** 4 RPCs per dialog open → 1 (`connection_panel_state`).
- **Sidebar link prefetches.**
  - What happens: one hard page load makes ~21 RSC prefetch requests, a `/_tree` and a full
    prefetch for each of the ~11 sidebar links. The router reads the shell and then cancels the
    body, which shows up as `ERR_ABORTED` in browser tools.
  - Server cost, measured: each answers 200 in ~6 ms with **zero DB calls** (no `PERF_METRICS`
    lines), ~15 KB uncompressed. They render only up to each route's `loading.tsx`.
  - Client cache: client-side navigations reuse the prefetched shells, so the fan-out is per
    hard load, not per click.
  - **Decision: keep.** Prefetching is what makes the Part C skeletons appear instantly, and it
    costs no database time.
  - Caveat: k6 doesn't model these requests. Each one is a Vercel function invocation (~6 ms
    CPU), so D8 must count ~20 extra invocations per hard page load in the Vercel estimate.
- **Polling:** the CV/GitHub dialogs and the ingest badge use non-overlapping polls with backoff
  and pause-on-hidden (B8/B20).

## 4. Front end: lab Web Vitals

Method: `frontend/scripts/cwv-lab.mjs`.
- **Emulation:** Playwright Chromium with CDP throttling: Moto G4 viewport, 4× CPU, 150 ms RTT,
  1.6 Mbps down.
- **Target:** a `perf-serve.sh` build on the 10k corpus, signed in as a typical member.
- **Why not Lighthouse:** its simulated throttling is unreliable on localhost, and headless runs
  started failing with NO_FCP.
- **INP:** measured with the Event Timing API on real interactions (card expand, search typing)
  under 4× CPU. TBT is reported as the load-time proxy.

### Finding D1-F1 (High, fixed): hydration error #418 re-rendered three listing pages

**Affected:** /opportunities, /events and /vcs on every load, in production today. Also
/admin/members and /admin/users.

**Cause:** the masthead count line was a `<p>`, and while the count streams in it holds a
`<Skeleton>`, which is a `<div>`. The HTML parser closes a `<p>` when it meets a `<div>`, so the
browser's DOM differed from React's. React threw #418, discarded the server HTML and re-rendered
the whole page on the client. LCP moved from first paint (~0.9 s) to after hydration (~3.7 s).

**Fix:** the wrapper is a `<div>` on all five pages.

**Test:** `e2e/member.spec.ts` now fails on any `pageerror` while opening the three listing
tabs. Verified on the 10k build: 1 error per page before the fix, 0 after. On the small E2E seed the count can resolve before the shell flushes, which hides the bug, so the E2E check is a backstop and not the proof.

### Finding D1-F2 (Medium, fixed): long boards hydrated every card

**Cause:** /opportunities (240 open roles in the 10k corpus) and /events (153) rendered and
hydrated one client card per item: 504 KB of markup on /opportunities.

**Fix:** both now render the first 30 matches with a **Show more (n more)** button (ghost
`Button`, visible border). Search and filters still run over every item, and changing the search
starts from one page again.

**Test:** `e2e/member.spec.ts` seeds 31 roles and expects 30 cards, then 31 after Show more.

The wire size was never the problem: /opportunities is 34 KB gzipped.

### Finding D1-F3 (Low, fixed): posthog-js in every page's first load

**Cause:** posthog-js was statically imported in the root layout: ~90 KB gzipped on every page,
even where the key is unset.

**Fix:** it is now imported on demand, after hydration and only when the key is set. `track()`
queues until PostHog is ready.

**G8 gap closed at the same time:** `capture_pageview: true` sent a `$pageview` at init, before the
synthetic-account opt-out ran. The provider now reads the stored session locally first and never
loads PostHog for a synthetic account. /home first-load JS: 583 → 495 KB gzipped.

### Results after the fixes (two runs each, cold first run discarded)

| Route | FCP | LCP | TBT | Worst interaction (INP proxy) | CLS |
| --- | ---: | ---: | ---: | ---: | ---: |
| /home | 0.82 s | 0.82 s | 145 ms | — | 0 |
| /members | 0.82 s | 0.82 s | 152 ms | 16 ms (search typing) | 0 |
| /opportunities | 0.90 s | 0.90 s | 214 ms | 152 ms (card expand) | 0 |
| /events | 0.90 s | 0.90 s | 209 ms | 192 ms (card expand) | 0 |
| /vcs | 0.88 s | 0.88 s | 195 ms | — | 0 |
| /connections | 0.82 s | 0.82 s | 155 ms | 16 ms (search typing) | 0 |
| /community | 0.81 s | 0.81 s | 146 ms | — | 0.008 |
| /login | 0.82 s | 0.82 s | 136 ms | — | 0 |

**Before the fixes:**

| Route | LCP | TBT |
| --- | ---: | ---: |
| /opportunities | 3.7–4.2 s | 290–410 ms |
| /events | 3.8 s | 430–490 ms |

**Gate:** LCP < 2.5 s, pass on every route measured. INP < 200 ms, pass, but the card expand on
/events (192 ms at 4× CPU) is the closest to the line; it is the first thing to look at if field
data disagrees.

**Not judged here:**
- **Landing `/`:** TBT ~2.9 s comes from the three.js `HeroScene` under headless SwiftShader,
  i.e. software WebGL. That's a lab artefact. It gets a real-phone check in E5b (committee
  acceptance on their own phones).
- **Remaining shared JS:** ~495 KB gzipped on /home. The biggest pieces are the framework
  chunk with Sentry (130 KB) and supabase-js (62 KB). Both are needed on every signed-in page.
  There is no further cut without dropping a feature.

## 5. Capacity (E1b), cross-reference

Full numbers are in `tasks/todo.md` under E1b.
- **Stage 1 (250 VU):** passes locally on the DB projection (≈ 36–40% of Medium). End-to-end
  confirmation is the one E3 prod run.
- **Stage 2 (500 VU):** projected at ≈ 71% of Medium at think time 2 s, which is a coin toss.
  The projection is 31% at think 5 s.
- **Owner decides the E3 think time.**

## Open items

- **Owner:** asymmetric JWT signing keys ON (§2).
- **Owner:** E3 think-time choice (§5).
- **E3:** fra1 vs lhr1 (§2).
- **D8:** count ~20 prefetch invocations per hard page load in the Vercel estimate (§3).
- **E5b:** real-phone check of the landing page hero (§4).
