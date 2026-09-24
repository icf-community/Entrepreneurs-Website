-- ════════════════════════════════════════════════════════════════════
-- Foundry · list_my_connection_graph takes the same filters as the card
--           view, because the two views have to AGREE
--
-- The graph is a second view of one list, behind a toggle, with one
-- filter panel above both. If the filters only reached one of them, the
-- toggle would silently change the membership of the set being looked at
-- — which is the kind of bug nobody reports because it looks like the
-- graph simply "showing something else".
--
-- WHY THIS IS A MIGRATION AND NOT CLIENT-SIDE FILTERING. The payload
-- carries role, course, grad_year, skills and sectors, so the chip
-- filters could have been applied in the browser. The free-text search
-- could not: `list_my_connections` matches `q` against bio_focus,
-- bio_hobbies and working_on as well, and the graph payload deliberately
-- carries none of those. A browser-side filter would therefore have
-- agreed with the card view on every chip and disagreed on every search,
-- which is worse than not filtering at all — a divergence that only
-- appears for some inputs is one nobody trusts a test for. Sharing the
-- predicate is the only way the agreement is a property rather than a
-- coincidence.
--
-- The predicate below is copied verbatim from `list_my_connections`
-- (20260917000003 §1), including the `q_skill_ids` / `q_sector_ids`
-- hoists. Copied rather than factored into a shared helper on purpose:
-- a `where` clause is not callable, and the alternatives — a view, or a
-- set-returning helper both functions join against — would each cost a
-- planning boundary on the hot read path to save a duplication that
-- rls_smoke asserts is in sync anyway.
--
-- STILL NO EMAIL ADDRESSES, and still no edge list. Both omissions are
-- the point of this function and neither changes here: every edge is
-- you-to-node by construction, so there is no node-to-node edge to leak,
-- and a graph payload that never carries an address cannot become a
-- bulk-export endpoint.
--
-- The 500-node cap now applies AFTER filtering, which is the useful
-- ordering: a member over the cap can filter their way down into a
-- plottable set rather than being stuck with the most recent 500.
--
-- DROP first: adding parameters with defaults to a zero-argument
-- function would leave `list_my_connection_graph()` as a live overload
-- resolvable alongside the new one, which is the dead-overload trap
-- rls_smoke §18 exists to catch.
-- ════════════════════════════════════════════════════════════════════

drop function if exists public.list_my_connection_graph();

create function public.list_my_connection_graph(
  p_query    text   default null,
  p_roles    text[] default null,
  p_courses  text[] default null,
  p_sectors  text[] default null,
  p_skills   text[] default null,
  p_grad_min int    default null,
  p_grad_max int    default null
)
returns table (
  id           uuid,
  first_name   text,
  surname      text,
  role         public.user_role,
  course       text,
  grad_year    smallint,
  avatar_path  text,
  connected_at timestamptz,
  skill_names  text[],
  sector_names text[],
  total_count  bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with q_skill_ids as materialized (
    select s.id from public.skills s
     where p_query is not null and p_query <> '' and s.name ilike '%' || p_query || '%'
  ),
  q_sector_ids as materialized (
    select sc.id from public.sectors sc
     where p_query is not null and p_query <> '' and sc.name ilike '%' || p_query || '%'
  ),
  edges as (
    select c.addressee_id as k_other_id, c.decided_at as k_sort_at from public.connections c
     where c.requester_id = auth.uid() and c.status = 'accepted'
       and (public.is_approved() or public.is_admin())
    union all
    select c.requester_id, c.decided_at from public.connections c
     where c.addressee_id = auth.uid() and c.status = 'accepted'
       and (public.is_approved() or public.is_admin())
  ),
  matched as (
    select e.k_sort_at, op.*
      from edges e join public.profiles op on op.id = e.k_other_id
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
                  where ps.profile_id = op.id and ps.skill_id in (select id from q_skill_ids)) or
         exists (select 1 from public.profile_sectors psc
                  where psc.profile_id = op.id and psc.sector_id in (select id from q_sector_ids))
       )
       and (
         p_sectors is null or exists (
           select 1 from public.profile_sectors psc
             join public.sectors sc on sc.id = psc.sector_id
            where psc.profile_id = op.id and sc.name = any(p_sectors)
         )
       )
       and (
         p_skills is null or exists (
           select 1 from public.profile_skills ps
             join public.skills s on s.id = ps.skill_id
            where ps.profile_id = op.id and s.name = any(p_skills)
         )
       )
  ),
  counted as (
    -- Counted BEFORE the cap, so total_count is how many match the
    -- filters rather than how many were plotted. The client needs the
    -- difference to say "showing 500 of 812".
    select m.*, count(*) over () as k_total from matched m
  ),
  page as (
    -- A stable order still matters with no cursor: the cap means WHICH
    -- nodes come back is order-dependent, and a graph whose membership
    -- shuffles between two loads of the same data looks broken.
    select * from counted cn order by cn.k_sort_at desc, cn.id desc limit 500
  )
  select
    pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year,
    pg.avatar_path, pg.k_sort_at,
    coalesce((
      select array_agg(s.name order by s.name)
        from public.profile_skills ps join public.skills s on s.id = ps.skill_id
       where ps.profile_id = pg.id
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(sc.name order by sc.name)
        from public.profile_sectors psc join public.sectors sc on sc.id = psc.sector_id
       where psc.profile_id = pg.id
    ), ARRAY[]::text[]),
    pg.k_total
  from page pg
  order by pg.k_sort_at desc, pg.id desc;
$$;

revoke execute on function public.list_my_connection_graph(text, text[], text[], text[], text[], int, int)
  from public, anon;
grant  execute on function public.list_my_connection_graph(text, text[], text[], text[], text[], int, int)
  to authenticated;
