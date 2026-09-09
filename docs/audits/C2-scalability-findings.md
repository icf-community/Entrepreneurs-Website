# C2 — Scalability audit findings

**Run:** 2026-09-08 · **Corpus:** 2,000 members seeded locally
(`supabase/snippets/seed_scale_corpus.sql`) · **Harnesses:**
`supabase/tests/scale_query_plans.sql`, `frontend/scripts/loadtest.js`

---

## What was measured, and what these numbers are worth

Two harnesses, answering two different questions the plan was careful to
separate:

- **2,000 registered members** — a database-shape question. Answered by
  `explain (analyze, buffers)` against a real corpus, run as
  `authenticated` through the actual RPCs.
- **Concurrent traffic** — a rendering and connection question. Answered
  by k6 at 100 / 250 / 500 virtual users against a production
  `next start` build.

**Both ran on one laptop**, with Postgres in a container and k6 competing
for the same cores. The absolute milliseconds are not Vercel's or
Supabase's and must not be quoted as if they were. What transfers is the
*shape*: which path is slowest, where the curve bends, whether failure is
queueing or exhaustion, and plan structure — `loops=N`, seq-vs-index,
buffer counts. Every conclusion below rests on those, not on wall clock.

One measurement in this document was initially taken while a `pnpm build`
was running and was 15% high; it was rerun clean. Numbers here are from
runs with nothing else on the machine, second (warm) pass.

---

## Finding 1 — A real defect on the directory search. Found, fixed, verified.

**Severity: high — it was the slowest path in the product, on a control a
member touches by typing.**

`list_directory_cards` with a text query: **339 ms**, against 6 ms for the
same call with no query and 2–10 ms for every listing board. Thirty times
the next-slowest read.

`auto_explain` on the real parameterised call:

```
SubPlan 3
  ->  Nested Loop (actual time=0.152..0.152 rows=0 loops=1834)
        ->  Seq Scan on skills s_1 (actual rows=0 loops=1834)
```

**`loops=1834`.** The 167-row `skills` table was sequentially scanned once
per candidate profile — ~279 ms of the 300 ms. The free-text branch
matched skills through a correlated `EXISTS` whose expensive half
(`s.name ilike '%' || p_query || '%'`) depends only on the parameter, not
on the row, but sat inside the correlation and so ran per row anyway.
`sectors` got identical treatment, cheap only because it has 7 rows.

**Two things hid this, and both are worth remembering:**

1. **A literal pattern plans completely differently from a parameter.**
   Write `s.name ilike '%payments%'` and Postgres converts it to a
   `hashed SubPlan`, runs it once, and the query finishes in 5 ms. Only
   the parameterised form — the only form that ever actually runs — is
   slow. Every hand-check with a literal in it came back clean.
2. **At ~30 rows it is unmeasurable.** 30 loops over a nearly-empty
   `skills` table is noise. It needed a real corpus *and* the real call
   shape to appear at all. This is precisely the failure mode C2 was
   written to catch, and it is the justification for the whole audit.

**Fix:** `supabase/migrations/20260908000001_directory_search_hoist.sql`.
Resolve matching skill/sector ids once in `MATERIALIZED` CTEs; the
per-row test becomes an indexed membership check.

**`MATERIALIZED` is the fix, not an implementation detail.** Written as
plain CTEs the migration changed nothing (339 → 298 ms): since PostgreSQL
12 a CTE referenced once is inlined by default, so the planner folded both
straight back into the correlated subquery and re-derived the identical
`loops=1834`. Moving code out of a subquery is not enough — the optimiser
has to be told not to move it back.

| path | before | after |
| --- | --- | --- |
| **directory, text search** | **339 ms** | **12.6 ms** (27×) |
| directory, no query | 6.3 ms | 6.6 ms |
| directory, deep page (offset 1000) | 11.4 ms | 11.7 ms |
| directory, skill filter | 35.2 ms | 35.6 ms |
| directory facets | 93.0 ms | 91.1 ms |

**Verified, not assumed.** The old body was loaded side by side as
`list_directory_cards_OLD` and both were run over 22 probe queries —
null / empty / no-match, personal names, a course, real skill and sector
names, upper- and lower-cased variants, `%` and `_`, both sort orders, and
combinations with the role/sector/skill filters — comparing set
membership, **row order**, `total_count`, `skill_names` and
`sector_names`. **Zero differences.** Probes confirmed non-vacuous: the
skill-name probe matched 66 rows, the sector-name probe 100.

