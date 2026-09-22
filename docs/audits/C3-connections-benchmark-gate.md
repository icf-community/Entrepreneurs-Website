# C3 — Connections benchmark gate

**Run:** 2026-09-17 · **Corpus:** 5,000 members / 247,048 edges / 248,503
events, seeded locally (`supabase/snippets/seed_scale_corpus.sql` §8) ·
**Harness:** `supabase/tests/scale_query_plans.sql` §8

This is the gate the Connections implementation plan places **before any
frontend work starts**: seed 2.5× expected membership *and* 2.5× expected
density, `EXPLAIN ANALYZE` the real RPCs, and change the design if
anything misses — while there is no UI built on top of it.

It found one thing, and the design changed. That is recorded below in
full, including the part that was wrong in the original schema.

---

## What these numbers are worth

The same caveat as [C2](./C2-scalability-findings.md), and it has not
become less true: **this ran on one laptop, against a container, with no
concurrency.** The milliseconds are not Supabase's. What transfers is the
plan *shape* — seq-vs-index, `loops=N`, buffer counts, and whether cost
grows with the row count or with the page size.

Every RPC below was executed as `authenticated` through the real function,
never as `postgres` and never as a hand-inlined query, except where
explicitly noted (§"Reading past the Function Scan").

### The corpus is deliberately lopsided

A uniform corpus gives every member roughly the same degree and tells you
nothing about the member the feature will actually break for. Two
outliers are seeded on purpose:

| Member | Degree | Why |
|---|---|---|
| **hub** | 1,649 accepted | The committee member or angel everyone wants to reach. If a read path degrades, it degrades here first — and this is the account that gets opened at a careers evening. |
| **isolate** | 0 | Cold start. The path that silently returns an empty page if a join is wrong, and the one every member sees on day one. |

**Every headline number below is the HUB**, i.e. the worst case at ~4-5×
a realistic well-connected member. Typical-degree numbers are given
alongside where the difference matters.

---

## Finding 1 — Keyset pagination was not bounding the work. Found, fixed, verified.

**Severity: medium — correct results, wrong cost curve, and it would have
been invisible until someone well-connected scrolled.**

The gate's threshold for a 50-row page of `list_my_connections` is
**< 5 ms**. It measured **8.66 ms / 5,645 shared buffers** — and the
*deep* page (page ~19) cost **7.7 ms / 5,638 buffers**, statistically
identical to the first. A keyset page that costs what page 1 costs is not
a keyset page.

`EXPLAIN` on the RPC only shows `Function Scan`, so the body was measured
inline (see below). The plan:

```
Limit (rows=50)
  -> Sort (top-N heapsort)
       -> WindowAgg (actual rows=1649)            <<<< every page
            -> Hash Join (actual rows=1649)
                 -> Append (actual rows=1649)     Buffers: shared hit=104
                      -> Bitmap Index Scan on connections_requester_status_idx
                      -> Bitmap Index Scan on connections_accepted_addressee_idx
                 -> Hash (rows=4573)
                      -> Seq Scan on profiles     Buffers: shared hit=262
```

**The index design was right and the query shape was wrong.** The two
partial indexes did exactly their job — the `Append` fetched the member's
entire edge set in 104 buffers and nothing scanned `connections` whole.
But the keyset predicate was applied in the `page` CTE, *after* `matched`
and `counted` had already joined and counted every one of the member's
1,649 edges. The cursor bounded the rows **returned**, not the work
**done**.

### The fix — `20260917000005_connections_keyset_pushdown.sql`

Two branches, chosen on whether a cursor was supplied:

- **First page (no cursor)** — unchanged, deliberately. It has to count
  the whole filtered set to return `total_count`, so it is O(degree) by
  definition. Once per filter change, not once per scroll.
- **Cursor pages** — the keyset predicate, the `ORDER BY` and the `LIMIT`
  all move *inside* each `UNION ALL` branch. Each side becomes a bounded
  ordered index scan, `MergeAppend` interleaves the two sorted streams,
  and `Limit` stops after 50 rows.

