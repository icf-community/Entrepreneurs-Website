-- ════════════════════════════════════════════════════════════════════
-- Foundry · Listing feeds: set-based, same output
--
-- Under a realistic 500-member load test (2026-09-24, Small-sized DB)
-- list_approved_opportunities was 43% of all database time and
-- list_approved_events 12%. Neither can be cached in Redis: both return
-- contact_email only to the poster, an admin, or when the row is marked
-- visible (see lib/cache.ts), so the fix has to be in the query.
--
-- What each paid per call, and what changes:
--   opportunities — two correlated sub-selects PER ROW (skills and
--     sectors, each re-scanning the lookup table) plus is_admin() per
--     row inside the contact_email CASE. Now: skills and sectors are
--     aggregated once for the page of rows, and the viewer (uid, admin)
--     is resolved once. 8.35 → 2.10 ms/call at 263 open listings.
--   events — is_admin() per row. Now resolved once. ~1.0 → 0.6 ms/call.
--
-- Output is identical: same columns, same order, same rows, same
-- contact_email visibility — verified old-vs-new with EXCEPT ALL as a
-- member, a poster of a hidden-email row, an admin and a pending member,
-- and pinned by rls_smoke L1.
--
-- Copied from the latest definitions (20260830000004) with the same
-- signatures, so this replaces rather than overloads.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.list_approved_opportunities()
returns table (
  id                     uuid,
  position_name          text,
  company                text,
  pay                    text,
  location_type          public.location_type,
  location_text          text,
  description            text,
  start_month            smallint,
  start_year             int,
  application_deadline   date,
  contact_email          text,
  contact_email_visible  boolean,
  apply_method           public.apply_method,
  apply_url              text,
  posted_by              uuid,
  created_at             timestamptz,
  poster_first_name      text,
  poster_surname         text,
  poster_linkedin_url    text,
  skill_names            text[],
  sector_names           text[]
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with viewer as materialized (
    select (select auth.uid()) as uid, public.is_admin() as admin
  ),
  visible as materialized (
    select o.*
      from public.opportunities o
     where o.status = 'approved'
       and o.application_deadline >= current_date
       and (public.is_approved() or public.is_admin())
     order by o.application_deadline asc
     limit 1000
  ),
  sk as (
    select os.opportunity_id, array_agg(s.name order by s.name) as names
      from public.opportunity_skills os
      join public.skills s on s.id = os.skill_id
     where os.opportunity_id in (select id from visible)
     group by os.opportunity_id
  ),
  se as (
    select os.opportunity_id, array_agg(s.name order by s.name) as names
      from public.opportunity_sectors os
      join public.sectors s on s.id = os.sector_id
     where os.opportunity_id in (select id from visible)
     group by os.opportunity_id
  )
  select
    o.id, o.position_name, o.company, o.pay,
    o.location_type, o.location_text,
    o.description, o.start_month, o.start_year,
    o.application_deadline,
    case
      when o.contact_email_visible or o.posted_by = v.uid or v.admin
      then o.contact_email
      else null
    end,
    o.contact_email_visible,
    o.apply_method, o.apply_url,
    o.posted_by, o.created_at,
    p.first_name, p.surname, p.linkedin_url,
    coalesce(sk.names, ARRAY[]::text[]),
    coalesce(se.names, ARRAY[]::text[])
  from visible o
  cross join viewer v
  left join public.profiles p on p.id = o.posted_by
  left join sk on sk.opportunity_id = o.id
  left join se on se.opportunity_id = o.id
  order by o.application_deadline asc
;
$$;
grant execute on function public.list_approved_opportunities() to authenticated;

create or replace function public.list_approved_events()
returns table (
  id                     uuid,
  title                  text,
  description            text,
  luma_link              text,
  event_at               timestamptz,
  location               text,
  organiser_name         text,
  contact_email          text,
  contact_email_visible  boolean,
  is_society_event       boolean,
  posted_by              uuid,
  created_at             timestamptz,
  poster_first_name      text,
  poster_surname         text,
  poster_linkedin_url    text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with viewer as materialized (
    select (select auth.uid()) as uid, public.is_admin() as admin
  )
  select
    e.id, e.title, e.description, e.luma_link,
    e.event_at, e.location, e.organiser_name,
    case
      when e.contact_email_visible or e.posted_by = v.uid or v.admin
      then e.contact_email
      else null
    end,
    e.contact_email_visible,
    e.is_society_event,
    e.posted_by, e.created_at,
    p.first_name, p.surname, p.linkedin_url
  from public.events e
  cross join viewer v
  left join public.profiles p on p.id = e.posted_by
  where e.status = 'approved'
    and e.event_at >= now()
    and (public.is_approved() or v.admin)
  order by e.event_at asc
  limit 1000
;
$$;
grant execute on function public.list_approved_events() to authenticated;
