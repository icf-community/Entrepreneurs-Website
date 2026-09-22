-- ════════════════════════════════════════════════════════════════════
-- Foundry · Connections — keyset pushdown for list_my_connections
--
-- This migration exists because the benchmark gate caught something, and
-- it is worth writing down exactly what, because the original was not
-- obviously wrong.
--
-- ─── WHAT THE BENCHMARK FOUND ───────────────────────────────────────
-- Measured against the scale corpus (5,000 members, 247k edges, a
-- deliberately seeded 1,649-connection "hub" member), a 50-row page of
-- list_my_connections came back at ~8.7 ms / 5,645 shared buffers —
-- over the < 5 ms gate — and, worse, the DEEP page cost the same as the
-- first one. The inner plan said why:
--
--     Limit (rows=50)
--       -> Sort (top-N heapsort)
--            -> WindowAgg (rows=1649)          <<<< every page
--                 -> Hash Join (rows=1649)
--                      -> Append (rows=1649)   <<<< both index scans
--                      -> Hash -> Seq Scan on profiles (rows=4573)
--
-- The two partial indexes were doing their job: the Append fetched the
-- member's edges in 104 buffers and nothing scanned `connections`
-- whole. But the keyset predicate was applied in the `page` CTE, AFTER
-- `matched` and `counted` had already joined and counted the member's
-- ENTIRE edge set. Keyset pagination that filters after the aggregate
-- is just OFFSET with extra steps: it bounds the rows RETURNED, not the
-- work DONE. Page 40 cost what page 1 cost.
--
-- ─── THE FIX ────────────────────────────────────────────────────────
-- Two branches, chosen on whether a cursor was supplied.
--
--   FIRST PAGE (no cursor): unchanged, and deliberately so. It has to
--   count the whole filtered set to return total_count, so it is
--   O(degree) by definition and there is nothing to push down. Once per
--   filter change, not once per scroll.
--
--   CURSOR PAGES: the keyset predicate, the ORDER BY and the LIMIT all
--   move INSIDE the two UNION ALL branches, so each branch is a bounded
--   ordered index scan, Postgres merges them with MergeAppend, and the
--   Limit stops the whole thing after 50 rows. O(page), not O(degree).
--   total_count is 0 here, which it already was.
--
-- ─── WHY THE INDEXES HAVE TO CHANGE ─────────────────────────────────
-- MergeAppend only happens if BOTH branches can produce rows already in
-- the requested order. The order is (decided_at desc, id desc) — id is
-- in there to break ties, because a keyset cursor on a non-unique key
-- either skips rows or repeats them. The old indexes were
-- `(<side>_id, decided_at desc)` with no id, so they could not satisfy
-- that ordering and the planner had to sort. Adding id makes each
-- branch an ordered scan and the sort disappears.
--
-- ─── THE DUPLICATION, AND THE TEST THAT GUARDS IT ───────────────────
-- The filter predicates now appear TWICE in this function, once per
-- branch. That is a real maintenance hazard and it is not hidden behind
-- a helper, because a helper would have to take all eight filter
-- arguments and would be re-evaluated per candidate row — undoing the
-- CTE hoist that 20260908000001 added to the directory for exactly this
-- reason.
--
-- So the duplication is accepted and guarded by assertion instead:
-- rls_smoke walks every page of a filtered list and asserts the set it
-- collects is identical to the set a single oversized page returns. If
-- the two branches ever drift, that fails.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. Indexes: add id to the ordering ─────────────────────────────
-- Dropped and recreated rather than created alongside: leaving the old
-- two-column versions would keep a redundant index on the write path of
-- every accept for no read benefit, since the new ones have the old
-- columns as a prefix and serve every query the old ones did.
drop index if exists public.connections_accepted_requester_idx;
drop index if exists public.connections_accepted_addressee_idx;

create index if not exists connections_accepted_requester_idx
  on public.connections (requester_id, decided_at desc, id desc)
  where status = 'accepted';

create index if not exists connections_accepted_addressee_idx
  on public.connections (addressee_id, decided_at desc, id desc)
  where status = 'accepted';

