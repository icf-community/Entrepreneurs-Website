-- ════════════════════════════════════════════════════════════════════
-- Foundry · list_my_connection_facets without the big sort (E1b Stage 1)
--
-- After 20260928000007 this was the largest remaining share of database
-- time on /connections (29%): ~9 ms for a member with 100 connections,
-- ~100 ms for one with 1,600, at 5,000 members. Most of it was
-- `array_agg(distinct s.name order by s.name)` sorting every
-- connection × skill row by name only to deduplicate it.
--
-- Same fix as list_directory_facets: skills.name and sectors.name are
-- UNIQUE, so pick the ids first (a semi-join) and sort only the matching
-- names; the array is identical. `others` keeps only the three columns
-- used instead of p.*. Same signature, return table, security and
-- search_path as 20260917000003; grants re-stated below.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.list_my_connection_facets()
returns table (courses text[], sectors text[], skills text[], grad_min int, grad_max int, total bigint)
language sql stable security definer set search_path = public, auth as $$
  with edges as (
    select c.addressee_id as k_other_id from public.connections c
     where c.requester_id = auth.uid() and c.status = 'accepted'
    union all
    select c.requester_id from public.connections c
     where c.addressee_id = auth.uid() and c.status = 'accepted'
  ),
  others as (
    select p.id, p.course, p.grad_year from edges e join public.profiles p on p.id = e.k_other_id
     where p.status = 'approved'
  )
  select
    coalesce((select array_agg(distinct o.course order by o.course) from others o where o.course is not null and length(trim(o.course)) > 0), ARRAY[]::text[]),
    coalesce((
      select array_agg(s.name order by s.name)
      from public.sectors s
      where s.id in (select psc.sector_id from others o join public.profile_sectors psc on psc.profile_id = o.id)
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(s.name order by s.name)
      from public.skills s
      where s.id in (select ps.skill_id from others o join public.profile_skills ps on ps.profile_id = o.id)
    ), ARRAY[]::text[]),
    (select min(o.grad_year)::int from others o where o.grad_year is not null),
    (select max(o.grad_year)::int from others o where o.grad_year is not null),
    (select count(*) from others o)
  where public.is_approved() or public.is_admin();
$$;
revoke execute on function public.list_my_connection_facets() from public, anon, authenticated;
grant  execute on function public.list_my_connection_facets() to authenticated;