The `p_skills` / `p_sectors` *filter* branches carry a similar shape and
were deliberately **left alone**: the audit measured them at 35 ms because
`= any(...)` on an indexed column is a different inner plan from an
unanchored `ilike` over a whole table. Changing code the measurement did
not implicate is how a performance fix acquires a correctness bug.

---

## Finding 2 — Read paths at 2,000 members are otherwise healthy

Warm, second pass, as `authenticated` through the real RPCs.

| RPC | rows returned | time | buffers |
| --- | --- | --- | --- |
| `list_approved_vcs_grants` | 24 | 0.8 ms | 195 |
| `list_community_feed` (page 2) | 20 | 0.5 ms | 153 |
| `list_community_feed` (page 1) | 20 | 1.3 ms | 408 |
| `list_approved_events` | 153 | 2.2 ms | 502 |
| `admin_list_profiles` (queue) | 25 | 2.7 ms | — |
| `admin_list_profiles` (all 2000) | 25 | 4.7 ms | — |
| `list_directory_cards` | 24 | 6.6 ms | 959 |
| `list_approved_opportunities` | 268 | 10.2 ms | 2,958 |
| `list_directory_cards` (offset 1000) | 24 | 11.7 ms | 308 |
| `list_directory_cards` (text search) | 24 | 12.6 ms | — |
| `list_directory_cards` (skill filter) | 24 | 35.6 ms | 9,342 |
| **`list_directory_facets`** | 1 | **91.1 ms** | 1,082 |

Two notes:

- **`list_directory_facets` at 91 ms is the remaining outlier.** It is
  cached in Upstash for an hour, which is exactly why nobody had looked at
  its uncached cost — but that is the bill on every cache miss and every
  deploy. Not urgent; worth knowing it is 90 ms and not 5.
- **Offset paging is not the problem it is usually assumed to be here.**
  `offset 1000` cost 11.7 ms against 6.6 ms for the first page, and
  touched *fewer* buffers. No action.

---

## Finding 3 — The `cv_chunks` vector scan needs its index before Phase 2

```
Seq Scan on cv_chunks (actual time=0.056..138.606 rows=9600 loops=1)
  Buffers: shared hit=50863 read=8136
Execution Time: 140.713 ms
```

**One** similarity search over 9,600 chunks: **140 ms and ~59,000 buffers
(~460 MB touched)**, a full sequential scan of the table, every time.
`20260906000001:95` defers the HNSW index deliberately, and at today's row
count that was the right call.

It stops being right at Phase 2. The corpus here is 9,600 chunks —
roughly *half* the ~20,000 that 2,000 fully-ingested members produce, so
the real figure is nearer **280 ms per search**. The agent issues several
searches per conversational turn, so that is approaching a second of pure
vector scanning per turn before a single token is generated, and it
scales linearly with membership while contending with everything else on
the same database.

**Recommendation: the HNSW index is a Phase 2 prerequisite, not a
follow-up.** Size it against whatever Postgres the agent ships on — and
note the index roughly doubles the vector storage, which runs directly
into Finding 4.

---

## Finding 4 — Storage: the free tier is the real ceiling, and it is close

Database total at this corpus: **189 MB**.

| table | rows | heap | indexes | total |
| --- | --- | --- | --- | --- |
| `cv_chunks` | 9,600 | 87 MB | 2.5 MB | **90 MB** |
| `cv_skills` | 5,190 | 42 MB | 0.9 MB | **43 MB** |
| `listing_events` | 19,912 | 3.6 MB | 5.9 MB | 9.6 MB |
| `profiles` | 2,005 | 1.3 MB | 5.8 MB | 7.2 MB |
| `post_likes` | 12,389 | 1.7 MB | 2.4 MB | 4.1 MB |
| everything else | — | — | — | ~35 MB |

**Two thirds of the database is embeddings**, and `cv_chunks` here holds
only about half the chunks a fully-ingested 2,000-member population
produces. Extrapolating: ~180 MB of chunks + 43 MB of `cv_skills` +
~45 MB of everything else ≈ **270 MB**, before an HNSW index that roughly
doubles the vector column, and before WAL and bloat.

**Supabase free tier is 500 MB, with no dashboard backups
([[supabase-free-tier-backup]]).** The B0 estimate said "past half"; the
measurement says past half *without* the index that Finding 3 says is
needed. Adding it lands in the 400–450 MB region — real headroom, but not
comfortable, and there is no backup safety net underneath it.

