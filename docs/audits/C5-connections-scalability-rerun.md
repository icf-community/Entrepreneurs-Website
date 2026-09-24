# C5 — Connections scalability, re-run against the finished code

**Run:** 2026-09-20 · **Corpus:** 5,000 members / 248,376 edges / 248,379
events, re-seeded from `supabase/snippets/seed_scale_corpus.sql` ·
**Harness:** `supabase/tests/scale_query_plans.sql` §8

This is audit 13 of the Connections plan, and it exists because
[C3](./C3-connections-benchmark-gate.md) — the benchmark *gate* — ran on
2026-09-17, before the last eight migrations existed. A gate that ran
against half the code is not evidence about the code that ships.

The same caveat as C3 and C2 applies and has not become less true: **this
ran on one laptop, against a container, with no concurrency.** The
milliseconds are not Supabase's. What transfers is plan shape.

**Result: one finding, in the one place that was never measured.**
Everything C3 covered still holds; the two write paths and the retention
jobs added after C3 are measured here for the first time, and one of them
was reading the whole edge table every night.

---

## What changed since C3, and therefore what is new here

| Migration | What it did | Measured before? |
|---|---|---|
| 007–010 | Blocked-members list, idempotent re-report, cohort-delete guard, graph filters | Read paths, covered by C3's §8a–8f shapes |
| **011** | `purge_removed_connections` broadened from "removed" to **every settled row** | **No** — shipped after the gate |
| **012** | `block_member` gained an advisory lock and a daily cap | **No** |
| **013** | `purge_sent_outbound_email` — a new nightly job | **No** |

So §8l (block) and §8m (the three retention crons) were added to the
harness for this run. They are permanent sections, not a one-off script.

---

## Finding 1 — the nightly purge was a full table scan. Found, fixed, verified.

**Severity: low today, structural. It is the cost curve that is wrong, not
the answer.**

`purge_removed_connections()` at 248,376 edges:

```
Limit (rows=500)
  -> Gather Merge
       -> Sort  (top-N heapsort)
            -> Parallel Seq Scan on connections  (actual rows=8506, loops=3)
                 Rows Removed by Filter: 74286
                 Buffers: shared hit=3987
Execution Time: 28.9 ms   (49.6 ms through the SECURITY DEFINER wrapper)
```

It read every row in the table, sorted the survivors, and discarded all
but 500 — every night, whether three rows were doomed or three thousand.

Fifty milliseconds of nightly cron is not a problem. The shape is: the
cost is **O(total connections), forever**, and this feature's stated
standard is that nothing degrades with total membership. Every other read
path here is indexed precisely so that a member with 300 connections costs
the same at 2,000 members as at 200,000; the job that cleans up after them
was the one place that wasn't.

**Why it had no index.** 011's predicate was an `OR` whose two branches
each constrained `status` separately, and Postgres will not reliably prove
from that shape that only settled rows can match — so a partial index on
settled rows would have been ignored even if one had existed.

**The fix** (`20260917000014`) is both halves: a partial index keyed on the
sort expression, and the same condition restated with the status test
lifted out of the `OR` as a single top-level conjunct that matches the
index predicate exactly. Which rows get deleted does not change; the
case-by-case equivalence is written out in the migration header.

After:

```
Limit (rows=500)
  -> Sort (top-N heapsort)
       -> Bitmap Heap Scan on connections   (actual rows=25517)
            -> Bitmap Index Scan on connections_settled_purge_idx
Execution Time: 15.5 ms   (18.8 ms through the wrapper, from 49.6)
```

The sequential scan is gone and the cost is now proportional to the
settled minority — 27,232 rows of 248,376 — rather than to the table.

**What is deliberately left.** Forcing an ordered scan gives 3.6 ms /
1,006 buffers, four times cheaper again, because reading the index in sort
order finds 500 qualifying rows almost immediately. The planner does not
choose it: it estimates 747 rows will survive the residual
`status = 'expired' OR cooldown_until <= now()` filter when 25,517 do.
Closing that needs two partial indexes and a two-branch
`UNION ALL`/MergeAppend so neither branch has a residual filter — real
complexity on a nightly job to save 12 ms, on a corpus whose 27,232
settled rows only exist because it was seeded cold and never purged. In
steady state this runs daily, so the only settled rows present are those
still inside their three-week cooldown. Priced, recorded, not done.

`verify_prod_schema.sql` §7c-ii now asserts the index exists. It is not a
correctness index, so its absence would fail nothing visible — which is
exactly why it needed an assertion rather than a comment.

---

## The new write path: block

`block_member` takes an arbitrary member id and creates a row from
nothing, which is the same write-amplifier shape as send, so 012 gave it
its own database cap. Both new costs were measured:

