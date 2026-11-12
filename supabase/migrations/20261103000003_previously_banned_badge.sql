-- ════════════════════════════════════════════════════════════════════
-- Foundry · Flag a re-signup from a previously-banned address in the review queue
--
-- A1 (20261026000019) already stops the auto-approval bypass: an address whose last
-- account was rejected lands back in the normal pending_review queue instead of being
-- auto-approved. What it does not do is tell the reviewer that — the card looks like
-- any other pending alum/student. admin_list_pending_profiles now also returns
-- previously_banned, true iff the signup email's hash is in banned_email_hashes.
--
-- Pre-check: none (read-only addition, no data changes).
-- Deploy order: independent.
-- Rollback: drop and recreate admin_list_pending_profiles from 20260826000004 (minus the
-- new column), restate the same revoke/grant pair.
--
-- Recreated with `drop function` first, not bare `create or replace`: adding a column to
-- a RETURNS TABLE signature changes the function's OUT parameters, which Postgres refuses
-- to do in place. The revoke/grant pair is restated in the same migration on purpose — a
-- freshly (re)created function on this project is EXECUTE-able by anon/authenticated again
-- regardless of what an earlier migration revoked from the previous OID (20260905000001).
-- ════════════════════════════════════════════════════════════════════

drop function if exists public.admin_list_pending_profiles(int, int);

create function public.admin_list_pending_profiles(
  p_limit  int default 25,
  p_offset int default 0
)
returns table (
  id                uuid,
  first_name        text,
  surname           text,
  role              public.user_role,
  course            text,
  grad_year         int,
  bio               text,
  working_on        text,
  linkedin_url      text,
  github_url        text,
  portfolio_url     text,
  email             text,
  created_at        timestamptz,
  skill_names       text[],
  sector_names      text[],
  previously_banned boolean,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  return query
  with counted as (
    select p.*, au.email::text as signup_email, count(*) over () as n
      from public.profiles p
      left join auth.users au on au.id = p.id
     where p.status = 'pending_review'
  ),
  page as (
    select * from counted
     order by counted.created_at asc, counted.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    pg.id, pg.first_name, pg.surname, pg.role, pg.course, pg.grad_year,
    pg.bio, pg.working_on, pg.linkedin_url, pg.github_url, pg.portfolio_url,
    pg.signup_email, pg.created_at,
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
    pg.signup_email is not null and exists (
      select 1 from public.banned_email_hashes b
       where b.email_hash = public.email_ban_hash(pg.signup_email)
    ),
    pg.n
  from page pg;
end;
$$;

revoke execute on function public.admin_list_pending_profiles(int, int) from public, anon;
grant execute on function public.admin_list_pending_profiles(int, int) to authenticated;