This is a platform ceiling and belongs to `azure-clerk-migration-playbook.md`
§2a, not to this plan. Recorded here as a measured input rather than an
estimate.

---

## Finding 5 — Under *anonymous* burst load, failure is queueing, not exhaustion

> **Corrected 2026-09-09.** Two statements in the original version of this
> finding were wrong, and both flattered the result. See Finding 8, which
> re-measures the same journey with real signed-in sessions and reaches a
> materially worse conclusion. The numbers in this section are unchanged
> and still accurate *for anonymous traffic*; what was wrong was the
> description of what anonymous traffic costs.
>
> 1. **Gated routes do not answer anonymous requests with a 3xx.** This
>    section described one step of the journey as "a gated redirect" and
>    named the metric `route_members_redirect`. Verified by `curl -i`:
>    `/home`, `/events`, `/opportunities`, `/vcs` and `/members` all
>    return **HTTP 200** to a logged-out client — a complete HTML document
>    with the CSP nonce, font preloads and app shell, carrying a
>    *client-side* redirect. `requireApprovedUser()` does call
>    `redirect()`, but the root layout has already begun streaming by the
>    time the page component awaits it, so the status line is long gone
>    and Next must deliver the redirect in-band. **`/committee` is the
>    only genuine 307** in the journey — which matches the
>    `expected_redirect` counter exactly, at one per iteration.
>    The metric name `members_redirect` is kept below only so the rows
>    stay comparable with the table as first published; it never measured
>    a redirect.
> 2. **Therefore this finding measured document renders, not redirects,
>    but it still never reached the listing data.** The guard returns
>    before `loadEvents()` runs, so no anonymous row in this table
>    includes a single listing query. That is not a leak — the data is
>    correctly withheld — but it means these numbers are a *floor*, not
>    the cost of the page a member sees.
>
> The operational consequence, which is a finding in its own right: an
> unauthenticated crawler or scraper currently burns a full server render
> on **every** gated URL. The cheapest possible response to a logged-out
> hit is presently one of the more expensive ones. That is more evidence
> for B3.1, and it is the reason `/privacy` (Finding 6) is not the
> anomaly it first appeared to be.

k6, anonymous sessions (9 requests each: home, both listing boards, vcs,
committee, members, login, a legal page), ramped and **held** at
each level.

**38,277 requests. 0.00% errors. No 5xx, no resets, no dropped
iterations, at any level including 500 VUs.**

p95 by route (ms):

| route | 100 VUs | 250 VUs | 500 VUs |
| --- | --- | --- | --- |
| `/` (home) | 1,838 | 3,242 | **12,339** |
| `/privacy` (legal) | 1,718 | 3,133 | **11,952** |
| `/members` (redirect) | 1,098 | 2,242 | 6,910 |
| `/events` | 1,093 | 2,125 | 7,302 |
| `/opportunities` | 1,134 | 2,124 | 7,277 |
| `/vcs` | 1,114 | 1,996 | 6,864 |
| `/committee` | 1,086 | 2,012 | 6,593 |
| `/login` | 837 | 1,937 | 6,703 |

**The knee is between 250 and 500.** Latency is roughly linear to 250
(2.5× VUs → 1.8× p95) and superlinear past it (2× VUs → 3.8× p95). Work
is queueing behind capacity, not failing — which is the good failure mode,
and it means the lever is throughput per request, not connection limits.

**Postgres connections were never the wall.** The plan listed them as the
most likely ceiling. At 500 concurrent VUs they produced zero errors.
Worth re-testing on deployed infrastructure, where Vercel's function
concurrency changes the arithmetic, but the local evidence says connections
are not the first thing to break.

---

## Finding 6 — The bottleneck is rendering, not data. `/privacy` proves it.

The single most useful line in the whole audit:

> **`/privacy` is the second-slowest route in the application, at every
> load level, within 3% of the homepage.**

`/privacy` is a static legal page. It reads no data, runs no RPC, touches
no member. It costs 11.9 s at p95 under 500 VUs because
`export const dynamic = "force-dynamic"` sits on the **root layout**
(`frontend/src/app/layout.tsx`) and therefore applies to every route in
the app, and because `src/proxy.ts` runs `generateNonce()` + `buildCsp()`
on every non-static request. A per-request CSP nonce forces per-request
rendering; welding CSP to session refresh in one middleware makes the
entire application dynamic.

