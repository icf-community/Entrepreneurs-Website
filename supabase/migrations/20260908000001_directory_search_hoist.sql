-- ════════════════════════════════════════════════════════════════════
-- Foundry · Hoist the directory search's taxonomy lookups out of the row loop
--
-- Found by the C2 scalability audit (supabase/tests/scale_query_plans.sql)
-- against a seeded 2000-member corpus. `list_directory_cards` with a
-- text query took **339 ms warm**, against 6 ms for the same call with no
-- query and 2–10 ms for every listing board in the app. It was the
-- slowest read path in the product by a factor of thirty, and it is the
-- one a member touches by typing in the directory search box.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHAT WAS ACTUALLY WRONG
-- ──────────────────────────────────────────────────────────────────────
-- The free-text branch matched skills and sectors through two correlated
-- EXISTS subqueries:
--
--     exists (select 1 from profile_skills ps join skills s on s.id = ps.skill_id
--              where ps.profile_id = p.id and s.name ilike '%' || p_query || '%')
--
-- Only `ps.profile_id = p.id` is correlated. The `s.name ilike …` half
-- depends on nothing but the parameter — but because it is joined
-- *inside* the correlated subquery, the planner evaluates the whole
-- subquery per candidate row. auto_explain on the real call:
--
--     SubPlan 3
--       ->  Nested Loop (actual time=0.152..0.152 rows=0 loops=1834)
--             ->  Seq Scan on skills s_1 (actual rows=0 loops=1834)
--
-- **loops=1834.** The 167-row `skills` table was sequentially scanned
-- once per profile — 1834 scans, ~0.15 ms each, ~279 ms of the 299 ms
-- the query took. `sectors` got the same treatment (cheap only because
-- it has 7 rows).
--
-- The trap that hid this: writing the same predicate with a LITERAL
-- pattern instead of the parameter plans completely differently —
-- Postgres turns it into a `hashed SubPlan`, runs it ONCE, and the query
-- finishes in 5 ms. Every hand-check of this query with a literal in it
-- therefore came back clean. Only the parameterised call, which is the
-- only form that ever actually runs, is slow. And at the ~30 rows this
-- database held before the audit, 30 loops of a seq scan over a nearly
-- empty `skills` table is unmeasurable. It needed both a real row count
-- and the real parameterised call to show up at all.
--
-- ──────────────────────────────────────────────────────────────────────
-- THE FIX
-- ──────────────────────────────────────────────────────────────────────
-- Resolve the matching skill and sector ids ONCE, in their own CTEs,
-- before touching profiles; then the per-row test is a bare membership
-- check against `profile_skills`, served by its existing index. 1834
-- scans of `skills` become 1.
--
-- **The CTEs must be `AS MATERIALIZED`, and that is the entire fix.**
-- Written as plain CTEs this migration changed nothing measurable
-- (339 ms → 298 ms): since PostgreSQL 12 a CTE referenced once is
-- inlined by default, so the planner folded both of them straight back
-- into the correlated subquery and re-derived the identical per-row
-- `Seq Scan on skills ... loops=1834`. Moving the code out of the
-- subquery is not enough — the optimiser has to be told not to move it
-- back. With MATERIALIZED the same call is **12.6 ms**.
--
-- Measured, warm, on the 2000-member corpus, before → after:
--
--     directory, text search      339 ms  →  12.6 ms   (27×)
--     directory, no query         6.3 ms  →   6.6 ms
--     directory, deep page       11.4 ms  →  11.7 ms
--     directory, skill filter    35.2 ms  →  35.6 ms
--     directory facets           93.0 ms  →  91.1 ms
--
-- Behaviour is unchanged. Same signature, same columns, same ordering,
-- same visibility gate, same 100-row page cap. `ilike` semantics are
-- preserved exactly — the pattern is applied to `s.name` in both
-- versions, just at a different point in the plan. Verified rather than
-- asserted: the old body was loaded side by side as
-- `list_directory_cards_OLD` and both were run over 22 probe queries —
-- null/empty/no-match, personal names, a course, real skill and sector
-- names, upper- and lower-cased variants, `%` and `_`, both sort orders,
-- and combinations with the role/sector/skill filters — comparing
-- membership, row ORDER, total_count, skill_names and sector_names.
-- Zero differences, and the probes were checked to be non-vacuous
-- (the skill-name probe matched 66 rows, the sector-name probe 100).
--
-- Signature copied verbatim from 20260904000003_committee.sql, the
-- latest definition ([[recreate-function-from-latest]] — a mismatched
-- argument list creates a dead overload rather than replacing anything,
-- and the old slow body would go on serving every call).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.list_directory_cards(
  p_query    text     default null,
  p_roles    text[]   default null,
  p_courses  text[]   default null,
  p_sectors  text[]   default null,
  p_skills   text[]   default null,
  p_grad_min int      default null,
  p_grad_max int      default null,
  p_limit    int      default 48,
  p_offset   int      default 0,
  p_sort     text     default 'name'
)
returns table (
  id           uuid,
  first_name   text,
  surname      text,
  role         public.user_role,
  course       text,
  grad_year    smallint,
  avatar_path  text,
  bio_focus    text,
  bio_hobbies  text,
  created_at   timestamptz,
  skill_names  text[],
  sector_names text[],
  total_count  bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  -- The whole point of this migration: these two run ONCE, not once per
  -- candidate profile. Both return no rows when there is no text query,
  -- so the membership tests below are false and cost nothing.
  --
  -- One ROW per matching id, not one array — `= any(<subquery>)` treats
  -- the subquery as a set of elements, so returning smallint[] from it
  -- fails with "operator does not exist: smallint = smallint[]". A plain
  -- `in (select …)` over rows is also what the planner hashes best.
  with q_skill_ids as materialized (
    select s.id
      from public.skills s
     where p_query is not null and p_query <> ''
       and s.name ilike '%' || p_query || '%'
  ),
  q_sector_ids as materialized (
    select sc.id
      from public.sectors sc
     where p_query is not null and p_query <> ''
       and sc.name ilike '%' || p_query || '%'
  ),
  matched as (
    select p.*
      from public.profiles p
     where p.status = 'approved'
       and not p.is_committee
       and (public.is_approved() or public.is_admin())
       and (p_roles    is null or p.role::text = any(p_roles))
       and (p_courses  is null or p.course     = any(p_courses))
       and (p_grad_min is null or (p.grad_year is not null and p.grad_year >= p_grad_min))
       and (p_grad_max is null or (p.grad_year is not null and p.grad_year <= p_grad_max))
       and (
         p_query is null or p_query = '' or
         (p.first_name || ' ' || p.surname) ilike '%' || p_query || '%' or
         p.course       ilike '%' || p_query || '%' or
         p.bio_focus     ilike '%' || p_query || '%' or
         p.bio_hobbies   ilike '%' || p_query || '%' or
         p.working_on   ilike '%' || p_query || '%' or
         exists (
           select 1 from public.profile_skills ps
            where ps.profile_id = p.id
              and ps.skill_id in (select id from q_skill_ids)
         ) or
         exists (
           select 1 from public.profile_sectors psc
            where psc.profile_id = p.id
              and psc.sector_id in (select id from q_sector_ids)
         )
       )
       -- The p_sectors / p_skills FILTER branches (as opposed to the
       -- free-text branch above) are left exactly as they were. They
       -- carry the same shape, but they are not the same problem: the
       -- audit measured the skill filter at 35 ms, because `= any(...)`
       -- on an indexed column is a very different inner plan from an
       -- unanchored `ilike` over a whole table. Changing code the
       -- measurement did not implicate is how a performance fix acquires
       -- a correctness bug.
       and (
         p_sectors is null or exists (
           select 1 from public.profile_sectors psc
             join public.sectors sc on sc.id = psc.sector_id
            where psc.profile_id = p.id and sc.name = any(p_sectors)
         )
       )
       and (
         p_skills is null or exists (
           select 1 from public.profile_skills ps
             join public.skills s on s.id = ps.skill_id
            where ps.profile_id = p.id and s.name = any(p_skills)
         )
       )
  ),
  counted as (
    select m.*, count(*) over () as total_count from matched m
  ),
  page as (
    select * from counted
     order by
       case when p_sort = 'recent' then created_at end desc nulls last,
       case when p_sort = 'recent' then null else first_name end asc,
       case when p_sort = 'recent' then null else surname end asc,
       id
     limit greatest(1, least(coalesce(p_limit, 48), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year,
    pg.avatar_path,
    left(coalesce(pg.bio_focus, pg.working_on), 160),
    left(pg.bio_hobbies, 160),
    pg.created_at,
    -- These two stay correlated, and that is correct: they run only for
    -- the <=100 rows on the page that is being returned, not for every
    -- candidate. Bounded work, and the audit measured it at 6 ms.
    coalesce((
      select array_agg(s.name order by s.name)
      from public.profile_skills ps
      join public.skills s on s.id = ps.skill_id
      where ps.profile_id = pg.id
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(sc.name order by sc.name)
      from public.profile_sectors psc
      join public.sectors sc on sc.id = psc.sector_id
      where psc.profile_id = pg.id
    ), ARRAY[]::text[]),
    pg.total_count
  from page pg;
$$;

-- Re-assert the grants. `create or replace` keeps the existing ACL, so
-- this is belt-and-braces rather than strictly required — but on
-- Supabase a function that loses its explicit REVOKE ends up executable
-- by `anon` through default privileges, and that has bitten this repo
-- repeatedly ([[function-grant-default-privileges]]). Cheap to restate.
revoke execute on function public.list_directory_cards(
  text, text[], text[], text[], text[], int, int, int, int, text
) from public, anon;
grant execute on function public.list_directory_cards(
  text, text[], text[], text[], text[], int, int, int, int, text
) to authenticated;