This required an index change. `MergeAppend` only happens if both
branches produce rows already in the requested order, and the order is
`(decided_at desc, id desc)` — `id` is in there because a keyset cursor
on a non-unique key either skips rows or repeats them. The original
indexes were `(<side>_id, decided_at desc)` with no `id`, so they could
not satisfy that ordering and the planner had to sort. All four list
indexes gained the tie-break column.

### After

| | before | after |
|---|---|---|
| first page (hub) | 8.66 ms / 5,645 buf | **8.66 ms / 1,033 buf** |
| deep keyset page (hub) | 7.71 ms / 5,638 buf | **4.03 ms / 1,058 buf** |

Buffers on the first page fell **5.5×** even though its wall time did
not: the `Seq Scan on profiles` hash build is gone, replaced by bounded
PK lookups, and what remains is the O(degree) count the first page is
supposed to pay.

---

## Finding 2 — `admin_delete_graduates` was broken. Pre-existing, fixed.

**Severity: high — the bulk-deletion RPC fails on any non-empty cohort.**
**Unrelated to Connections. Found while building this gate.**

The gate requires confirming that a cohort delete cascades `connections`
via an index rather than a sequential scan. Calling the real RPC to
measure that produced:

```
ERROR:  column reference "user_id" is ambiguous
QUERY:  delete from public.opportunities
        where posted_by in (select user_id from _to_delete)
CONTEXT: PL/pgSQL function admin_delete_graduates(integer) line 32
DETAIL:  It could refer to either a PL/pgSQL variable or a table column.
```

The function is `returns table(user_id uuid, email text, first_name
text)`, so `user_id` is a PL/pgSQL OUT variable; five statements in its
body then say `select user_id from _to_delete`, which is ambiguous
against the temp table's own column.

**Why it has never been caught:** the function returns early when the
cohort is empty (`if v_count = 0 then return`), so it only fails when it
is actually about to delete somebody. Verified both ways:

```
admin_delete_graduates(1951)  -- empty cohort  -> 0 rows, no error
admin_delete_graduates(2021)  -- 300+ cohort   -> ERROR
```

Pre-existing in `20260529000007_admin_delete_user_rpcs.sql` and never
redefined since.

### The fix — `20260917000006_fix_admin_delete_graduates.sql`

A recreate-from-latest with the same signature (so it replaces the
function rather than adding a dead overload), with every `_to_delete`
reference aliased — `select td.user_id from _to_delete td` — which is
already how the audit insert and the final `return query` were written.

One further defect fixed in the same recreate: the temp table is
`on commit drop`, so a **second call inside one transaction** failed with
`relation "_to_delete" already exists`. That is exactly how the SQL test
harnesses call it. A `drop table if exists` makes it re-entrant.