| | Result |
|---|---|
| `block_member` end to end (as the hub) | **1.40 ms** / 66 buffers |
| the cap count, inlined | **Index Only Scan** on `connection_events_actor_idx`, 0.157 ms, heap fetches 1 |

The cap does not walk the event history — which was the specific risk,
and the same one §8g exists to watch on the send path.

`pg_advisory_xact_lock` does not appear anywhere near the top of the plan's
time. It hashes the caller's own id, so two different members never
contend; it serialises a member against themselves and nothing else.

## The other two retention jobs

| | Result |
|---|---|
| `purge_connection_records()` | 0.79 ms |
| `purge_sent_outbound_email()` | 0.57 ms |

The second is a sequential scan and that is the correct answer, recorded
so it is not later mistaken for a regression: the outbound queue is
drained every five minutes and purged daily, so it holds days of traffic
against a 100/day sending tier. An index for this predicate would cost
more on every enqueue than it saves once a night. What would matter is the
scanned row count growing into the tens of thousands — that would mean the
drain has stopped, not that this query is wrong.

---

## Everything C3 covered, re-confirmed

Same harness, re-run in full. No shape changed.

| Query | C3 | This run | Threshold |
|---|---|---|---|
| `list_my_connections`, first page (hub, 1.6k degree) | 4.55 ms | 7.81 ms / **863 buf** | < 5 ms |
| `list_my_connections`, deep keyset page | — | 3.84 ms / 920 buf | — |
| `my_pending_connection_count` (badge) | 0.43 ms | **0.53 ms** | < 2 ms ✓ |
| `connection_state_with` | — | 0.63 ms | — |
| `list_my_connection_facets` (hub) | 47.2 ms | 87.5 ms / 716 buf | none stated |
| `list_my_connection_graph` (500 nodes) | 13.3 ms | 23.6 ms | — |
| `send_connection_request`, all gates | — | **3.18 ms** | < 10 ms ✓ |
| cold start (the isolate) | — | 1.19 ms | — |
| `claim_connection_digests(200)` | — | 22.4 ms | — |
| 2-hop mutual count (**not shipped**) | — | 203.7 ms | < 50 ms |

**On the first page at 7.81 ms against a 5 ms threshold.** C3 recorded
4.55 ms for the same query after its Finding 1 fix, and this looks like a
regression until you read the buffers: 863 here against C3's 1,033. Fewer
pages touched, same plan, more wall time — that is laptop noise and a
differently-shaped random seed (the hub's degree is not fixed between
seeds), not work being added. C3's own analysis of why this query sits
just over the line — the threshold was written for a page, and the count
is O(degree) — stands unchanged and is not re-argued here.

**On facets at 87.5 ms.** 716 buffers, so it is CPU in the aggregation, not
I/O. C3 already identified this as the heaviest thing on a connections
page and linear in degree. It has not got worse in shape; it moved with
the same noise as everything else in this run.

**On the 2-hop count at 203.7 ms against a 50 ms threshold.** It is the one
number over its threshold by a real margin, and it measures a query that
**is not shipped and is out of scope** — "N mutual connections" is excluded
from v1 because at this community's size a count of 1 is an
identification. It is kept in the harness because it is the query that
would decide whether a graph database was ever needed. The argument for
staying in Postgres rested on this being tens of milliseconds rather than
seconds; at 204 ms across two 194k-row sequential scans it is still
comfortably on the Postgres side of that line, and it would be indexed
before it shipped rather than measured as-is.

## The FK cascade — `20260827000002` all over again, still not

The failure that migration was written to fix: an unindexed referencing
side turns a cohort delete into one sequential scan per deleted row.

| | Result |
|---|---|
| single-member delete | `connections_requester_id_fkey` 0.042 ms, `connections_addressee_id_fkey` 0.046 ms |
| **cohort delete, 915 graduates in one statement** | 84.2 ms and 80.1 ms **total** — ~0.09 ms per graduate |

Both are index scans. The non-partial `(requester_id, status)` and
`(addressee_id, status)` indexes are doing exactly the job they were put
there for.

---

## Load-test harness

`frontend/scripts/loadtest.js` now carries the three `/connections` reads
as separate series — the card list, the inbox, and the ego-graph payload —
so the C2 harness exercises them under concurrency rather than only in
`EXPLAIN`. The sidebar badge needed nothing: it renders on every
authenticated page, so it was already under load on all six existing hits.

`send_connection_request` is deliberately **not** in the harness, and the
reason is written into the file next to the omission: it is capped at 10
per member per day by design, so the eleventh call from a VU measures the
refusal path rather than the send path, and every call that succeeds
writes a permanent row. Its cost is measured in §8g instead, against the
real RPC with every gate, at this corpus size.
