-- ════════════════════════════════════════════════════════════════════
-- Foundry · The nightly purge stops reading the whole edge table
--
-- Found by re-running the C3 benchmark harness against the FINISHED
-- RPCs rather than the ones that existed when the gate first ran.
-- `purge_removed_connections()` was broadened by 20260917000011 — from
-- "removed rows" to "every settled row" — and that migration shipped
-- after the gate, so its predicate had never been measured at scale.
--
-- At 5,000 members / 248,376 edges it plans as:
--
--   Limit (rows=500)
--     -> Gather Merge
--          -> Sort  (top-N heapsort)
--               -> Parallel Seq Scan on connections  (rows=8506, x3)
--                    Rows Removed by Filter: 74286
--                    Buffers: shared hit=3987
--   Execution Time: 28.9 ms  (49.6 ms through the function wrapper)
--
-- It reads EVERY row in the table, sorts what survives, and throws all
-- but 500 away — every night, whether there are 3 doomed rows or 3,000.
-- 50 ms of nightly cron is not a problem today. The shape is: the cost
-- is O(total connections) forever, and the plan's stated standard for
-- this feature is that nothing degrades with total membership.
--
-- ─── WHY THE FUNCTION BODY MOVES TOO ────────────────────────────────
-- An index alone would not have been used. The old predicate was
--
--   (status in ('removed','declined','withdrawn') and cooldown ...)
--   or (status = 'expired')
--
-- and Postgres's predicate-implication prover will not reliably derive
-- "this is only ever rows with a settled status" from an OR whose
-- branches each constrain `status` separately. So the same condition is
-- restated with the status test lifted OUT of the OR, as a single
-- top-level conjunct that matches the index predicate exactly:
--
--   status in ('removed','declined','withdrawn','expired')
--   and (status = 'expired'
--        or (cooldown_until is not null and cooldown_until <= now()))
--
-- Logically identical, case by case:
--   * 'expired'                   → both forms true (no cooldown is
--                                   ever set on an expiry, so the
--                                   cooldown test is irrelevant to it)
--   * removed/declined/withdrawn  → both reduce to the cooldown test
--   * accepted/pending/blocked    → both false
--
-- Nothing about WHICH rows are deleted changes. The reasoning for each
-- status is unchanged and lives in 20260917000011's header.
--
-- ─── THE INDEX ──────────────────────────────────────────────────────
-- Partial, and keyed on the ORDER BY expression so the scan can stop
-- early instead of sorting. `coalesce` is immutable, so the expression
-- is indexable.
--
-- It covers 27,232 of 248,376 rows in the corpus — the settled minority
-- — and the write cost is close to nothing: a row is inserted as
-- 'pending' (not in the index) and enters it at most once, when it
-- settles. The far more common transitions, pending → accepted and the
-- accepted row's own life, never touch it.
--
-- ─── WHAT IT MEASURES AFTER, AND WHAT IS LEFT ───────────────────────
-- Same corpus, same query:
--
--   Limit (rows=500)
--     -> Sort (top-N heapsort)
--          -> Bitmap Heap Scan on connections   (rows=25517)
--               -> Bitmap Index Scan on connections_settled_purge_idx
--   Execution Time: 15.5 ms  (18.8 ms through the function, from 49.6)
--
-- The sequential scan is gone and the cost is now proportional to the
-- SETTLED minority, not to the table. That was the finding.
--
-- It is not the best possible plan and that is a deliberate stop.
-- Forcing an ordered scan (`enable_bitmapscan = off`) gives 3.6 ms /
-- 1,006 buffers, because reading the index in sort order finds 500
-- qualifying rows almost immediately and stops. The planner does not
-- choose it: it estimates 747 rows will survive the residual
-- `status = 'expired' OR cooldown_until <= now()` filter when 25,517
-- actually do, so it thinks the sort is nearly free.
--
-- Closing that would mean two partial indexes and a two-branch
-- UNION ALL / MergeAppend so each branch's condition becomes an index
-- condition with no residual filter. That is real complexity, on a
-- nightly cron, to save 12 ms — and the 27,232 settled rows in this
-- corpus are themselves an artefact of a seed that was never purged.
-- In steady state this job runs daily, so the only settled rows in the
-- table are those still inside their three-week cooldown. Recorded
-- rather than done, so the next person measuring this knows it was
-- looked at and priced.
--
-- `CONCURRENTLY` is deliberately NOT used, unlike 20260827000002. That
-- migration was adding indexes to a live, populated table; this one runs
-- inside the normal migration transaction, and `create index` on
-- Supabase's managed Postgres during a `db push` on a table this size is
-- a lock measured in hundreds of milliseconds. CONCURRENTLY cannot run
-- in a transaction block at all, which is why it is not free to add
-- "just in case".
-- ════════════════════════════════════════════════════════════════════

create index if not exists connections_settled_purge_idx
  on public.connections (coalesce(cooldown_until, decided_at))
  where status in ('removed', 'declined', 'withdrawn', 'expired');

create or replace function public.purge_removed_connections()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with doomed as (
    select id from public.connections
     -- Matches connections_settled_purge_idx's predicate verbatim, so
     -- the planner can prove the partial index is applicable. Do not
     -- fold this back into the OR below.
     where status in ('removed', 'declined', 'withdrawn', 'expired')
       and (
             -- Settled by the clock. Expiry deliberately carries no
             -- cooldown — nobody decided anything — so the pair is
             -- already re-sendable and the row has nothing left to
             -- enforce.
             status = 'expired'
             -- Settled by somebody, and the cooldown that row was
             -- keeping has run out. Deleting one EARLIER would destroy
             -- the cooldown itself, since the cooldown is enforced by
             -- reading this row.
             or (cooldown_until is not null and cooldown_until <= now())
           )
     order by coalesce(cooldown_until, decided_at)
     limit 500
  ),
  gone as (
    delete from public.connections c using doomed d where c.id = d.id returning 1
  )
  select count(*) into v_count from gone;

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public.purge_removed_connections() from public, anon, authenticated;