The listing boards cluster tightly together (6.6–7.3 s at 500 VUs) and
sit *below* the static page, which is the tell: their cost is not their
queries — those measured at 2–10 ms in Finding 2 — it is the same
per-request render everything else pays.

**This makes B3.1 the highest-leverage remaining change by a wide margin,
and it is now measured rather than hypothesised.** Serving a nonce-free
static CSP for public routes, dropping `force-dynamic` to the routes that
genuinely need it, and narrowing the middleware matcher would take the
entire anonymous burst — the exact traffic an announcement generates —
off the function path.

B3.3's RPC split (moving caller-dependent `contact_email` out of the list
RPCs so they become cacheable) still stands and is still correct, but the
measurement re-ranks it: **B3.1 first, B3.3 second.** Caching a 5 ms query
behind a 2-second render does not help nearly as much as not rendering.

---

## Finding 7 — The 1,000-row read cap: nothing truncates today

Re-walked every list endpoint against the corpus
([[max-rows-read-cap]]).

| RPC | paging | at 2,000 members |
| --- | --- | --- |
| `list_directory_cards` | `p_limit` / `p_offset`, capped 100 | fine |
| `list_approved_vcs_grants` | `p_limit` / `p_offset` | fine |
| `list_community_feed` | keyset cursor | fine |
| `admin_list_profiles` | `p_limit` / `p_offset` | fine |
| `list_approved_events` | none — internal `limit 1000` | 153 rows |
| `list_approved_opportunities` | none — internal `limit 1000` | 268 rows |
| `list_pending_*_admin` | none — internal `limit 1000` | fine |
| `list_directory_facets` | returns one aggregate row | n/a |
| `list_committee_cards` | none, unpaged by design | fine |
| `list_my_bookmarked_opportunities` | none | fine |

**No endpoint truncates at this population.** Three carry an explicit
`limit 1000` that would truncate *silently* if ever exceeded — 1,000
simultaneously-live upcoming events is not a 2026 problem, but the
silence is the hazard, not the number.

Also worth recording: `listing_events` has a **unique** index on
`(listing_kind, listing_id, viewer_id, event_type)`, so it is deduped by
construction and bounded by members × listings × 4. The B0 audit called it
the fastest-growing table; that is not right, and the corpus proved it —
randomly-drawn tuples collided long before the target row count.

---

## Finding 8 — Signed-in load is 3–4× anonymous, and it is where the app breaks

Added 2026-09-09. Finding 5 measured logged-out traffic only, and its
"Not measured here" note argued authenticated burst load was untestable
because signing in 500 VUs would measure the OTP limiter. **That argument
was wrong** — sessions do not have to be minted by the VUs. They can be
minted out of band and replayed.

`frontend/scripts/mint-loadtest-sessions.mjs` (new) mints 20 real
sessions for seeded corpus members using the same `@supabase/ssr`
cookie-writing path as `e2e/global-setup.ts`, and `loadtest.js` gained
`MODE=anon|auth|mixed`. 20, not 500, because
`[auth.rate_limit] sign_in_sign_ups = 30` per 5 minutes per IP makes
one-session-per-VU impossible rather than merely slow; VUs share the pool
round-robin. The harness **fails the run** if any signed-in request comes
back 3xx, so a silent regression to measuring redirect timings — which is
exactly what Finding 5 did by accident — cannot happen again.

### The isolated cost of the listing render

At 10 VUs (unsaturated, both populations against the same server in the
same run, so this is a controlled comparison rather than two runs
subtracted):

| route | anonymous p50 | signed-in p50 | delta |
| --- | --- | --- | --- |
| `/events` | 141.3 ms | 494.6 ms | **+353 ms** |
| `/opportunities` | 142.6 ms | 577.7 ms | **+435 ms** |
| `/members` | 136.5 ms | 554.4 ms | +418 ms |
| `/vcs` | 138.1 ms | 433.5 ms | +295 ms |
| `/` (static-ish) | 19.6 ms | — | — |

The anonymous column is the document render that stops just before the
guard's redirect; the signed-in column is the same page with its data and
list. **The delta is the listing work, isolated.**

### This settles B3.3, against my own earlier ranking

