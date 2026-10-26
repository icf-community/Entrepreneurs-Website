-- Pre-launch optimization (2026-10-26): make the opportunities/events
-- listing RPCs cacheable for the common case.
--
-- list_approved_opportunities and list_approved_events are the highest-
-- traffic read paths in the app and have never been cached, because their
-- result is caller-dependent in two ways:
--   1. contact_email is masked unless the row is marked visible, or the
--      caller is the poster, or the caller is an admin (both RPCs).
--   2. list_approved_opportunities additionally filters the ROW SET
--      itself by member_admits_audience(v.uid, o.eligible_audience) —
--      which jobs even appear depends on the caller's own education
--      status (20261006000002). Admins and posters always see every job
--      regardless of audience.
--
-- Both RPCs gain `p_cache_safe boolean default false`. Every existing
-- caller (nothing passes the new param) is byte-for-byte unchanged — this
-- only changes behavior when a caller explicitly opts in. When true:
--   - contact_email masking drops the posted_by/admin override, keeping
--     only the visible flag (identical for every caller).
--   - (opportunities only) the audience/posted_by/admin row filter is
--     skipped entirely, returning every approved, non-expired opportunity.
--     The app layer re-applies the audience filter in JS using the
--     viewer's own already-fetched education status (opportunities/page.tsx
--     already calls myEducation() for the "confirm your status" prompt),
--     and keeps the poster's own rows unconditionally — same exemption
--     the SQL has today, just evaluated client-side instead.
--
-- my_posted_opportunity_contact_emails / my_posted_event_contact_emails
-- are new, tiny helpers so the app can restore a non-admin poster's own
-- real contact_email on top of the cache-safe (visible-flag-only) result,
-- without a second trip through the full listing RPC.

-- ─── list_approved_opportunities ──────────────────────────────────────
-- Identical to 20261006000002's definition except for the new
-- p_cache_safe param, which widens the visible-row filter and narrows the
-- contact_email override, both only when true.
drop function if exists public.list_approved_opportunities();
create function public.list_approved_opportunities(p_cache_safe boolean default false)
returns table(id uuid, position_name text, company text, pay text, location_type location_type,
              location_text text, description text, start_month smallint, start_year integer,
              application_deadline date, contact_email text, contact_email_visible boolean,
              apply_method apply_method, apply_url text, posted_by uuid,
              created_at timestamp with time zone, poster_first_name text, poster_surname text,
              poster_linkedin_url text, skill_names text[], sector_names text[],
              eligible_audience text, poster_avatar_path text)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  with viewer as materialized (
    select (select auth.uid()) as uid, public.is_admin() as admin
  ),
  visible as materialized (
    select o.*
      from public.opportunities o
      cross join viewer v
     where o.status = 'approved'
       and o.application_deadline >= current_date
       and (public.is_approved() or v.admin)
       and (p_cache_safe or v.admin or o.posted_by = v.uid
            or public.member_admits_audience(v.uid, o.eligible_audience))
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
      when o.contact_email_visible then o.contact_email
      when not p_cache_safe and (o.posted_by = v.uid or v.admin) then o.contact_email
      else null
    end,
    o.contact_email_visible,
    o.apply_method, o.apply_url,
    o.posted_by, o.created_at,
    p.first_name, p.surname, p.linkedin_url,
    coalesce(sk.names, ARRAY[]::text[]),
    coalesce(se.names, ARRAY[]::text[]),
    o.eligible_audience,
    p.avatar_path
  from visible o
  cross join viewer v
  left join public.profiles p on p.id = o.posted_by
  left join sk on sk.opportunity_id = o.id
  left join se on se.opportunity_id = o.id
  order by o.application_deadline asc
;
$function$;
revoke all on function public.list_approved_opportunities(boolean) from public, anon, authenticated;
grant execute on function public.list_approved_opportunities(boolean) to authenticated;

-- ─── list_approved_events ──────────────────────────────────────────────
-- Identical to 20260917000018's definition except for the new
-- p_cache_safe param, which narrows the contact_email override when true.
-- No audience filter exists on events, so the row set itself needs no
-- change here.
drop function if exists public.list_approved_events();
create function public.list_approved_events(p_cache_safe boolean default false)
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
      when e.contact_email_visible then e.contact_email
      when not p_cache_safe and (e.posted_by = v.uid or v.admin) then e.contact_email
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
revoke all on function public.list_approved_events(boolean) from public, anon, authenticated;
grant execute on function public.list_approved_events(boolean) to authenticated;

-- ─── Self-contact-email overlay helpers ────────────────────────────────
-- A non-admin caller's own posted rows, so the app can restore the real
-- contact_email on top of the cache-safe (visible-flag-only) result
-- without another trip through the full listing RPC. Not filtered by
-- status: a cache-safe result only ever contains approved rows, so a
-- pending/rejected id here simply has nothing to match against.
create or replace function public.my_posted_opportunity_contact_emails()
returns table(id uuid, contact_email text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select id, contact_email from public.opportunities where posted_by = (select auth.uid());
$$;
revoke all on function public.my_posted_opportunity_contact_emails() from public, anon, authenticated;
grant execute on function public.my_posted_opportunity_contact_emails() to authenticated;

create or replace function public.my_posted_event_contact_emails()
returns table(id uuid, contact_email text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select id, contact_email from public.events where posted_by = (select auth.uid());
$$;
revoke all on function public.my_posted_event_contact_emails() from public, anon, authenticated;
grant execute on function public.my_posted_event_contact_emails() to authenticated;
