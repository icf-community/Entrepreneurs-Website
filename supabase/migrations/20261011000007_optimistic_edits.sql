-- Optimistic edits: compare under the row lock, before any content or junction write.
-- A separate counter deliberately ignores media uploads and analytics updates.

create function public.tg_edit_version() returns trigger
language plpgsql set search_path = public as $$
declare changed boolean := false; k text;
begin
  if current_user in ('authenticated', 'anon') and new.edit_version <> old.edit_version then
    raise exception 'Edit revision cannot be assigned' using errcode = '42501';
  end if;
  foreach k in array tg_argv loop
    changed := changed or (to_jsonb(new)->k is distinct from to_jsonb(old)->k);
  end loop;
  new.edit_version := old.edit_version + case when changed or new.edit_version > old.edit_version then 1 else 0 end;
  return new;
end; $$;
revoke all on function public.tg_edit_version() from public, anon, authenticated;

alter table public.profiles add column edit_version bigint not null default 0 check (edit_version >= 0);
create trigger edit_version before update on public.profiles for each row execute function public.tg_edit_version('first_name', 'surname', 'course', 'grad_year', 'linkedin_url', 'github_url', 'portfolio_url', 'preferred_name', 'bio_focus', 'bio_hobbies', 'current_focus', 'venture_stage', 'venture_name', 'venture_url', 'venture_one_liner', 'recruiting_status', 'intent_urgency', 'availability_hours', 'role');

alter table public.events add column edit_version bigint not null default 0 check (edit_version >= 0);
create trigger edit_version before update on public.events for each row execute function public.tg_edit_version('title', 'description', 'luma_link', 'event_at', 'location', 'organiser_name', 'contact_email', 'contact_email_visible');

alter table public.opportunities add column edit_version bigint not null default 0 check (edit_version >= 0);
create trigger edit_version before update on public.opportunities for each row execute function public.tg_edit_version('position_name', 'company', 'pay', 'location_type', 'location_text', 'description', 'start_month', 'start_year', 'application_deadline', 'contact_email', 'contact_email_visible', 'apply_method', 'apply_url', 'eligible_audience');

alter table public.vcs_grants add column edit_version bigint not null default 0 check (edit_version >= 0);
create trigger edit_version before update on public.vcs_grants for each row execute function public.tg_edit_version('kind', 'name', 'description', 'link', 'amount', 'deadline', 'stage');

-- Related rows participate in the same transaction and revision as their owner.
create function public.tg_related_edit_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if tg_table_name = 'listing_edits' then
    if r->>'listing_kind' = 'event' then
      update public.events set edit_version = edit_version + 1 where id = (r->>'listing_id')::uuid;
    elsif r->>'listing_kind' = 'opportunity' then
      update public.opportunities set edit_version = edit_version + 1 where id = (r->>'listing_id')::uuid;
    else
      update public.vcs_grants set edit_version = edit_version + 1 where id = (r->>'listing_id')::uuid;
    end if;
  elsif tg_table_name like 'profile_%' then
    update public.profiles set edit_version = edit_version + 1 where id = (r->>'profile_id')::uuid;
  else
    update public.opportunities set edit_version = edit_version + 1 where id = (r->>'opportunity_id')::uuid;
  end if;
  return null;
end; $$;
revoke all on function public.tg_related_edit_version() from public, anon, authenticated;

create trigger related_edit_version after insert or update or delete on public.profile_skills for each row execute function public.tg_related_edit_version();

create trigger related_edit_version after insert or update or delete on public.profile_sectors for each row execute function public.tg_related_edit_version();

create trigger related_edit_version after insert or update or delete on public.profile_interests for each row execute function public.tg_related_edit_version();

create trigger related_edit_version after insert or update or delete on public.profile_intents for each row execute function public.tg_related_edit_version();

create trigger related_edit_version after insert or update or delete on public.opportunity_skills for each row execute function public.tg_related_edit_version();

create trigger related_edit_version after insert or update or delete on public.opportunity_sectors for each row execute function public.tg_related_edit_version();

create trigger related_edit_version after insert or update or delete on public.listing_edits for each row execute function public.tg_related_edit_version();