**Tested, because the early return is what hid it.** `rls_smoke.sql` §38
seeds a two-member cohort at `grad_year 1951` (so it cannot reach the
file's own 2025–2027 fixtures), calls the RPC as an admin, and asserts:
two rows returned with non-null identities, both `auth.users` rows gone,
a member outside the cutoff untouched, a `connections` row cascaded away
with its graduate, one `admin_actions` audit row per graduate, and a
second call in the same transaction succeeding. The harness at §8k-iii
now calls the real RPC inside a savepoint before measuring the
decomposed statement sequence.

### Finding 2b — and then it deleted the admin running it

Once §8k-iii could actually call the RPC, the very first run against the
5,000-member corpus failed again, differently:

```
ERROR:  insert or update on table "admin_actions" violates foreign key
        constraint "admin_actions_admin_id_fkey"
DETAIL: Key (admin_id)=(00022327-…) is not present in table "users".
CONTEXT: PL/pgSQL function admin_delete_graduates(integer) line 47
```

The corpus's admin account is itself a seeded student with a past
graduation year, so it was **inside its own cohort**. Two distinct
defects, both dating to `20260529000007`:

1. **The caller is not excluded from the cohort.** `admin_delete_user`
   has refused this for a single target since the same migration — *"Use
   the self-service Delete Account flow to delete your own account"* — so
   the intent was already settled; the bulk variant takes a year rather
   than a target and never inherited the guard. This is not a
   corpus-only artefact: admins here **are** members (admin is granted by
   email after onboarding), so a committee member who is an admin and
   whose graduation year has passed is in their own cohort.

2. **The audit row is written after `delete from auth.users`.** With the
   caller deleted, the FK on `admin_actions.admin_id` failed and the
   exception rolled back the **entire** cleanup — hundreds of intended
   deletions lost to an opaque constraint error, with nothing in the
   audit log to say it had been attempted.

**The fix — `20260917000009_admin_delete_graduates_never_deletes_caller.sql`.**
`and p.id is distinct from v_caller` in the cohort query, and the audit
insert moved ahead of every delete — the same discipline as
`admin_reveal_connection_note` and `admin_log_cv_access`: the record that
something was attempted has to survive the thing failing. Excluding the
caller also keeps those audit rows safe from the
`delete from admin_actions where admin_id in (_to_delete)` step, which
would otherwise delete the rows just written.

Asserted in `rls_smoke.sql` §38b, and visible in the harness: against a
915-member cohort the RPC now returns **914**, the one difference being
the admin who ran it.

---

## Finding 3 — The FK cascade is indexed. The 20260827000002 failure mode does not recur.

This is the thing the index list in `20260917000001` §1 exists for, and
the reason two of its indexes are non-partial.

Postgres indexes the *referenced* side of a foreign key automatically and
**never** the referencing side, so an unindexed FK turns every delete of
a profile into a sequential scan of `connections` — once per deleted row.
`admin_delete_graduates` deletes a whole cohort in one statement.

The trap specific to this table: every other `addressee_id` index is
**partial**, and a `where status = 'accepted'` index cannot serve a
cascade, which has to find the member's rows in *every* status.

Direct confirmation on both FK columns:

```
select 1 from connections where requester_id = <hub>
  -> Bitmap Index Scan on connections_requester_status_idx
select 1 from connections where addressee_id = <hub>
  -> Bitmap Index Scan on connections_addressee_status_idx
```

Both index scans, against 247k rows. The cohort delete (run as the
statement sequence the broken RPC intends — see Finding 2) completes with
the RI checks visible as cheap `Trigger for constraint` lines rather than
as repeated sequential scans.

---

## The gate, item by item

| Query | Threshold | Hub (deg 1,649) | Verdict |
|---|---|---|---|
| `list_my_connections`, 50-row first page | < 5 ms | 8.66 ms / 1,033 buf | **over, accepted** — see note |
| `list_my_connections`, 50-row cursor page | < 5 ms | 4.03 ms / 1,058 buf | pass |
| `my_pending_connection_count` (badge) | < 2 ms | **0.43 ms** / 49 buf | pass |
| `send_connection_request` (all gates) | < 10 ms | **3.14 ms** / 169 buf | pass |
| 2-hop mutual-connection count | < 50 ms | 185 ms / temp spill | **over, not shipped** — see note |

Not in the original threshold list, measured anyway:

| Query | Hub | Typical (deg ~100) |
|---|---|---|
| `connection_state_with` | 0.58 ms | — |
| `list_my_connection_facets` | 80 ms | **17 ms** |
| `list_my_connection_graph` (≤500 nodes) | 22.5 ms | — |
| `claim_connection_digests` (200-row batch) | 29.8 ms | — |
| `list_my_connections` on the **isolate** | — | 0.98 ms |

### The two misses, and why neither blocks the UI

**First page at 8.66 ms.** The threshold was written against a page, and
what is actually being measured is a page *plus a full count of a
1,649-edge set* — 4-5× a realistic well-connected member, on a laptop. The
count is what `total_count` is for and it is O(degree) by construction;
the fix above removed everything that was *not*. Subsequent pages, which
are what scrolling actually costs, are inside the gate. Accepted with the
curve understood rather than papered over.

**2-hop at 185 ms.** This query is **not shipped and deliberately out of
scope** — "N mutual connections" is excluded from v1 because at this
community's size a count of 1 is an identification. It is measured
because it is the query that would decide whether a graph database was
ever needed, and the plan's argument for staying in Postgres rests on it
being tens of milliseconds rather than seconds. At the hub it is
~1,649 × ~100 ≈ 165k candidate paths and spills to temp; at a realistic
300 degree it is ~30k paths and well inside the threshold. The
conclusion the plan drew — **adjacency list via B-tree, not a graph
database** — stands, and Apache AGE on the Azure migration target remains
the escape hatch if mutual-connection traversal is ever shipped.

**`list_my_connection_facets` at 80 ms / 17 ms.** Linear in degree, as
expected, and 17 ms at realistic degree is in line with
`list_directory_facets`. Worth knowing that it is the heaviest thing on a
`/connections` page load: if it ever matters, the filter panel can fetch
it lazily on open rather than on render.

### Re-measured against the finished RPCs (2026-09-18)

The numbers above were taken while the RPCs were being written. Audit 13
re-ran the whole harness against a freshly seeded corpus — 246,930
connections, 248,414 events, hub degree **1,654**, isolate at 0 — with
the shipped functions, and every gate item holds:

| Query | Threshold | Measured | Verdict |
|---|---|---|---|
| `list_my_connections`, first page (hub) | < 5 ms | **4.55 ms** | pass |
| `list_my_connections`, deep cursor page | < 5 ms | **2.32 ms** | pass |
| `my_pending_connection_count` | < 2 ms | **0.28 ms** | pass |
| `send_connection_request` | < 10 ms | **2.13 ms** | pass |
| `connection_state_with` | — | 0.34 ms | — |
| `list_my_connection_facets` (hub) | — | 47.2 ms | — |
| `list_my_connection_graph` | — | 13.3 ms | — |
| `claim_connection_digests` (200) | — | 30.2 ms | — |
| the isolate (cold start) | — | 0.70 ms | — |
| 2-hop mutual count (hub) | < 50 ms | 122.9 ms | over, not shipped |

The first-page miss recorded above is **gone** — 8.66 ms → 4.55 ms — on
the same query at the same scale, which is the keyset pushdown of
Finding 1 measured on the finished function rather than on an inlined
body. The 2-hop figure improved (185 → 123 ms) and is still over, which
changes nothing: it is not shipped, and the conclusion it exists to
support is unaffected.

The FK cascade, on a 915-member cohort delete:

```
Trigger for constraint connections_requester_id_fkey on profiles: time=66.663 calls=915
Trigger for constraint connections_addressee_id_fkey on profiles: time=46.853 calls=915
```

Both present, both ~0.06 ms per row against a 247k-row table — index
scans, not the per-row sequential scan of `20260827000002`. This is the
one plan-shape verdict in the gate that matters more than any timing.

---

## Reading past the `Function Scan`

`EXPLAIN` on a `SECURITY DEFINER` function shows one `Function Scan` node
and nothing inside it, so the interesting plans in Finding 1 were
obtained by running the function *body* inline against the same corpus,
with `auth.uid()` replaced by a literal. That is a faithful reproduction
of the statement the function executes, but it is not the function, and
the two can diverge in one specific way: a plpgsql function plans with
**parameters**, not literals, so a literal can plan differently from the
bound value ([[cte-materialized-and-parameterised-plans]]). Where the
verdict rested on the inline plan, the RPC's own buffer counts were used
as the cross-check — that is why buffers, not milliseconds, carry the
before/after comparison in Finding 1.

---

## Corpus changes this gate required

Three, all in `seed_scale_corpus.sql`, all of which were latent problems
rather than new needs:

1. **`n_members` 2,000 → 5,000.** The gate's stated population. The
   earlier C2 numbers are a recorded historical result and are not
   regenerated from this file, so nothing is invalidated — but a
   5,000-member timing must not be compared against them.
2. **`profile_version` was never set**, leaving all 5,000 members at the
   default 1. `send_connection_request` requires `>= 2` (an empty profile
   card gives the recipient nothing to decide on), so the send path could
   not be measured at all. Now set to 2 for the same 5-in-6 that has an
   `intake_completed_at`, which is the population `20260828000003`
   describes.
3. **No admin existed** on a fresh `supabase db reset`, so
   `scale_query_plans.sql` §5 (`admin_list_profiles`) failed its `\gset`
   — and because the whole harness runs in one transaction, that first
   error aborted every section after it, including this one. The corpus
   now promotes one member to admin *only if `public.admins` is empty*,
   so a stack with a real admin is untouched.
