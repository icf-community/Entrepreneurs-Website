-- Security audit follow-up (F4, deferred from the first pass, now done).
--
-- update_opportunity / update_event / update_vc_grant already require a
-- p_expected_version matching the row's edit_version before they'll write
-- (20261011000007) — but a PENDING listing can still be edited directly
-- by its owner (update_* allows status in ('pending', 'approved')), and
-- approve_opportunity / approve_event / approve_vc_grant never adopted the
-- same check. An admin can open a listing's full details, read content X,
-- and while they're reading it the owner edits to content Y — the admin's
-- next click still reads as "approve this listing" with no version pinned
-- to what they actually reviewed, so Y gets approved though the admin
-- only ever saw X.
--
-- Fix: the same optimistic-concurrency pattern already used by update_*,
-- applied to approve_* only (reject_* don't publish content, so a changed
-- draft being rejected instead of an approved one is not a trust issue).
-- p_expected_version defaults to null for backward compatibility with any
-- caller not yet passing it, but null is then treated as a mismatch, same
-- as update_opportunity does — there is no caller left that should ever
-- omit it once the frontend is updated in the same change.
--
-- Also recreates list_pending_opportunities_admin / list_pending_events_admin
-- (from latest, 20260830000003) to return edit_version, since the review
-- queue has to show the admin's client the version it's approving against.
-- vcs_grants already returns edit_version from its plain table select
-- (lib/data/admin.ts), no RPC change needed there.

-- CREATE OR REPLACE cannot change a RETURNS TABLE function's column list
-- (its row type is defined by OUT parameters) — drop first.
drop function if exists public.list_pending_opportunities_admin();
create function public.list_pending_opportunities_admin()
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
  sector_names           text[],
  edit_version           bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: admin required' using errcode = '42501';
  end if;
  return query
    select
      o.id, o.position_name, o.company, o.pay,
      o.location_type, o.location_text,
      o.description, o.start_month, o.start_year,
      o.application_deadline,
      o.contact_email, o.contact_email_visible,
      o.apply_method, o.apply_url,
      o.posted_by, o.created_at,
      p.first_name, p.surname, p.linkedin_url,
      coalesce((
        select array_agg(s.name order by s.name)
        from public.opportunity_skills os
        join public.skills s on s.id = os.skill_id
        where os.opportunity_id = o.id
      ), ARRAY[]::text[]),
      coalesce((
        select array_agg(s.name order by s.name)
        from public.opportunity_sectors os
        join public.sectors s on s.id = os.sector_id
        where os.opportunity_id = o.id
      ), ARRAY[]::text[]),
      o.edit_version
    from public.opportunities o
    left join public.profiles p on p.id = o.posted_by
    where o.status = 'pending'
    order by o.created_at desc
    limit 1000;
end;
$$;
revoke all on function public.list_pending_opportunities_admin() from public, anon, authenticated;
grant execute on function public.list_pending_opportunities_admin() to authenticated;

drop function if exists public.list_pending_events_admin();
create function public.list_pending_events_admin()
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
  posted_by              uuid,
  created_at             timestamptz,
  poster_first_name      text,
  poster_surname         text,
  poster_linkedin_url    text,
  edit_version           bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: admin required' using errcode = '42501';
  end if;
  return query
    select
      e.id, e.title, e.description, e.luma_link,
      e.event_at, e.location, e.organiser_name,
      e.contact_email, e.contact_email_visible,
      e.posted_by, e.created_at,
      p.first_name, p.surname, p.linkedin_url,
      e.edit_version
    from public.events e
    left join public.profiles p on p.id = e.posted_by
    where e.status = 'pending'
    order by e.created_at desc
    limit 1000;
end;
$$;
revoke all on function public.list_pending_events_admin() from public, anon, authenticated;
grant execute on function public.list_pending_events_admin() to authenticated;

-- ─── approve_event: pin to the edit_version the admin reviewed ───────
create or replace function public.approve_event(
  p_event_id uuid,
  p_notes    text default null,
  p_expected_version bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
  v_version bigint;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  select status, edit_version into v_status, v_version from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found: %', p_event_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Event is not pending review (status=%)', v_status;
  end if;
  if p_expected_version is null or p_expected_version <> v_version then
    raise exception 'This changed since you last viewed it — reload before approving.' using errcode = 'PT409';
  end if;

  update public.events
     set status          = 'approved',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = null
   where id = p_event_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'approve_event', 'events', p_event_id, p_notes);
end;
$$;

-- ─── approve_opportunity: pin to the edit_version the admin reviewed ─
create or replace function public.approve_opportunity(
  p_opportunity_id uuid,
  p_notes          text default null,
  p_expected_version bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
  v_version bigint;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  select status, edit_version into v_status, v_version from public.opportunities where id = p_opportunity_id for update;
  if not found then
    raise exception 'Opportunity not found: %', p_opportunity_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Opportunity is not pending review (status=%)', v_status;
  end if;
  if p_expected_version is null or p_expected_version <> v_version then
    raise exception 'This changed since you last viewed it — reload before approving.' using errcode = 'PT409';
  end if;

  update public.opportunities
     set status          = 'approved',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = null
   where id = p_opportunity_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'approve_opportunity', 'opportunities', p_opportunity_id, p_notes);
end;
$$;

-- ─── approve_vc_grant: pin to the edit_version the admin reviewed ────
create or replace function public.approve_vc_grant(
  p_id    uuid,
  p_notes text default null,
  p_expected_version bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
  v_version bigint;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  select status, edit_version into v_status, v_version from public.vcs_grants where id = p_id for update;
  if not found then
    raise exception 'VC/grant not found: %', p_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'VC/grant is not pending review (status=%)', v_status;
  end if;
  if p_expected_version is null or p_expected_version <> v_version then
    raise exception 'This changed since you last viewed it — reload before approving.' using errcode = 'PT409';
  end if;

  update public.vcs_grants
     set status          = 'approved',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = null
   where id = p_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'approve_vc_grant', 'vcs_grants', p_id, p_notes);
end;
$$;

-- Signatures changed (new trailing param) — the old three-arg overloads
-- from 20261011000001 are gone after CREATE OR REPLACE only if the
-- parameter list is identical; it is not (one new param), so Postgres
-- would otherwise leave the old two-arg versions as live dead overloads.
-- Drop them explicitly, then re-apply the grants the new signature needs.
drop function if exists public.approve_event(uuid, text);
drop function if exists public.approve_opportunity(uuid, text);
drop function if exists public.approve_vc_grant(uuid, text);

revoke all on function public.approve_event(uuid, text, bigint)       from public, anon, authenticated;
revoke all on function public.approve_opportunity(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.approve_vc_grant(uuid, text, bigint)    from public, anon, authenticated;
grant execute on function public.approve_event(uuid, text, bigint)       to authenticated;
grant execute on function public.approve_opportunity(uuid, text, bigint) to authenticated;
grant execute on function public.approve_vc_grant(uuid, text, bigint)    to authenticated;
