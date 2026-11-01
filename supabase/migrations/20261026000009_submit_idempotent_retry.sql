-- ════════════════════════════════════════════════════════════════════
-- D-1: a retried submit returns the listing it already created.
--
-- The forms carry no idempotency key. If the server commits a submit and the
-- reply is lost (a phone going through a tunnel), the member sees an error and
-- presses Submit again, and the database held two identical pending listings
-- (e2e/adversarial/offline.spec.ts, "response is lost after the server
-- committed"). submit_opportunity, submit_event and submit_vc_grant now look
-- for a pending listing from the same member with EVERY submitted field equal
-- and return its id instead of inserting another.
--
-- Deliberately all fields, not a subset: a member who fixes a typo and
-- resubmits while the first is still pending must get a new row carrying the
-- fix, not silently the old one.
--
-- Only the caller's own pending rows are read. The advisory lock is the one
-- tg_cap_pending_listings (20261026000007) takes (same key, re-entrant in one
-- transaction), so two concurrent identical submits serialise: the second
-- finds the first. The lookup is a separate statement after the lock, so it
-- sees rows committed while it waited.
--
-- Bodies are the LATEST definitions with the lookup added before the insert:
--   submit_event        20261026000006
--   submit_opportunity  20261006000002
--   submit_vc_grant     20260528000016
-- Signatures, search_path, security definer and grants are unchanged
-- (CREATE OR REPLACE keeps the existing grants).
--
-- Prod pre-check: none, no data is touched.
-- Rollback: re-apply the three definitions from the migrations above.
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

  perform pg_advisory_xact_lock(hashtextextended('pending_listings:events:' || v_caller::text, 0));
  select e.id into v_new_id
    from public.events e
   where e.posted_by = v_caller and e.status = 'pending'
     and e.title                 is not distinct from p_title
     and e.description           is not distinct from p_description
     and e.luma_link             is not distinct from p_luma_link
     and e.event_at              is not distinct from p_event_at
     and e.location              is not distinct from p_location
     and e.organiser_name        is not distinct from p_organiser_name
     and e.contact_email         is not distinct from v_email
     and e.contact_email_visible is not distinct from coalesce(p_contact_email_visible, false)
   order by e.created_at
   limit 1;
  if found then
    return v_new_id;
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

-- ─── submit_vc_grant ───────────────────────────────────────────────
create or replace function public.submit_vc_grant(
  p_kind        vc_grant_kind,
  p_name        text,
  p_description text,
  p_link        text,
  p_amount      text,
  p_deadline    date,
  p_stage       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_amount text := nullif(trim(coalesce(p_amount, '')), '');
  v_stage  text := nullif(trim(coalesce(p_stage,  '')), '');
  v_new_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_approved() then
    raise exception 'Only approved members can submit VCs/grants' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pending_listings:vcs_grants:' || v_caller::text, 0));
  select v.id into v_new_id
    from public.vcs_grants v
   where v.posted_by = v_caller and v.status = 'pending'
     and v.kind        is not distinct from p_kind
     and v.name        is not distinct from p_name
     and v.description is not distinct from p_description
     and v.link        is not distinct from p_link
     and v.amount      is not distinct from v_amount
     and v.deadline    is not distinct from p_deadline
     and v.stage       is not distinct from v_stage
   order by v.created_at
   limit 1;
  if found then
    return v_new_id;
  end if;

  insert into public.vcs_grants (
    posted_by, status, kind,
    name, description, link,
    amount, deadline, stage
  ) values (
    v_caller, 'pending', p_kind,
    p_name, p_description, p_link,
    v_amount,
    p_deadline,
    v_stage
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- ─── submit_opportunity ────────────────────────────────────────────
-- Skills and sectors compare as sorted, de-duplicated sets, which is what the
-- insert below stores (on conflict do nothing).
create or replace function public.submit_opportunity(
  p_position_name text, p_company text, p_pay text, p_location_type location_type, p_location_text text,
  p_description text, p_start_month smallint, p_start_year integer, p_application_deadline date,
  p_contact_email text, p_contact_email_visible boolean, p_apply_method apply_method, p_apply_url text,
  p_skill_ids smallint[], p_sector_ids smallint[], p_eligible_audience text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller   uuid := auth.uid();
  v_email    text;
  v_new_id   uuid;
  v_skills   smallint[];
  v_sectors  smallint[];
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_approved() then
    raise exception 'Only approved members can post opportunities' using errcode = '42501';
  end if;
  if p_application_deadline is null or p_application_deadline < current_date then
    raise exception 'Application deadline must be today or later';
  end if;
  perform public.assert_audience(p_eligible_audience);

  -- Fall back to the caller's signup email when none provided.
  v_email := nullif(trim(coalesce(p_contact_email, '')), '');
  if v_email is null then
    select email into v_email from auth.users where id = v_caller;
  end if;

  select coalesce(array_agg(distinct s order by s), '{}'::smallint[]) into v_skills
    from unnest(coalesce(p_skill_ids, '{}'::smallint[])) s;
  select coalesce(array_agg(distinct s order by s), '{}'::smallint[]) into v_sectors
    from unnest(coalesce(p_sector_ids, '{}'::smallint[])) s;

  perform pg_advisory_xact_lock(hashtextextended('pending_listings:opportunities:' || v_caller::text, 0));
  select o.id into v_new_id
    from public.opportunities o
   where o.posted_by = v_caller and o.status = 'pending'
     and o.position_name         is not distinct from p_position_name
     and o.company               is not distinct from p_company
     and o.pay                   is not distinct from p_pay
     and o.location_type         is not distinct from p_location_type
     and o.location_text         is not distinct from p_location_text
     and o.description           is not distinct from p_description
     and o.start_month           is not distinct from p_start_month
     and o.start_year            is not distinct from p_start_year
     and o.application_deadline  is not distinct from p_application_deadline
     and o.contact_email         is not distinct from v_email
     and o.contact_email_visible is not distinct from coalesce(p_contact_email_visible, false)
     and o.apply_method          is not distinct from p_apply_method
     and o.apply_url             is not distinct from p_apply_url
     and o.eligible_audience     is not distinct from p_eligible_audience
     and v_skills = coalesce((select array_agg(os.skill_id order by os.skill_id)
                                from public.opportunity_skills os where os.opportunity_id = o.id), '{}'::smallint[])
     and v_sectors = coalesce((select array_agg(osec.sector_id order by osec.sector_id)
                                 from public.opportunity_sectors osec where osec.opportunity_id = o.id), '{}'::smallint[])
   order by o.created_at
   limit 1;
  if found then
    return v_new_id;
  end if;

  insert into public.opportunities (
    posted_by, status,
    position_name, company, pay,
    location_type, location_text,
    description, start_month, start_year,
    application_deadline,
    contact_email, contact_email_visible,
    apply_method, apply_url,
    eligible_audience, creation_source
  ) values (
    v_caller, 'pending',
    p_position_name, p_company, p_pay,
    p_location_type, p_location_text,
    p_description, p_start_month, p_start_year,
    p_application_deadline,
    v_email, coalesce(p_contact_email_visible, false),
    p_apply_method, p_apply_url,
    p_eligible_audience, 'member'
  )
  returning id into v_new_id;

  if p_skill_ids is not null and array_length(p_skill_ids, 1) > 0 then
    insert into public.opportunity_skills (opportunity_id, skill_id)
    select v_new_id, unnest(p_skill_ids)
    on conflict do nothing;
  end if;

  if p_sector_ids is not null and array_length(p_sector_ids, 1) > 0 then
    insert into public.opportunity_sectors (opportunity_id, sector_id)
    select v_new_id, unnest(p_sector_ids)
    on conflict do nothing;
  end if;

  return v_new_id;
end;
$function$;
