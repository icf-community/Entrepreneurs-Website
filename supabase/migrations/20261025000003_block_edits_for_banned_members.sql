-- Security audit fix (2026-10-25), finding #5.
--
-- update_event/update_opportunity/update_vc_grant check ownership
-- (posted_by = caller) but never public.is_approved() — a banned member
-- (status='rejected') can still edit their own already-approved listings,
-- and ai_confirm_job_requirements can still confirm/edit AI job criteria
-- for their own open job, via ai_private.recruiter_job_ok, which checks the
-- job's own properties but never the poster's profile status either. A ban
-- is not meant to be a full cut-off (rejecting still lets a member read
-- their own existing listings), but editing them is a live, ongoing action
-- a banned member should not be able to take. ai_submit_turn already has
-- this exact guard as its first check; these four don't.

-- ─── update_event ──────────────────────────────────────────────────
-- Identical to 20261011000007's definition except for the new
-- is_approved() check right after the ownership check.
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
    raise exception 'Event must start in the future';
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

revoke all on function public.update_event(uuid, text, text, text, timestamptz, text, text, text, boolean, bigint) from public, anon, authenticated;
grant execute on function public.update_event(uuid, text, text, text, timestamptz, text, text, text, boolean, bigint) to authenticated;

-- ─── update_opportunity ────────────────────────────────────────────
-- Identical to 20261011000007's definition except for the new
-- is_approved() check right after the ownership check.
create or replace function public.update_opportunity(
  p_id uuid, p_position_name text, p_company text, p_pay text, p_location_type location_type,
  p_location_text text, p_description text, p_start_month smallint, p_start_year integer,
  p_application_deadline date, p_contact_email text, p_contact_email_visible boolean,
  p_apply_method apply_method, p_apply_url text, p_skill_ids smallint[], p_sector_ids smallint[],
  p_eligible_audience text,
  p_expected_version bigint default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
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
    from public.opportunities where id = p_id
     for update;
  if not found then
    raise exception 'Opportunity not found: %', p_id;
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

  if p_application_deadline is null or p_application_deadline < current_date then
    raise exception 'Application deadline must be today or later';
  end if;
  perform public.assert_audience(p_eligible_audience);

  -- An approved job's audience changes only through the reviewed edit,
  -- which publishes it atomically with the rest (§7.2).
  if v_status = 'approved' then
    perform public.stage_listing_edit('opportunity', p_id, jsonb_build_object(
      'position_name',         p_position_name,
      'company',               p_company,
      'pay',                   p_pay,
      'location_type',         p_location_type,
      'location_text',         p_location_text,
      'description',           p_description,
      'start_month',           p_start_month,
      'start_year',            p_start_year,
      'application_deadline',  p_application_deadline,
      'contact_email',         p_contact_email,
      'contact_email_visible', coalesce(p_contact_email_visible, false),
      'apply_method',          p_apply_method,
      'apply_url',             p_apply_url,
      'eligible_audience',     p_eligible_audience,
      'skill_ids',             to_jsonb(coalesce(p_skill_ids,  '{}'::smallint[])),
      'sector_ids',            to_jsonb(coalesce(p_sector_ids, '{}'::smallint[]))));
    return;
  end if;

  update public.opportunities
     set position_name         = p_position_name,
         company               = p_company,
         pay                   = p_pay,
         location_type         = p_location_type,
         location_text         = p_location_text,
         description           = p_description,
         start_month           = p_start_month,
         start_year            = p_start_year,
         application_deadline  = p_application_deadline,
         contact_email         = p_contact_email,
         contact_email_visible = coalesce(p_contact_email_visible, false),
         apply_method          = p_apply_method,
         apply_url             = p_apply_url,
         eligible_audience     = p_eligible_audience
   where id = p_id;

  delete from public.opportunity_skills  where opportunity_id = p_id;
  delete from public.opportunity_sectors where opportunity_id = p_id;

  if p_skill_ids is not null and array_length(p_skill_ids, 1) > 0 then
    insert into public.opportunity_skills (opportunity_id, skill_id)
    select p_id, unnest(p_skill_ids) on conflict do nothing;
  end if;

  if p_sector_ids is not null and array_length(p_sector_ids, 1) > 0 then
    insert into public.opportunity_sectors (opportunity_id, sector_id)
    select p_id, unnest(p_sector_ids) on conflict do nothing;
  end if;
end;
$function$;

revoke all on function public.update_opportunity(uuid, text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text, bigint) from public, anon, authenticated;
grant execute on function public.update_opportunity(uuid, text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text, bigint) to authenticated;

-- ─── update_vc_grant ────────────────────────────────────────────────
-- Identical to 20261011000007's definition except for the new
-- is_approved() check right after the ownership check.
create or replace function public.update_vc_grant(
  p_id          uuid,
  p_kind        vc_grant_kind,
  p_name        text,
  p_description text,
  p_link        text,
  p_amount      text,
  p_deadline    date,
  p_stage       text,
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
    from public.vcs_grants where id = p_id
     for update;
  if not found then
    raise exception 'Listing not found, or it has been removed.' using errcode = '42501';
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

  if v_status = 'approved' then
    perform public.stage_listing_edit('vc_grant', p_id, jsonb_build_object(
      'kind',        p_kind,
      'name',        p_name,
      'description', p_description,
      'link',        p_link,
      'amount',      p_amount,
      'deadline',    p_deadline,
      'stage',       p_stage));
    return;
  end if;

  -- No deadline guard here on purpose: a VC/grant deadline is optional
  -- and a rolling-application listing legitimately has none.
  update public.vcs_grants
     set kind        = p_kind,
         name        = p_name,
         description = p_description,
         link        = p_link,
         amount      = p_amount,
         deadline    = p_deadline,
         stage       = p_stage
   where id = p_id;
end;
$$;

revoke all on function public.update_vc_grant(uuid, vc_grant_kind, text, text, text, text, date, text, bigint) from public, anon, authenticated;
grant execute on function public.update_vc_grant(uuid, vc_grant_kind, text, text, text, text, date, text, bigint) to authenticated;

-- ─── ai_confirm_job_requirements ───────────────────────────────────
-- Identical to 20261011000003's definition except for the new
-- is_approved() check, cheap and first, before the job-eligibility check.
create or replace function public.ai_confirm_job_requirements(p_opportunity uuid, p_atoms jsonb, p_expected_version int default null)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_req  ai_private.job_requirements;
  v_ver  int;
  v_ops  jsonb := '[]'::jsonb;
  a      jsonb;
  v_spec jsonb;
begin
  if not public.is_approved() then
    raise exception 'Account is not in good standing' using errcode = '42501';
  end if;
  if not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
    raise exception 'job_not_eligible' using errcode = '42501';
  end if;
  -- for share: the job cannot change under the confirmation (R9).
  select content_version into v_ver from public.opportunities where id = p_opportunity for share;
  select * into v_req from ai_private.job_requirements where opportunity_id = p_opportunity for update;
  -- The poster confirms what they were shown. If the job changed since
  -- (an approved edit) or its requirements were parsed from an older
  -- version, confirming would stamp outdated criteria as current.
  if (p_expected_version is not null and p_expected_version <> v_ver)
     or (v_req.opportunity_id is not null and v_req.content_version <> v_ver
         and exists (select 1 from jsonb_array_elements(p_atoms) x_atom where x_atom ? 'id')) then
    raise exception 'requirements_outdated' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_atoms) <> 'array' or jsonb_array_length(p_atoms) > 12 then
    raise exception 'invalid_requirements' using errcode = '22023';
  end if;

  -- Each confirmed atom is either a parsed one (by id, free text kept as
  -- the job states it) or a dictionary concept.
  for a in select * from jsonb_array_elements(p_atoms) loop
    if a ? 'id' then
      select x || jsonb_build_object('required', coalesce((a->>'required')::boolean, (x->>'required')::boolean, false))
        into a
        from jsonb_array_elements(coalesce(v_req.parsed, '[]'::jsonb)) x where x->>'id' = a->>'id';
      if a is null then
        raise exception 'invalid_requirements' using errcode = '22023';
      end if;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'add', 'kind', a->>'kind', 'concept', a->>'concept',
                                                             'free_text', a->>'free_text', 'required', a->'required',
                                                             'group', a->>'group'));
    else
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'add', 'kind', coalesce(a->>'kind', 'tool'),
                                                             'concept', a->>'concept', 'required', a->'required'));
    end if;
  end loop;

  v_spec := ai_private.apply_spec_ops(null, v_ops, 'recruiter', null, null, null, true);
  -- Job criteria are not chat memory: they follow the job, not the
  -- seven-day chat lifetime.
  v_spec := jsonb_set(v_spec, '{atoms}', coalesce((
    select jsonb_agg(x || jsonb_build_object('source', jsonb_build_object('type', 'job', 'content_version', v_ver)))
      from jsonb_array_elements(v_spec->'atoms') x), '[]'::jsonb));

  insert into ai_private.job_requirements (opportunity_id, content_version, status, confirmed, confirmed_by, confirmed_at)
  values (p_opportunity, v_ver, 'confirmed', v_spec->'atoms', v_uid, now())
  on conflict (opportunity_id) do update
     set content_version = v_ver, status = 'confirmed', confirmed = v_spec->'atoms',
         confirmed_by = v_uid, confirmed_at = now(), updated_at = now();
end;
$$;

revoke all on function public.ai_confirm_job_requirements(uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.ai_confirm_job_requirements(uuid, jsonb, int) to authenticated;
