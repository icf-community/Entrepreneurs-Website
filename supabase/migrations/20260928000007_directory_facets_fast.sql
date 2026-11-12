-- ════════════════════════════════════════════════════════════════════
-- Foundry · list_directory_facets without the big sort (E1b Stage 1)
--
-- At 250 signed-in members this one function was 71% of all database
-- time (mean 1.45 s under load, 200 ms idle at 5,000 members). Nearly all
-- of it was `array_agg(distinct s.name order by s.name)` over the ~27k
-- profile_skills × profiles rows: every row sorted by name only to be
-- deduplicated down to ~170 skills.
--
-- skills.name and sectors.name are UNIQUE, so picking the ids first
-- (a semi-join) and sorting only the matching names gives the identical
-- array: 180 ms → 3 ms for skills. Same signature, return table, security
-- and search_path as 20260826000003; grants unchanged by CREATE OR REPLACE
-- (20260830000005 revoked anon).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.list_directory_facets()
returns table (
  courses  text[],
  sectors  text[],
  skills   text[],
  grad_min int,
  grad_max int,
  total    bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    coalesce((
      select array_agg(distinct p.course order by p.course)
      from public.profiles p
      where p.status = 'approved' and p.course is not null and length(trim(p.course)) > 0
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(s.name order by s.name)
      from public.sectors s
      where s.id in (
        select psc.sector_id
        from public.profile_sectors psc
        join public.profiles p on p.id = psc.profile_id
        where p.status = 'approved'
      )
    ), ARRAY[]::text[]),
    coalesce((
      select array_agg(s.name order by s.name)
      from public.skills s
      where s.id in (
        select ps.skill_id
        from public.profile_skills ps
        join public.profiles p on p.id = ps.profile_id
        where p.status = 'approved'
      )
    ), ARRAY[]::text[]),
    (select min(grad_year)::int from public.profiles where status = 'approved' and grad_year is not null),
    (select max(grad_year)::int from public.profiles where status = 'approved' and grad_year is not null),
    (select count(*) from public.profiles where status = 'approved')
  where public.is_approved() or public.is_admin();
$$;
