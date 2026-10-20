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

## 6. DB headroom re-measured (S0 gap 39, 2026-10-19)

The ~6.7 ms DB CPU per request figure above predates migration 002's audience rewrites and the
S0/S1/S2/S3 concurrency and AI-operations work. Re-measured against the full 5,007-member scale
corpus (`seed_scale_corpus.sql`: ~29.8k `profile_skills`, 9,600 `cv_chunks`, 358 approved
opportunities), a `scripts/perf-serve.sh` build (2 instances, `PERF_INSTANCES=2`), and
`frontend/scripts/loadtest.js MODE=mixed STAGE=250 HOLD_SECONDS=120` (20 minted sessions, half
the VUs anonymous, half signed in and writing):

- **16,846 HTTP requests, 0 errors**, 630 bookmark on/off pairs, over the 150 s ramp-and-hold.
- `pg_stat_statements` summed to **33,360 ms** of DB exec time over the whole run →
  **≈ 1.98 ms DB CPU per request**, against the ≤ 4.5 ms target (≤ 50% of Medium at 500 VU /
  2 s think time). At the old ~6.7 ms figure the same VU/think combination projected ≈ 71% of
  Medium (the "coin toss" line in §5 above); at 1.98 ms the same projection is **≈ 21% of
  Medium** — the thin-headroom risk (gap 39) is closed, not just mitigated.
- No individual statement stood out as a fix target: the highest mean cost was
  `list_approved_opportunities` at 8.37 ms mean / 32.7 ms max over 631 calls, 100% cache hit,
  `EXPLAIN (ANALYZE, BUFFERS)` showing 3,155 buffer hits and zero reads for 268 returned rows.
  That is a Function Scan opaque to the outer plan (the RPC's own cost is not broken out by
  `EXPLAIN` at this level); nothing here needs the "fix the top offenders" step the plan allows
  for, because the aggregate figure already clears the gate with room to spare.
- **`supabase/checks/invariants.sql` passed (all 10 groups) both before and after the run** —
  no duplicate decisions, no orphan rows, no stuck leases, counters matched row counts.
- New `scale_query_plans.sql` §9/§9b measured the optimistic-concurrency trigger added in
  `20261011000007` under this same corpus: `update_profile` with the `edit_version` check ran in
  7.1 ms end to end (one version bump, not one per related-table row), and a stale
  `p_expected_version` was refused in-plan rather than falling through to a scan. The bulk
  `admin_delete_user`-style cascade exercised by §8k-iii (2.1 s for the whole decomposed cohort
  delete, pre-existing and documented in that section) showed the new `related_edit_version`
  trigger adding ~50 ms of its 2.1 s total across 5,413 `profile_skills` row events — noise
  against an already-expensive, rare, admin-only path.
- New `scale_query_plans.sql` §10 measured `exec_memory`'s exact owner-scoped vector scan
  (`20261011000004`) at its stated ~280-message-per-member ceiling directly (not at the 5,007-
  member corpus scale, since the scan is `owner_id`-filtered and cross-member row count never
  enters the plan): 280 messages × `vector(1536)`, `Index Scan` on `messages_owner_created_idx`
  pre-filtering by owner before the exact distance sort, **1.3–2.0 ms execution**. The "no
  HNSW" call in that migration's header holds at this ceiling.
- **Fixture gap found and fixed, not a product bug:** `seed_scale_corpus.sql` set
  `opportunities.status` but never `eligible_audience` (added in `20261006000002`, after the
  corpus seeder was last touched), and never populated `member_education` at all — both NULL
  means "not yet classified" by design, so every audience-gated read
  (`list_approved_opportunities`, the bookmark policy, `viewer_admits_audience`) returned zero
  rows for the whole corpus regardless of how many opportunities were approved. Fixed in the
  seeder: opportunities now get a `both`/`students`/`graduates` mix (a few left `NULL` on
  purpose, to keep the admin "needs review" state represented), and every corpus member gets a
  `member_education` row backfilled from the role already assigned to them.
- **Local-only CLI quirk, not a data issue:** `scale_query_plans.sql` §8k-iii called
  `admin_delete_graduates`, which `20261011000005` (S1, gap 17) retired and revoked from every
  client role when graduates moved to a status transition instead of bulk deletion. Calling a
  revoked `SECURITY DEFINER` function as `authenticated` segfaults the local Supabase CLI 2.116
  Postgres image (`docs/audits/D9-concurrency.md`); Postgres restarted cleanly and no data was
  lost, but the section was rewritten to skip that now-dead call rather than work around the
  segfault, since the function is unreachable from the app regardless.
