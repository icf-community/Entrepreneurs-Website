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

## Finding 5 — Under burst load, failure is queueing, not exhaustion

k6, anonymous sessions (9 requests each: home, both listing boards, vcs,
committee, a gated redirect, login, a legal page), ramped and **held** at
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

## Ranked recommendations

1. **B3.1 — decouple the CSP nonce from rendering** and let public routes
   be static/ISR. Findings 5 and 6. The largest single win available, and
   the only one that helps the exact traffic shape a burst produces.
2. **HNSW index on `cv_chunks.embedding`, before Phase 2 ships.**
   Finding 3. Currently a 140 ms full scan per search at *half* the target
   corpus, several searches per agent turn.
3. **~~Directory search~~ — done.** Finding 1, shipped in
   `20260908000001`, 27× and behaviour-verified.
4. **B3.3 — split `contact_email` out of the list RPCs** so `/events` and
   `/opportunities` become cacheable. Still correct, now ranked below
   B3.1.
5. **Storage plan before 2,000 members are actually ingested.** Finding 4:
   ~270 MB projected against a 500 MB free tier with no backups, before
   the index in (2). Belongs to the Azure playbook §2a.
6. **`list_directory_facets` at 91 ms uncached** — note it, do not act
   yet. Finding 2.

## Not measured here

- Deployed-infrastructure latency. Everything above is laptop-relative.
  Re-run `frontend/scripts/loadtest.js` against Vercel with
  `BASE=https://…` before the numbers are quoted anywhere externally.
- Authenticated burst load. Deliberate: signing in 500 VUs would measure
  the OTP rate limiter's refusal rate, not throughput. The authenticated
  read paths are covered by Finding 2 instead, where RLS cost is visible
  directly rather than through five layers of HTTP.
- The pipeline load test (B2.8) and the agent's per-turn cost (C2.6),
  which needs Phase 2 to exist.
