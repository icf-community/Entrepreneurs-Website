-- ════════════════════════════════════════════════════════════════════
-- Adversarial sweep F1: event_at must be a real, near-ish date.
--
-- submit_event accepted event_at = 'infinity' (and -infinity, and year
-- 275760+). The server action's zod schema refuses those, but the RPC is
-- callable directly with the anon key and any member JWT, and the RPC is
-- the authority. One such row made /admin/events throw
-- "RangeError: Invalid time value" for every admin until it was deleted
-- by hand.
--
-- Fix, in two layers:
--   1. submit_event, update_event, admin_create_event refuse non-finite
--      dates and dates more than five years out (errcode 22023, which
--      describeSupabaseError passes through as a readable sentence).
--   2. A CHECK on events.event_at, so a path that skips these RPCs (an
--      admin_apply_listing_edit replay of a staged payload, a future
--      function, a service-role script) still cannot store one.
--
-- Each function below is the LATEST definition (submit_event:
-- 20260528000016; update_event: 20261025000003; admin_create_event:
-- 20260610000000) with only the date guard changed. create or replace
-- keeps the existing grants.
--
-- PROD PRE-CHECK (run before pushing; must return 0 rows or the
-- VALIDATE below fails and the migration rolls back):
--   select id, event_at from public.events
--    where event_at <= '1970-01-01' or event_at >= '2100-01-01'
--       or not isfinite(event_at);
--
-- ROLLBACK: alter table public.events drop constraint events_event_at_sane;
--           then re-apply the three functions from the migrations above.
-- ════════════════════════════════════════════════════════════════════

-- ─── submit_event ──────────────────────────────────────────────────
create or replace function public.submit_event(
  p_title                 text,
  p_description           text,
  p_luma_link             text,
  p_event_at              timestamptz,
  p_location              text,
  p_organiser_name        text,
  p_contact_email         text,
  p_contact_email_visible boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_email  text;
  v_new_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_approved() then
    raise exception 'Only approved members can post events' using errcode = '42501';
  end if;
  if p_event_at is null or p_event_at < now() then
    raise exception 'Event start time must be in the future' using errcode = '22023';
  end if;
  if not isfinite(p_event_at) or p_event_at > now() + interval '5 years' then
    raise exception 'Event start time must be within the next five years' using errcode = '22023';
  end if;

  v_email := nullif(trim(coalesce(p_contact_email, '')), '');
  if v_email is null then
    select email into v_email from auth.users where id = v_caller;
  end if;

  insert into public.events (
    posted_by, status,
    title, description, luma_link,
    event_at, location, organiser_name,
    contact_email, contact_email_visible
  ) values (
    v_caller, 'pending',
    p_title, p_description, p_luma_link,
    p_event_at, p_location, p_organiser_name,
    v_email, coalesce(p_contact_email_visible, false)
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- ─── update_event ──────────────────────────────────────────────────
create or replace function public.update_event(
  p_id                    uuid,
  p_title                 text,
  p_description           text,
  p_luma_link             text,
  p_event_at              timestamptz,
  p_location              text,
  p_organiser_name        text,
  p_contact_email         text,
  p_contact_email_visible boolean,
  p_expected_version bigint default null
) returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_edit_version bigint;
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_status listing_status;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select posted_by, status, edit_version into v_owner, v_status, v_edit_version
    from public.events where id = p_id
     for update;
  if not found then
    raise exception 'Event not found, or it has been removed.' using errcode = '42501';
  end if;
  if v_owner <> v_caller then
    raise exception 'You can only edit your own listings' using errcode = '42501';
  end if;
  if not public.is_approved() then
    raise exception 'Account is not in good standing' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version <> v_edit_version then
    raise exception 'This changed in another tab — reload before saving.' using errcode = 'PT409';
  end if;

  if v_status not in ('pending', 'approved') then
    raise exception 'Only pending or approved listings can be edited' using errcode = '42501';
  end if;

  -- Mirrors update_opportunity's deadline guard. The five-minute grace
  -- matches eventSchema's, so a submission for an imminent event isn't
  -- refused by its own round trip. Applies to a proposed revision too —
  -- an edit that moves an event into the past is wrong whichever path
  -- it takes.
  if p_event_at is null or p_event_at < now() - interval '5 minutes' then
    raise exception 'Event must start in the future' using errcode = '22023';
  end if;
  if not isfinite(p_event_at) or p_event_at > now() + interval '5 years' then
    raise exception 'Event start time must be within the next five years' using errcode = '22023';
  end if;

  if v_status = 'approved' then
    perform public.stage_listing_edit('event', p_id, jsonb_build_object(
      'title',                 p_title,
      'description',           p_description,
      'luma_link',             p_luma_link,
      'event_at',              p_event_at,
      'location',              p_location,
      'organiser_name',        p_organiser_name,
      'contact_email',         p_contact_email,
      'contact_email_visible', coalesce(p_contact_email_visible, false)));
    return;
  end if;

  update public.events
     set title                 = p_title,
         description           = p_description,
         luma_link             = p_luma_link,
         event_at              = p_event_at,
         location              = p_location,
         organiser_name        = p_organiser_name,
         contact_email         = p_contact_email,
         contact_email_visible = coalesce(p_contact_email_visible, false)
   where id = p_id;
end;
$$;

-- ─── admin_create_event (9-arg, with society flag) ─────────────────
create or replace function public.admin_create_event(
  p_title                 text,
  p_description           text,
  p_luma_link             text,
  p_event_at              timestamptz,
  p_location              text,
  p_organiser_name        text,
  p_contact_email         text,
  p_contact_email_visible boolean,
  p_is_society_event      boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_email  text;
  v_new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller) then
    raise exception 'Your admin account does not have a member profile yet, so it cannot be set as the poster. Please complete onboarding (or have a developer create your profile) first.';
  end if;
  if p_event_at is null or p_event_at < now() then
    raise exception 'Event start time must be in the future' using errcode = '22023';
  end if;
  if not isfinite(p_event_at) or p_event_at > now() + interval '5 years' then
    raise exception 'Event start time must be within the next five years' using errcode = '22023';
  end if;

  v_email := nullif(trim(coalesce(p_contact_email, '')), '');
  if v_email is null then
    select email into v_email from auth.users where id = v_caller;
  end if;

  insert into public.events (
    posted_by, status,
    title, description, luma_link,
    event_at, location, organiser_name,
    contact_email, contact_email_visible,
    is_society_event,
    approved_at, approved_by
  ) values (
    v_caller, 'approved',
    p_title, p_description, p_luma_link,
    p_event_at, p_location, p_organiser_name,
    v_email, coalesce(p_contact_email_visible, false),
    coalesce(p_is_society_event, false),
    now(), v_caller
  )
  returning id into v_new_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'admin_create_event', 'events', v_new_id, null);

  return v_new_id;
end;
$$;

-- ─── Table backstop ────────────────────────────────────────────────
-- Comparison with 'infinity' is false for both < and > bounds, so the
-- two range tests below exclude +/-infinity without a separate isfinite.
alter table public.events drop constraint if exists events_event_at_sane;
alter table public.events
  add constraint events_event_at_sane
  check (event_at > timestamptz '1970-01-01' and event_at < timestamptz '2100-01-01')
  not valid;
alter table public.events validate constraint events_event_at_sane;