- Scale corpus removed after the run (`drop_scale_corpus.sql`); local DB back to its normal
  seven-account state, `invariants.sql` clean, full `pytest` (408) and SQL suites clean.

## 7. Listing RPCs and AI paths at 10k, post-migration-002 (S7, gap 26, 2026-10-20)

### Listing RPCs

`seed_scale_corpus.sql` bumped (temporarily, via a copy — the file's own default stayed at 5,000)
to `n_members := 10000` and re-run, then `d1_rpc_timings.sql` against it (10,011 profiles): **every
read holds the same shape as §1**, no regression from migration 002's audience rewrites or the
S0–S3 concurrency/AI-operations work. Only `admin_connection_stats` exceeds 100 ms p95 (202 ms,
unchanged from §1) — the same accepted, already-cached exception. The scale corpus was then
dropped (`drop_scale_corpus.sql`) and `invariants.sql` re-confirmed clean.

**Found and fixed in the process, not a product bug:** `drop_scale_corpus.sql` never deleted
`connection_events` — that table has no FK to `profiles` at all, by design (its own header:
"a connection row that may no longer exist"), so cascading delete never touches it, and nothing in
the drop script deleted it explicitly either. 10,000 dropped corpus members left 499,374 orphaned
rows behind, which `invariants.sql`'s #6 daily-cap check (correctly) failed against on this run.
Fixed by adding an explicit `delete ... where actor_id = any(v_ids) or subject_id = any(v_ids)`
step, scoped by id like the rest of that script. Re-verified: `invariants.sql` passes all 10 groups
after a clean drop.

### AI paths

`server/evals/corpus.py --size 10k` (closes S5's "10k on demand" item too): **recall@200 = 1.0** on
all three modes, nDCG@10 mean .965/.972/1.000 (network/recruiter/opportunities), zero ineligible
results, zero grade-3 matches lost — same PASS as the 2k run (D5's S5 work), now confirmed at the
plan's stated 10k scale.

The harness was instrumented to also capture wall-clock latency per call for `exec_retrieve`,
`ai_result_cards` and `ai_turn_status` (the real RPCs a finished turn's UI reads). Measured over the
36 real queries in that run:

| RPC | p50 ms | p95 ms | max ms |
| --- | ---: | ---: | ---: |
| `exec_retrieve` | 79.1 | 199.5 | 220.2 |
| `ai_result_cards` | 4.3 | 13.7 | 24.9 |
| `ai_turn_status` | 2.0 | 3.1 | 3.3 |

`ai_result_cards` and `ai_turn_status` comfortably clear both the general 100 ms DB gate and the
plan's 2 s "through the routes" gate for chip rerun/reopen/replay/result cards — "rerun"/"replay"
are the same `ai_submit_turn` path already exercised by every query in this run, not a separate
route. Composed with §3's already-measured ~6 ms, zero-DB RSC route overhead, the full route-level
cost for these stays well under 2 s.

**`exec_retrieve`'s 199.5 ms p95 did not clear the 100 ms gate. Investigated, fixed, and
re-verified — resolved, not just flagged.**

First signal it wasn't pure corpus-size cost: the same measurement at `--size 50` (an earlier
sanity check) already showed p95 160 ms, p50 73.5 ms — nearly identical to the 10k numbers (p50
79.1 ms). Confirmed directly with `EXPLAIN (ANALYZE, BUFFERS)` against a synthetic 10,000-row
`member_docs` table (same query shape, local rollback transaction, not kept): the `pool` CTE was
`materialized`, forcing Postgres to fully evaluate `ai_private.member_candidate_ok()` over a `Seq
Scan on member_docs` **before** any of the three scoring legs ran — and because `vec`'s
nearest-neighbour ordering then ran against that already-materialized CTE (`CTE Scan`, not `Index
Scan`), the `member_docs_embedding_idx` HNSW index was never touched at all, nor were the GIN
indexes the exact/lexical legs could otherwise use.

**Fix** (migration `20261011000009_exec_retrieve_index_fix.sql`, raised to the user before writing
anything and approved as "design it now, as its own reviewed step"): gave each of the three scoring
legs (exact/lexical/vector, both the member and the opportunity branch) its own independently
filtered CTE instead of one shared `materialized` pool, joined back with `FULL JOIN`s. Same
`member_candidate_ok`/`job_candidate_ok` eligibility filter applied on every leg — not relaxed on
any of them — just evaluated per-leg instead of once; verified with a before/after row-level diff
against synthetic data with negated-concept and ineligible-member rows planted: **identical 20
ranked rows, identical order**, before concluding it was safe. Confirmed with `EXPLAIN` post-fix
(with `ANALYZE` run so the planner had real stats): the vector leg now uses
`Index Scan using member_docs_embedding_idx`, 31 ms instead of ~980 ms for that leg alone on the
same synthetic data; the lexical leg now uses `Bitmap Index Scan on member_docs_tsv_idx`.

**Re-measuring through the same `evals/corpus.py --size 10k` harness after applying the migration
did NOT show the improvement (p95 219 ms, if anything noisier)** — which is itself the tell that the
harness's own number was never really measuring `exec_retrieve`'s SQL cost. That harness's
`_run_executor_once` opens a brand-new `asyncio` loop and a brand-new `psycopg` connection (full
handshake and auth) for every one of the 36 queries, by design (it docstrings "exactly one queued
turn per call"); that per-call reconnect cost is a corpus-size-independent floor that swamps the
real, much smaller SQL-execution signal underneath it. Isolated with a dedicated one-off script
(`evals/corpus.py`'s own seeding/promotion helpers, 10,001 real promoted members, one warm
connection reused for 10 repeated direct `exec_retrieve` calls against a real queued-and-claimed
turn): **min 0.96 ms, median 1.25 ms, max 11.08 ms** — two orders of magnitude under the gate.

Full regression run after the migration: `ai_smoke.sql` (grants/fence/isolation checks) passed;
the full Python integration suite (127) and offline suite (346 passed, 127 skipped) passed; the 2k
and 10k retrieval-quality gates (recall@200, nDCG@10, ineligible/grade3-lost) stayed PASS,
unchanged from before the fix.

**Recommended follow-up, not done here:** the corpus harness's own per-call connection-reuse issue
is now understood but not fixed in `evals/corpus.py` itself (its "exactly one turn per call"
contract is deliberate and used by the retrieval-quality gates; changing its connection lifetime is
a separate, smaller piece of work than this fix, left for later since the true number is now known
by the direct check above).

`exec_memory` was already measured directly (§6, S0 gap 39 work): 1.3–2.0 ms execution at its
stated ~280-message-per-member ceiling — comfortably inside the gate, and that scan is
`owner_id`-scoped so corpus-wide member count never enters its plan.

### ETag/304 polling and the Stage 1 AI rerun

`frontend/scripts/loadtest.js` gained an `AI=1` mode: each signed-in VU submits a real
`ai_submit_turn`, polls the actual `/api/ai/turns/:id` route to completion honouring `ETag`/
`If-None-Match` (a 304 counted as the expected cheap case, not an error), then reads
`ai_result_cards` and `ai_get_conversation` ("reopen"), each its own latency series gated at
p95 < 2 s. Code-reviewed and syntax-checked; the polling route itself was also read end-to-end
(`frontend/src/app/api/ai/turns/[id]/route.ts`) and does implement conditional ETag/304 exactly as
designed.

**Not actually run as a k6 pass against Stage 1 (250 VU) — a scope decision, not an oversight.**
`mint-loadtest-sessions.mjs` only mints sessions for `seed_scale_corpus.sql`'s own accounts (a fixed
bcrypt password baked into that seeder), and those accounts have no AI projection at all — no
`ai_private.member_settings` row, no promoted `member_docs` (that pipeline is `evals/corpus.py`'s,
which creates its own passwordless service-role accounts, mintable by nothing). Standing up a real
k6-drivable AI load pass needs a fixture that is neither of these: accounts with a known password
*and* a built AI projection *and* `network_discoverable` on. Building that combined fixture, or
mutating the shared `e2e-*` accounts (which do have known passwords but are curated, order-sensitive
state for other specs) is real new work, not a rerun of an existing script — left for a follow-up
rather than risking either a rushed new fixture or a side effect on `e2e-*`'s existing AI consent
tests.

## Open items

- **Owner:** asymmetric JWT signing keys ON (§2).
- **Owner:** E3 think-time choice (§5).
- **E3:** fra1 vs lhr1 (§2).
- **D8:** count ~20 prefetch invocations per hard page load in the Vercel estimate (§3).
- **E5b:** real-phone check of the landing page hero (§4).
- **§7:** `evals/corpus.py`'s per-call connection reconnect in `_run_executor_once` dominates its
  own latency numbers — understood, not fixed (direct measurement used instead for the §7 gate).
- **§7:** a combined known-password + AI-projection account fixture, to actually run the AI=1
  `loadtest.js` mode against Stage 1/2.