Finding 2 measured the list RPCs themselves at **2.2 ms** (events) and
**10.2 ms** (opportunities). Against the deltas above that is **0.6%** and
**2.3%**. B3.3 makes the *query* cacheable; the query is a rounding error
in the page it was supposed to speed up. The other ~98% is the
unavoidable `getUser()` + `is_admin` + profiles select that
`requireApprovedUser()` costs on every gated view regardless, plus
rendering 153 and 268 rows of markup.

B3.3's stated prize in the plan — "one cached render shared by everyone"
— is also unreachable on a gated page: ISR and edge caching need shared
HTML, and there is none. Only the Upstash read-through layer works behind
auth, and that layer caches the 2.2 ms.

**Recommendation: defer B3.3, do not drop it.** The entitlement reasoning
behind it is still correct and the split is still the right shape if the
listing boards are ever made public. It is simply not a performance
lever, and it should stop being ranked as one.

### Where it actually breaks

`MODE=mixed` (half the VUs signed in, half anonymous, same server, same
instant), each level run separately:

| level | requests | error rate | worst p95 |
| --- | --- | --- | --- |
| 100 VUs | 4,461 | **0.00%** | 4,189 ms (`/opportunities` signed-in) |
| 250 VUs | 4,608 | **0.00%** | 14,593 ms (`/members` signed-in) |
| 500 VUs | 4,465 | **21.21%** | 46,740 ms (`/home` signed-in) |

**The knee is between 250 and 500 VUs, and past it the failure mode is no
longer queueing.** At 500 the errors are 60-second timeouts, not slow
responses. This is the first non-zero error rate ever recorded for this
application, and Finding 5's headline "0.00% errors at every level
including 500 VUs" survived only because every gated route was being
answered by a comparatively cheap redirect document.

Throughput, same VU ramp, run separately: anonymous completed **4,841**
iterations (43,569 requests); authenticated completed **1,585** (9,512
requests). Roughly **one third the work at the same concurrency**, and
per-request p95 on `/events` is 3,568 ms anonymous against 20,008 ms
signed in.

`/home` is the worst route at every level — worse than either listing
board — which is consistent with it doing the guard's work plus its own
dashboard queries.

### Caveats that bound this finding

- **Laptop-relative**, like everything else here. Read the ratios.
- **The rate limiter and the read-through cache were both disabled** for
  this run (Upstash env blanked, so as not to touch production). In
  production `/members` serves `list_directory_facets` from a 1-hour
  cache; here it paid the uncached 91 ms every hit. Neither affects the
  anonymous-vs-authenticated delta on `/events`, which is the number this
  finding turns on.
- Turnstile is likewise inert, so no bot-check cost is included.

---

## Ranked recommendations

1. **B3.1 — decouple the CSP nonce from rendering** and let public routes
   be static/ISR. Findings 5 and 6. The largest single win available, and
   the only one that helps the exact traffic shape a burst produces.
2. **HNSW index on `cv_chunks.embedding`, before Phase 2 ships.**
   Finding 3. Currently a 140 ms full scan per search at *half* the target
   corpus, several searches per agent turn.
3. **~~Directory search~~ — done.** Finding 1, shipped in
   `20260908000001`, 27× and behaviour-verified.
4. **~~B3.3~~ — deferred, on measurement.** Finding 8: the split buys
   2.2–10.2 ms of a 353–435 ms authenticated-render delta (under 3%), and
   the "one cached render shared by everyone" it was sold on is
   structurally impossible behind an auth guard. Right idea, wrong
   ranking; revisit only if the listing boards are ever made public.
5. **Storage plan before 2,000 members are actually ingested.** Finding 4:
   ~270 MB projected against a 500 MB free tier with no backups, before
   the index in (2). Belongs to the Azure playbook §2a.
6. **`list_directory_facets` at 91 ms uncached** — note it, do not act
   yet. Finding 2.

## Not measured here

- Deployed-infrastructure latency. Everything above is laptop-relative.
  Re-run `frontend/scripts/loadtest.js` against Vercel with
  `BASE=https://…` before the numbers are quoted anywhere externally.
- ~~Authenticated burst load.~~ **Measured — see Finding 8.** The reason
  given here for skipping it (500 sign-ins would measure the OTP limiter)
  confused minting a session with using one; 20 sessions minted out of
  band and shared round-robin costs the limiter nothing.
- The pipeline load test (B2.8) and the agent's per-turn cost (C2.6),
  which needs Phase 2 to exist.