drop function public.update_profile(text, text, text, int, text, text, text, text, text, text, text, text, text, text, text, text, text, text, smallint[], smallint[], smallint[], text[], text[], text[]);

create function public.update_profile(
  p_first_name         text,
  p_surname            text,
  p_course             text,
  p_grad_year          int,
  p_linkedin_url       text,
  p_github_url         text,
  p_portfolio_url      text,
  p_preferred_name     text default null,
  p_bio_focus          text default null,
  p_bio_hobbies        text default null,
  p_current_focus      text default null,
  p_venture_stage      text default null,
  p_venture_name       text default null,
  p_venture_url        text default null,
  p_venture_one_liner  text default null,
  p_recruiting_status  text default null,
  p_intent_urgency     text default null,
  p_availability_hours text default null,
  p_skill_ids          smallint[] default '{}',
  p_core_skill_ids     smallint[] default '{}',
  p_sector_ids         smallint[] default '{}',
  p_academic_interests text[] default '{}',
  p_hobbies            text[] default '{}',
  p_intents            text[] default '{}',
  p_expected_version bigint default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edit_version bigint;
  v_caller       uuid := auth.uid();
  v_role         user_role;
  v_status       user_status;
  v_current_year int := extract(year from now())::int;
  v_first        text;
  v_last         text;
  v_course       text;
  v_linkedin     text;
  v_github       text;
  v_portfolio    text;
  v_needs_year   boolean;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select role, status, edit_version into v_role, v_status, v_edit_version from public.profiles where id = v_caller for update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if v_status <> 'approved' then
    raise exception 'Your membership must be approved before you can edit your profile'
      using errcode = '42501';
  end if;

  if p_expected_version is null or p_expected_version <> v_edit_version then
    raise exception 'This changed in another tab — reload before saving.' using errcode = 'PT409';
  end if;

  v_first     := nullif(trim(coalesce(p_first_name,    '')), '');
  v_last      := nullif(trim(coalesce(p_surname,       '')), '');
  v_course    := nullif(trim(coalesce(p_course,        '')), '');
  v_linkedin  := nullif(trim(coalesce(p_linkedin_url,  '')), '');
  v_github    := nullif(trim(coalesce(p_github_url,    '')), '');
  v_portfolio := nullif(trim(coalesce(p_portfolio_url, '')), '');

  if v_first    is null then raise exception 'First name is required';      end if;
  if v_last     is null then raise exception 'Surname is required';         end if;
  if v_course   is null then raise exception 'Course is required';          end if;
  if length(v_first) > 50 or length(v_last) > 50 then
    raise exception 'First name and surname must be 50 characters or fewer';
  end if;
  if v_first ~ '[0-9@£$%^&*()+=/{}<>!?#~_;:",|]'
     or v_last ~ '[0-9@£$%^&*()+=/{}<>!?#~_;:",|]' then
    raise exception 'First name and surname can only contain letters, spaces, hyphens, apostrophes and periods';
  end if;

  v_needs_year := v_role in ('student', 'recent_grad', 'alum');

  if v_needs_year and p_grad_year is null then
    raise exception 'Graduation year is required';
  end if;
  if v_role = 'student' and p_grad_year < v_current_year + 1 then
    raise exception 'Students must set an expected graduation year of % or later', v_current_year + 1
      using errcode = '22023';
  end if;
  if v_role in ('recent_grad', 'alum') and p_grad_year > v_current_year then
    raise exception 'Graduation year cannot be in the future once you have graduated'
      using errcode = '22023';
  end if;
  if v_role <> 'student' and v_linkedin is null then
    raise exception 'A LinkedIn URL is required for accounts without an Imperial email address';
  end if;

  update public.profiles
     set edit_version  = edit_version + 1,
         first_name    = v_first,
         surname       = v_last,
         course        = v_course,
         grad_year     = case when v_needs_year then p_grad_year else null end,
         linkedin_url  = v_linkedin,
         github_url    = v_github,
         portfolio_url = v_portfolio
   where id = v_caller;

  perform public._apply_intake_fields(
    v_caller, p_preferred_name, p_bio_focus, p_bio_hobbies, p_current_focus,
    p_venture_stage, p_venture_name, p_venture_url, p_venture_one_liner,
    p_recruiting_status, p_intent_urgency, p_availability_hours,
    p_skill_ids, p_core_skill_ids, p_sector_ids,
    p_academic_interests, p_hobbies, p_intents
  );
  return (select edit_version from public.profiles where id = v_caller);
end;
$$;

revoke all on function public.update_profile(text, text, text, int, text, text, text, text, text, text, text, text, text, text, text, text, text, text, smallint[], smallint[], smallint[], text[], text[], text[], bigint) from public, anon, authenticated;
grant execute on function public.update_profile(text, text, text, int, text, text, text, text, text, text, text, text, text, text, text, text, text, text, smallint[], smallint[], smallint[], text[], text[], text[], bigint) to authenticated;

drop function public.update_event(uuid, text, text, text, timestamptz, text, text, text, boolean);

create function public.update_event(
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

drop function public.update_opportunity(uuid, text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text);

create function public.update_opportunity(
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

drop function public.update_vc_grant(uuid, vc_grant_kind, text, text, text, text, date, text);

create function public.update_vc_grant(
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

-- STABLE gives the profile, junctions and revision one database snapshot.
create function public.get_my_profile_edit() returns jsonb
language sql stable security definer set search_path = public as $$
 select jsonb_build_object('profile', to_jsonb(p), 'selected', jsonb_build_object(
   'skillIds', coalesce((select jsonb_agg(skill_id order by skill_id) from profile_skills where profile_id=p.id), '[]'),
   'coreSkillIds', coalesce((select jsonb_agg(skill_id order by skill_id) from profile_skills where profile_id=p.id and is_core), '[]'),
   'sectorIds', coalesce((select jsonb_agg(sector_id order by sector_id) from profile_sectors where profile_id=p.id), '[]'),
   'academicInterests', coalesce((select jsonb_agg(label order by label) from profile_interests where profile_id=p.id and kind='academic'), '[]'),
   'hobbies', coalesce((select jsonb_agg(label order by label) from profile_interests where profile_id=p.id and kind='hobby'), '[]'),
   'intents', coalesce((select jsonb_agg(intent order by rank) from profile_intents where profile_id=p.id), '[]')))
 from profiles p where p.id=auth.uid();
$$;
revoke all on function public.get_my_profile_edit() from public, anon, authenticated;
grant execute on function public.get_my_profile_edit() to authenticated;

create function public.get_my_listing_edit(p_kind listing_event_kind, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; proposal jsonb;
begin
  if p_kind='event' then select to_jsonb(e) into r from events e where id=p_id and posted_by=auth.uid();
  elsif p_kind='opportunity' then select to_jsonb(o) into r from opportunities o where id=p_id and posted_by=auth.uid();
  else select to_jsonb(v) into r from vcs_grants v where id=p_id and posted_by=auth.uid(); end if;
  if r is null then return null; end if;
  select jsonb_build_object('id',id,'proposed',proposed,'createdAt',created_at) into proposal
    from listing_edits where listing_kind=p_kind and listing_id=p_id and status='pending';
  return jsonb_build_object('row', r || public.listing_snapshot(p_kind,p_id), 'revision', proposal);
end; $$;
revoke all on function public.get_my_listing_edit(listing_event_kind,uuid) from public, anon, authenticated;
grant execute on function public.get_my_listing_edit(listing_event_kind,uuid) to authenticated;
create or replace function public.admin_apply_listing_edit(p_edit_id uuid)
returns table (email text, first_name text, title text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller  uuid := auth.uid();
  v_kind    public.listing_event_kind;
  v_listing uuid;
  v_payload jsonb;
  v_owner   uuid;
  v_status  listing_status;
  v_before  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  -- for update: two admins clicking Approve on the same revision must
  -- not both apply it.
  select e.listing_kind, e.listing_id into v_kind, v_listing
    from public.listing_edits e where e.id=p_edit_id;
  if v_kind='event' then perform 1 from public.events where id=v_listing for update;
  elsif v_kind='opportunity' then perform 1 from public.opportunities where id=v_listing for update;
  elsif v_kind='vc_grant' then perform 1 from public.vcs_grants where id=v_listing for update;
  end if;

  select e.listing_kind, e.listing_id, e.proposed
    into v_kind, v_listing, v_payload
    from public.listing_edits e
   where e.id = p_edit_id and e.status = 'pending'
     for update;
  if not found then
    raise exception 'That revision has already been reviewed.' using errcode = '42501';
  end if;

  if    v_kind = 'event'       then select t.posted_by, t.status into v_owner, v_status from public.events        t where t.id = v_listing;
  elsif v_kind = 'vc_grant'    then select t.posted_by, t.status into v_owner, v_status from public.vcs_grants    t where t.id = v_listing;
  elsif v_kind = 'opportunity' then select t.posted_by, t.status into v_owner, v_status from public.opportunities t where t.id = v_listing;
  end if;

  -- The listing stopped being published between proposal and review
  -- (expired, or rejected out from under it). Refuse rather than
  -- republish stale content onto a row nobody expects to change.
  --
  -- No discard is written here on purpose: RAISE aborts the transaction,
  -- so any UPDATE in this branch would be rolled back with it. The
  -- unpublish trigger below has already marked the revision discarded —
  -- this branch only catches a row that somehow escaped it.
  if v_status is distinct from 'approved' then
    raise exception 'That listing is no longer published, so the revision cannot be applied.'
      using errcode = '42501';
  end if;

  v_before := public.listing_snapshot(v_kind, v_listing);
  perform public.apply_listing_edit_payload(v_kind, v_listing, v_payload);

  update public.listing_edits
     set status = 'applied', previous = v_before, reviewed_at = now(), reviewed_by = v_caller
   where id = p_edit_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'apply_listing_edit', public.listing_table_name(v_kind), v_listing, p_edit_id::text);

  return query
    select au.email::text,
           p.first_name,
           coalesce(v_before->>'title', v_before->>'name', v_before->>'position_name')::text
      from public.profiles p
      join auth.users au on au.id = p.id
     where p.id = v_owner;
end;
$$;
create or replace function public.admin_reject_listing_edit(
  p_edit_id uuid,
  p_reason  text
)
returns table (email text, first_name text, title text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller  uuid := auth.uid();
  v_kind    public.listing_event_kind;
  v_listing uuid;
  v_owner   uuid;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Rejection reason is required';
  end if;

  select e.listing_kind, e.listing_id into v_kind, v_listing
    from public.listing_edits e where e.id=p_edit_id;
  if v_kind='event' then perform 1 from public.events where id=v_listing for update;
  elsif v_kind='opportunity' then perform 1 from public.opportunities where id=v_listing for update;
  elsif v_kind='vc_grant' then perform 1 from public.vcs_grants where id=v_listing for update;
  end if;

  select e.listing_kind, e.listing_id into v_kind, v_listing
    from public.listing_edits e
   where e.id = p_edit_id and e.status = 'pending'
     for update;
  if not found then
    raise exception 'That revision has already been reviewed.' using errcode = '42501';
  end if;

  update public.listing_edits
     set status = 'rejected', reject_reason = p_reason,
         reviewed_at = now(), reviewed_by = v_caller
   where id = p_edit_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'reject_listing_edit', public.listing_table_name(v_kind), v_listing, p_reason);

  if    v_kind = 'event'       then select t.posted_by into v_owner from public.events        t where t.id = v_listing;
  elsif v_kind = 'vc_grant'    then select t.posted_by into v_owner from public.vcs_grants    t where t.id = v_listing;
  elsif v_kind = 'opportunity' then select t.posted_by into v_owner from public.opportunities t where t.id = v_listing;
  end if;

  return query
    select au.email::text,
           p.first_name,
           coalesce(public.listing_snapshot(v_kind, v_listing)->>'title',
                    public.listing_snapshot(v_kind, v_listing)->>'name',
                    public.listing_snapshot(v_kind, v_listing)->>'position_name')::text
      from public.profiles p
      join auth.users au on au.id = p.id
     where p.id = v_owner;
end;
$$;
notify pgrst, 'reload schema';