-- The inbox and sent lists page on created_at and need the same tie
-- break for the same reason.
drop index if exists public.connections_inbox_idx;
drop index if exists public.connections_sent_idx;

create index if not exists connections_inbox_idx
  on public.connections (addressee_id, created_at desc, id desc)
  where status = 'pending';

create index if not exists connections_sent_idx
  on public.connections (requester_id, created_at desc, id desc)
  where status = 'pending';


-- ─── 2. list_my_connections ─────────────────────────────────────────
-- Recreated from the 20260917000003 definition with the same signature,
-- per the house rule: copy the LATEST version and match the argument
-- list exactly, or `create or replace` silently makes a second function
-- and supabase-js can no longer resolve the call.
create or replace function public.list_my_connections(
  p_query             text        default null,
  p_roles             text[]      default null,
  p_courses           text[]      default null,
  p_sectors           text[]      default null,
  p_skills            text[]      default null,
  p_grad_min          int         default null,
  p_grad_max          int         default null,
  p_limit             int         default 48,
  p_cursor_decided_at timestamptz default null,
  p_cursor_id         uuid        default null
)
returns table (
  connection_id uuid,
  connected_at  timestamptz,
  id            uuid,
  first_name    text,
  surname       text,
  role          public.user_role,
  course        text,
  grad_year     smallint,
  avatar_path   text,
  bio_focus     text,
  bio_hobbies   text,
  email         text,
  skill_names   text[],
  sector_names  text[],
  total_count   bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
-- RETURNS TABLE declares fifteen OUT parameters, and in plpgsql (unlike
-- the `language sql` version this replaces) every one of them is a
-- variable that shadows any same-named column. `id`, `role`, `course`,
-- `email` and `first_name` are all both. Columns win here, which is
-- what every reference in this body means; the p_/v_ prefixes on the
-- actual variables mean nothing real is shadowed in the other
-- direction.
--
-- The CTE columns below are also explicitly renamed rather than left to
-- this pragma, because "select id from q_skill_ids" failing with
-- `column reference "id" is ambiguous` is exactly how this was found.
#variable_conflict use_column
declare
  v_caller uuid := auth.uid();
  v_limit  int  := greatest(1, least(coalesce(p_limit, 48), 100));
begin
  if v_caller is null or not (public.is_approved() or public.is_admin()) then
    return;
  end if;

  -- ── Branch A: the first page ────────────────────────────────────
  if p_cursor_id is null or p_cursor_decided_at is null then
    return query
    with q_skill_ids as materialized (
      select s.id as k_skill_id from public.skills s
       where p_query is not null and p_query <> '' and s.name ilike '%' || p_query || '%'
    ),
    q_sector_ids as materialized (
      select sc.id as k_sector_id from public.sectors sc
       where p_query is not null and p_query <> '' and sc.name ilike '%' || p_query || '%'
    ),
    edges as (
      select c.id as k_conn_id, c.addressee_id as k_other_id, c.decided_at as k_sort_at
        from public.connections c
       where c.requester_id = v_caller and c.status = 'accepted'
      union all
      select c.id, c.requester_id, c.decided_at
        from public.connections c
       where c.addressee_id = v_caller and c.status = 'accepted'
    ),
    matched as (
      select e.k_conn_id, e.k_sort_at, op.*
        from edges e
        join public.profiles op on op.id = e.k_other_id
       where op.status = 'approved'
         and (p_roles    is null or op.role::text = any(p_roles))
         and (p_courses  is null or op.course     = any(p_courses))
         and (p_grad_min is null or (op.grad_year is not null and op.grad_year >= p_grad_min))
         and (p_grad_max is null or (op.grad_year is not null and op.grad_year <= p_grad_max))
         and (
           p_query is null or p_query = '' or
           (op.first_name || ' ' || op.surname) ilike '%' || p_query || '%' or
           op.course      ilike '%' || p_query || '%' or
           op.bio_focus   ilike '%' || p_query || '%' or
           op.bio_hobbies ilike '%' || p_query || '%' or
           op.working_on  ilike '%' || p_query || '%' or
           exists (select 1 from public.profile_skills ps
                    where ps.profile_id = op.id and ps.skill_id in (select k_skill_id from q_skill_ids)) or
           exists (select 1 from public.profile_sectors psc
                    where psc.profile_id = op.id and psc.sector_id in (select k_sector_id from q_sector_ids))
         )
         and (p_sectors is null or exists (
           select 1 from public.profile_sectors psc
             join public.sectors sc on sc.id = psc.sector_id
            where psc.profile_id = op.id and sc.name = any(p_sectors)))
         and (p_skills is null or exists (
           select 1 from public.profile_skills ps
             join public.skills s on s.id = ps.skill_id
            where ps.profile_id = op.id and s.name = any(p_skills)))
    ),
    counted as (
      select m.*, count(*) over () as k_total from matched m
    ),
    page as (
      select * from counted cn
       order by cn.k_sort_at desc, cn.k_conn_id desc
       limit v_limit
    )
    select
      pg.k_conn_id, pg.k_sort_at,
      -- profiles.grad_year is `integer`; this function declares
      -- `smallint` because list_directory_cards does and the generated
      -- TS types are built from it. `language sql` coerced that
      -- silently — plpgsql's `return query` does not, so the cast is
      -- explicit rather than changing a signature the frontend reads.
      pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year::smallint,
      pg.avatar_path,
      left(coalesce(pg.bio_focus, pg.working_on), 160),
      left(pg.bio_hobbies, 160),
      u.email::text,
      coalesce((select array_agg(s.name order by s.name)
                  from public.profile_skills ps join public.skills s on s.id = ps.skill_id
                 where ps.profile_id = pg.id), ARRAY[]::text[]),
      coalesce((select array_agg(sc.name order by sc.name)
                  from public.profile_sectors psc join public.sectors sc on sc.id = psc.sector_id
                 where psc.profile_id = pg.id), ARRAY[]::text[]),
      pg.k_total
    from page pg
    join auth.users u on u.id = pg.id
    -- NOT redundant with the ORDER BY inside `page`. A CTE's ordering is
    -- not preserved through a join — the planner is free to hash this
    -- one and emit rows in whatever order falls out, and it does. The
    -- CLIENT DERIVES ITS CURSOR FROM THE LAST ROW OF THE PAGE, so an
    -- unordered result silently hands back a cursor from the middle of
    -- the page and the next page overlaps it. Caught by the keyset walk
    -- assertion, which is the only thing that would have caught it.
    order by pg.k_sort_at desc, pg.k_conn_id desc;
    return;
  end if;

  -- ── Branch B: a cursor page ─────────────────────────────────────
  -- The keyset predicate, the ordering and the limit are all INSIDE
  -- each UNION ALL branch now. Each side becomes a bounded ordered scan
  -- of connections_accepted_<side>_idx, MergeAppend interleaves the two
  -- already-sorted streams, and Limit stops after v_limit rows. Nothing
  -- reads the member's whole edge set.
  --
  -- The approval re-check is an EXISTS rather than a join, so it filters
  -- inside the ordered scan without forcing a join order that would
  -- destroy the sort. A banned member's edge must not silently occupy a
  -- slot in the page.
  return query
  with edges as (
    (
      select c.id as k_conn_id, c.addressee_id as k_other_id, c.decided_at as k_sort_at
        from public.connections c
       where c.requester_id = v_caller
         and c.status = 'accepted'
         and (c.decided_at, c.id) < (p_cursor_decided_at, p_cursor_id)
         and exists (select 1 from public.profiles op
                      where op.id = c.addressee_id and op.status = 'approved')
       order by c.decided_at desc, c.id desc
       limit v_limit
    )
    union all
    (
      select c.id, c.requester_id, c.decided_at
        from public.connections c
       where c.addressee_id = v_caller
         and c.status = 'accepted'
         and (c.decided_at, c.id) < (p_cursor_decided_at, p_cursor_id)
         and exists (select 1 from public.profiles op
                      where op.id = c.requester_id and op.status = 'approved')
       order by c.decided_at desc, c.id desc
       limit v_limit
    )
  ),
  page as (
    select e.k_conn_id, e.k_other_id, e.k_sort_at, op.*
      from edges e
      join public.profiles op on op.id = e.k_other_id
     where (p_roles    is null or op.role::text = any(p_roles))
       and (p_courses  is null or op.course     = any(p_courses))
       and (p_grad_min is null or (op.grad_year is not null and op.grad_year >= p_grad_min))
       and (p_grad_max is null or (op.grad_year is not null and op.grad_year <= p_grad_max))
       and (
         p_query is null or p_query = '' or
         (op.first_name || ' ' || op.surname) ilike '%' || p_query || '%' or
         op.course      ilike '%' || p_query || '%' or
         op.bio_focus   ilike '%' || p_query || '%' or
         op.bio_hobbies ilike '%' || p_query || '%' or
         op.working_on  ilike '%' || p_query || '%' or
         exists (select 1 from public.profile_skills ps
                   join public.skills s on s.id = ps.skill_id
                  where ps.profile_id = op.id and s.name ilike '%' || p_query || '%') or
         exists (select 1 from public.profile_sectors psc
                   join public.sectors sc on sc.id = psc.sector_id
                  where psc.profile_id = op.id and sc.name ilike '%' || p_query || '%')
       )
       and (p_sectors is null or exists (
         select 1 from public.profile_sectors psc
           join public.sectors sc on sc.id = psc.sector_id
          where psc.profile_id = op.id and sc.name = any(p_sectors)))
       and (p_skills is null or exists (
         select 1 from public.profile_skills ps
           join public.skills s on s.id = ps.skill_id
          where ps.profile_id = op.id and s.name = any(p_skills)))
     order by e.k_sort_at desc, e.k_conn_id desc
     limit v_limit
  )
  select
    pg.k_conn_id, pg.k_sort_at,
    pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year::smallint,
    pg.avatar_path,
    left(coalesce(pg.bio_focus, pg.working_on), 160),
    left(pg.bio_hobbies, 160),
    u.email::text,
    coalesce((select array_agg(s.name order by s.name)
                from public.profile_skills ps join public.skills s on s.id = ps.skill_id
               where ps.profile_id = pg.id), ARRAY[]::text[]),
    coalesce((select array_agg(sc.name order by sc.name)
                from public.profile_sectors psc join public.sectors sc on sc.id = psc.sector_id
               where psc.profile_id = pg.id), ARRAY[]::text[]),
    0::bigint
  from page pg
  join auth.users u on u.id = pg.id
  -- Same reason as branch A above: the cursor comes off the last row.
  order by pg.k_sort_at desc, pg.k_conn_id desc;
end;
$$;

-- Re-assert the grants. `create or replace` keeps the existing ACL, so
-- this is belt-and-braces — but on Supabase a function that loses its
-- explicit REVOKE ends up executable by `anon` through default
-- privileges, and that has bitten this repo repeatedly
-- ([[function-grant-default-privileges]]). Cheap to restate.
revoke execute on function public.list_my_connections(
  text, text[], text[], text[], text[], int, int, int, timestamptz, uuid
) from public, anon;
grant execute on function public.list_my_connections(
  text, text[], text[], text[], text[], int, int, int, timestamptz, uuid
) to authenticated;


-- ─── 3. A NOTE ON THE OTHER TWO LIST RPCs ───────────────────────────
-- list_my_pending_requests and list_my_sent_requests keep the windowed
-- single-branch form, and that is a decision rather than an oversight.
--
-- The sent list is bounded by `outstanding_cap` (30 by default) — the
-- feature refuses to let it grow past that, so there is no deep page to
-- optimise. The inbox is unbounded in principle, but a member who lets
-- it grow is a member with an unread inbox, and the digest exists to
-- stop that happening. Both got the id tie-break on their indexes above,
-- so if either ever needs the same treatment the index is already there.
--
-- The cost of pushing down early is duplicated filter logic in a third
-- and fourth place, which is the thing most likely to rot. Adding it
-- when a measurement demands it, and not before.
