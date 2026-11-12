-- ════════════════════════════════════════════════════════════════════
-- Foundry · Education status and job audiences (AI-plan §7.2, F18, F21, F29)
--
-- Jobs are for Students, Graduates or Both. Audience comes from a
-- member's own education status, not their directory role: faculty,
-- mentors and angels say nothing about whether someone has graduated.
--
--   member_education      self-declared, nullable facts. Unknown admits
--                         to no audience (owner: enforce immediately, F29;
--                         the jobs page asks for it instead of going blank).
--   opportunities         eligible_audience (null = needs review),
--                         audience_version, content_version (bumped by a
--                         trigger on every path that changes the row), and
--                         creation_source: jobs made by
--                         admin_create_opportunity never unlock recruiter
--                         mode (F18), backfilled from admin_actions.
--
-- Every read of an approved job now applies the audience: the table's RLS,
-- every SECURITY DEFINER list/detail/bookmark/activity/feed function, and
-- the bookmark/apply/view writes. Owners and admins keep management
-- visibility; that is not Apply access for anyone else.
--
-- F21: functions whose argument list or return table changes are DROPPED
-- first (create or replace would leave a dead overload or fail on the
-- return type), recreated from the latest live definition, and re-granted.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. Education facts ─────────────────────────────────────────────
create table public.member_education (
  member_id             uuid primary key references public.profiles(id) on delete cascade,
  currently_enrolled    boolean,
  has_completed_degree  boolean,
  source                text not null default 'self_declared' check (source in ('self_declared')),
  confirmed_at          timestamptz not null default now(),
  version               int not null default 1
);
alter table public.member_education enable row level security;
revoke all on public.member_education from anon, authenticated;

create or replace function public.get_my_education()
returns table (currently_enrolled boolean, has_completed_degree boolean, confirmed_at timestamptz, known boolean)
language sql
stable
security definer
set search_path = public
as $$
  select e.currently_enrolled, e.has_completed_degree, e.confirmed_at, e.member_id is not null
    from (select 1) one
    left join public.member_education e on e.member_id = (select auth.uid());
$$;

create or replace function public.set_my_education(p_currently_enrolled boolean, p_has_completed_degree boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Finish setting up your profile first.' using errcode = '42501';
  end if;
  -- Both questions are yes/no for the member themselves; a half-answered
  -- form would leave the audience predicate guessing.
  if p_currently_enrolled is null or p_has_completed_degree is null then
    raise exception 'Answer both questions.' using errcode = '22023';
  end if;

  insert into public.member_education (member_id, currently_enrolled, has_completed_degree)
  values (v_uid, p_currently_enrolled, p_has_completed_degree)
  on conflict (member_id) do update
     set currently_enrolled   = excluded.currently_enrolled,
         has_completed_degree = excluded.has_completed_degree,
         confirmed_at         = now(),
         version              = public.member_education.version + 1;
end;
$$;

revoke all on function public.get_my_education() from public, anon, authenticated;
revoke all on function public.set_my_education(boolean, boolean) from public, anon, authenticated;
grant execute on function public.get_my_education() to authenticated;
grant execute on function public.set_my_education(boolean, boolean) to authenticated;

-- The one applicant predicate (§7.2). Internal: called by definer
-- functions with an explicit member id.
create or replace function public.member_admits_audience(p_member uuid, p_audience text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_audience
           when 'students'  then coalesce(e.currently_enrolled, false)
           when 'graduates' then coalesce(e.has_completed_degree, false)
           when 'both'      then coalesce(e.currently_enrolled, false) or coalesce(e.has_completed_degree, false)
           else false
         end
    from (select 1) one
    left join public.member_education e on e.member_id = p_member;
$$;

-- For RLS policies: the signed-in viewer.
create or replace function public.viewer_admits_audience(p_audience text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.member_admits_audience((select auth.uid()), p_audience);
$$;

revoke all on function public.member_admits_audience(uuid, text) from public, anon, authenticated;
revoke all on function public.viewer_admits_audience(text) from public, anon, authenticated;
grant execute on function public.viewer_admits_audience(text) to authenticated;


-- ─── 2. Job audience, versions and creation source ──────────────────
alter table public.opportunities
  add column eligible_audience text
    constraint opportunities_eligible_audience_valid check (eligible_audience in ('students', 'graduates', 'both')),
  add column audience_version int not null default 1,
  add column content_version  int not null default 1,
  add column creation_source  text not null default 'member'
    constraint opportunities_creation_source_valid check (creation_source in ('member', 'admin'));

-- Every admin-created job was logged by admin_create_opportunity.
update public.opportunities o
   set creation_source = 'admin'
 where exists (select 1 from public.admin_actions a
                where a.action = 'admin_create_opportunity' and a.target_id = o.id);

-- One trigger, so every path (member edit, staged edit applied by an
-- admin, admin_update_listing, a direct table update) bumps the versions
-- the AI caches and turns key on. creation_source never changes after
-- insert.
create or replace function public.tg_opportunity_versions()
returns trigger
language plpgsql
as $$
begin
  new.creation_source := old.creation_source;
  if new.eligible_audience is distinct from old.eligible_audience then
    new.audience_version := old.audience_version + 1;
  end if;
  if (new.position_name, new.company, new.pay, new.location_type, new.location_text,
      new.description, new.start_month, new.start_year)
     is distinct from
     (old.position_name, old.company, old.pay, old.location_type, old.location_text,
      old.description, old.start_month, old.start_year) then
    new.content_version := old.content_version + 1;
  end if;
  return new;
end;
$$;

create trigger opportunities_versions
  before update on public.opportunities
  for each row execute function public.tg_opportunity_versions();
revoke all on function public.tg_opportunity_versions() from public, anon, authenticated;

create index opportunities_needs_audience_idx on public.opportunities (created_at)
  where status = 'approved' and eligible_audience is null;


-- ─── 3. Table-level reads ───────────────────────────────────────────
drop policy if exists "opportunities_select_approved" on public.opportunities;
create policy "opportunities_select_approved" on public.opportunities
  for select to authenticated
  using (status = 'approved' and public.is_approved() and public.viewer_admits_audience(eligible_audience));

drop policy if exists "opportunity_skills_select" on public.opportunity_skills;
create policy "opportunity_skills_select" on public.opportunity_skills
  for select to authenticated
  using (exists (
    select 1 from public.opportunities o
     where o.id = opportunity_skills.opportunity_id
       and ((o.status = 'approved' and public.is_approved() and public.viewer_admits_audience(o.eligible_audience))
            or o.posted_by = (select auth.uid()) or public.is_admin())));

drop policy if exists "opportunity_sectors_select" on public.opportunity_sectors;
create policy "opportunity_sectors_select" on public.opportunity_sectors
  for select to authenticated
  using (exists (
    select 1 from public.opportunities o
     where o.id = opportunity_sectors.opportunity_id
       and ((o.status = 'approved' and public.is_approved() and public.viewer_admits_audience(o.eligible_audience))
            or o.posted_by = (select auth.uid()) or public.is_admin())));


-- ─── 4. Writes: submit, admin create, update (audience required) ────
drop function if exists public.submit_opportunity(text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[]);
drop function if exists public.admin_create_opportunity(text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[]);
drop function if exists public.update_opportunity(uuid, text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[]);

create or replace function public.assert_audience(p_audience text)
returns void
language plpgsql
immutable
as $$
begin
  if p_audience is null or p_audience not in ('students', 'graduates', 'both') then
    raise exception 'Choose who this job is for: students, graduates or both.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.assert_audience(text) from public, anon, authenticated;

create function public.submit_opportunity(
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

create function public.admin_create_opportunity(
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
  if p_application_deadline is null or p_application_deadline < current_date then
    raise exception 'Application deadline must be today or later';
  end if;
  perform public.assert_audience(p_eligible_audience);

  v_email := nullif(trim(coalesce(p_contact_email, '')), '');
  if v_email is null then
    select email into v_email from auth.users where id = v_caller;
  end if;

  insert into public.opportunities (
    posted_by, status,
    position_name, company, pay,
    location_type, location_text,
    description, start_month, start_year,
    application_deadline,
    contact_email, contact_email_visible,
    apply_method, apply_url,
    approved_at, approved_by,
    eligible_audience, creation_source
  ) values (
    v_caller, 'approved',
    p_position_name, p_company, p_pay,
    p_location_type, p_location_text,
    p_description, p_start_month, p_start_year,
    p_application_deadline,
    v_email, coalesce(p_contact_email_visible, false),
    p_apply_method, p_apply_url,
    now(), v_caller,
    p_eligible_audience, 'admin'
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

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'admin_create_opportunity', 'opportunities', v_new_id, null);

  return v_new_id;
end;
$function$;

create function public.update_opportunity(
  p_id uuid, p_position_name text, p_company text, p_pay text, p_location_type location_type,
  p_location_text text, p_description text, p_start_month smallint, p_start_year integer,
  p_application_deadline date, p_contact_email text, p_contact_email_visible boolean,
  p_apply_method apply_method, p_apply_url text, p_skill_ids smallint[], p_sector_ids smallint[],
  p_eligible_audience text)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_status listing_status;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select posted_by, status into v_owner, v_status
    from public.opportunities where id = p_id;
  if not found then
    raise exception 'Opportunity not found: %', p_id;
  end if;
  if v_owner <> v_caller then
    raise exception 'You can only edit your own listings' using errcode = '42501';
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

revoke all on function public.submit_opportunity(text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text) from public, anon, authenticated;
revoke all on function public.admin_create_opportunity(text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text) from public, anon, authenticated;
revoke all on function public.update_opportunity(uuid, text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text) from public, anon, authenticated;
grant execute on function public.submit_opportunity(text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text) to authenticated;
grant execute on function public.admin_create_opportunity(text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text) to authenticated;
grant execute on function public.update_opportunity(uuid, text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text) to authenticated;


-- ─── 5. Edit flow: snapshot and apply carry the audience ────────────
create or replace function public.listing_snapshot(p_kind listing_event_kind, p_listing_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if p_kind = 'event' then
    select jsonb_build_object(
             'title', e.title,
             'description', e.description,
             'luma_link', e.luma_link,
             'event_at', e.event_at,
             'location', e.location,
             'organiser_name', e.organiser_name,
             'contact_email', e.contact_email,
             'contact_email_visible', e.contact_email_visible)
      into v from public.events e where e.id = p_listing_id;

  elsif p_kind = 'vc_grant' then
    select jsonb_build_object(
             'kind', g.kind,
             'name', g.name,
             'description', g.description,
             'link', g.link,
             'amount', g.amount,
             'deadline', g.deadline,
             'stage', g.stage)
      into v from public.vcs_grants g where g.id = p_listing_id;

  elsif p_kind = 'opportunity' then
    select jsonb_build_object(
             'position_name', o.position_name,
             'company', o.company,
             'pay', o.pay,
             'location_type', o.location_type,
             'location_text', o.location_text,
             'description', o.description,
             'start_month', o.start_month,
             'start_year', o.start_year,
             'application_deadline', o.application_deadline,
             'contact_email', o.contact_email,
             'contact_email_visible', o.contact_email_visible,
             'apply_method', o.apply_method,
             'apply_url', o.apply_url,
             'eligible_audience', o.eligible_audience,
             'skill_ids', coalesce((select jsonb_agg(s.skill_id order by s.skill_id)
                                      from public.opportunity_skills s
                                     where s.opportunity_id = o.id), '[]'::jsonb),
             'sector_ids', coalesce((select jsonb_agg(x.sector_id order by x.sector_id)
                                       from public.opportunity_sectors x
                                      where x.opportunity_id = o.id), '[]'::jsonb))
      into v from public.opportunities o where o.id = p_listing_id;
  end if;

  return v;
end;
$function$;

create or replace function public.apply_listing_edit_payload(p_kind listing_event_kind, p_listing_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_kind = 'event' then
    update public.events
       set title                 = p_payload->>'title',
           description           = p_payload->>'description',
           luma_link             = p_payload->>'luma_link',
           event_at              = (p_payload->>'event_at')::timestamptz,
           location              = p_payload->>'location',
           organiser_name        = p_payload->>'organiser_name',
           contact_email         = p_payload->>'contact_email',
           contact_email_visible = coalesce((p_payload->>'contact_email_visible')::boolean, false)
     where id = p_listing_id;

  elsif p_kind = 'vc_grant' then
    update public.vcs_grants
       set kind        = (p_payload->>'kind')::public.vc_grant_kind,
           name        = p_payload->>'name',
           description = p_payload->>'description',
           link        = p_payload->>'link',
           amount      = p_payload->>'amount',
           deadline    = (p_payload->>'deadline')::date,
           stage       = p_payload->>'stage'
     where id = p_listing_id;

  elsif p_kind = 'opportunity' then
    update public.opportunities
       set position_name         = p_payload->>'position_name',
           company               = p_payload->>'company',
           pay                   = p_payload->>'pay',
           location_type         = (p_payload->>'location_type')::public.location_type,
           location_text         = p_payload->>'location_text',
           description           = p_payload->>'description',
           start_month           = (p_payload->>'start_month')::smallint,
           start_year            = (p_payload->>'start_year')::int,
           application_deadline  = (p_payload->>'application_deadline')::date,
           contact_email         = p_payload->>'contact_email',
           contact_email_visible = coalesce((p_payload->>'contact_email_visible')::boolean, false),
           apply_method          = (p_payload->>'apply_method')::public.apply_method,
           apply_url             = p_payload->>'apply_url',
           -- An edit staged before audiences existed carries no key and
           -- leaves the audience as it is.
           eligible_audience     = case when p_payload ? 'eligible_audience'
                                        then p_payload->>'eligible_audience'
                                        else eligible_audience end
     where id = p_listing_id;

    -- Same resync update_opportunity does, so the junction tables can
    -- never drift from the parent row.
    delete from public.opportunity_skills  where opportunity_id = p_listing_id;
    delete from public.opportunity_sectors where opportunity_id = p_listing_id;

    insert into public.opportunity_skills (opportunity_id, skill_id)
    select p_listing_id, value::smallint
      from jsonb_array_elements_text(coalesce(p_payload->'skill_ids', '[]'::jsonb))
    on conflict do nothing;

    insert into public.opportunity_sectors (opportunity_id, sector_id)
    select p_listing_id, value::smallint
      from jsonb_array_elements_text(coalesce(p_payload->'sector_ids', '[]'::jsonb))
    on conflict do nothing;
  end if;
end;
$function$;

revoke all on function public.listing_snapshot(listing_event_kind, uuid) from public, anon, authenticated;
revoke all on function public.apply_listing_edit_payload(listing_event_kind, uuid, jsonb) from public, anon, authenticated;

drop function if exists public.get_opportunity_for_edit(uuid);
create function public.get_opportunity_for_edit(p_id uuid)
returns table(id uuid, position_name text, company text, pay text, location_type location_type,
              location_text text, description text, start_month smallint, start_year integer,
              application_deadline date, contact_email text, contact_email_visible boolean,
              apply_method apply_method, apply_url text, status listing_status, posted_by uuid,
              eligible_audience text)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select
    o.id, o.position_name, o.company, o.pay,
    o.location_type, o.location_text,
    o.description, o.start_month, o.start_year,
    o.application_deadline,
    o.contact_email, o.contact_email_visible,
    o.apply_method, o.apply_url,
    o.status, o.posted_by,
    o.eligible_audience
  from public.opportunities o
  where o.id = p_id
    and o.posted_by = (select auth.uid());
$function$;
revoke all on function public.get_opportunity_for_edit(uuid) from public, anon, authenticated;
grant execute on function public.get_opportunity_for_edit(uuid) to authenticated;


-- ─── 6. Reads: list, detail, newest, bookmarks ──────────────────────
drop function if exists public.list_approved_opportunities();
create function public.list_approved_opportunities()
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
       and (v.admin or o.posted_by = v.uid or public.member_admits_audience(v.uid, o.eligible_audience))
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
revoke all on function public.list_approved_opportunities() from public, anon, authenticated;
grant execute on function public.list_approved_opportunities() to authenticated;

-- An ID-specific detail read (§7.2 step 3), replacing list-and-find over
-- a list capped at 1,000.
create or replace function public.get_approved_opportunity(p_id uuid)
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
    coalesce((select array_agg(s.name order by s.name)
                from public.opportunity_skills os join public.skills s on s.id = os.skill_id
               where os.opportunity_id = o.id), ARRAY[]::text[]),
    coalesce((select array_agg(s.name order by s.name)
                from public.opportunity_sectors os join public.sectors s on s.id = os.sector_id
               where os.opportunity_id = o.id), ARRAY[]::text[]),
    o.eligible_audience,
    p.avatar_path
  from public.opportunities o
  cross join viewer v
  left join public.profiles p on p.id = o.posted_by
  where o.id = p_id
    and o.status = 'approved'
    and o.application_deadline >= current_date
    and (public.is_approved() or v.admin)
    and (v.admin or o.posted_by = v.uid or public.member_admits_audience(v.uid, o.eligible_audience));
$function$;
revoke all on function public.get_approved_opportunity(uuid) from public, anon, authenticated;
grant execute on function public.get_approved_opportunity(uuid) to authenticated;

create or replace function public.list_newest_opportunities(p_limit integer default 3)
returns table(id uuid, position_name text, company text, location_type location_type,
              location_text text, created_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select o.id, o.position_name, o.company, o.location_type, o.location_text, o.created_at
    from public.opportunities o
   where o.status = 'approved'
     and o.application_deadline >= current_date
     and (public.is_approved() or public.is_admin())
     and (public.is_admin() or o.posted_by = (select auth.uid())
          or public.member_admits_audience((select auth.uid()), o.eligible_audience))
   order by o.created_at desc, o.application_deadline asc, o.id
   limit greatest(1, least(coalesce(p_limit, 3), 20));
$function$;

drop function if exists public.list_my_bookmarked_opportunities();
create function public.list_my_bookmarked_opportunities()
returns table(id uuid, position_name text, company text, pay text, location_type location_type,
              location_text text, description text, start_month smallint, start_year integer,
              application_deadline date, contact_email text, contact_email_visible boolean,
              apply_method apply_method, apply_url text, posted_by uuid,
              created_at timestamp with time zone, poster_first_name text, poster_surname text,
              poster_linkedin_url text, skill_names text[], sector_names text[],
              bookmarked_at timestamp with time zone, eligible_audience text, poster_avatar_path text)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select
    o.id, o.position_name, o.company, o.pay,
    o.location_type, o.location_text,
    o.description, o.start_month, o.start_year,
    o.application_deadline,
    case
      when o.contact_email_visible
        or o.posted_by = (select auth.uid())
        or public.is_admin()
      then o.contact_email
      else null
    end,
    o.contact_email_visible,
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
    b.created_at,
    o.eligible_audience,
    p.avatar_path
  from public.opportunity_bookmarks b
  join public.opportunities o on o.id = b.opportunity_id
  left join public.profiles p on p.id = o.posted_by
  where b.user_id = (select auth.uid())
    and o.status = 'approved'
    and o.application_deadline >= current_date
    and (public.is_admin() or o.posted_by = (select auth.uid())
         or public.member_admits_audience((select auth.uid()), o.eligible_audience))
  order by b.created_at desc;
$function$;
revoke all on function public.list_my_bookmarked_opportunities() from public, anon, authenticated;
grant execute on function public.list_my_bookmarked_opportunities() to authenticated;


-- ─── 7. Activity, community feed, and the writes that name a job ────
create or replace function public.get_my_activity()
returns table(listing_kind listing_event_kind, listing_id uuid, action_type user_action_type,
              marked_at timestamp with time zone, title text, subtitle text, status text,
              occurs_at timestamp with time zone, url text)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  with my as (
    select listing_kind, listing_id, action_type, created_at as marked_at
      from public.user_listing_actions
     where user_id = (select auth.uid())
  )
  select my.listing_kind, my.listing_id, my.action_type, my.marked_at,
         o.position_name::text   as title,
         o.company::text         as subtitle,
         o.status::text          as status,
         o.application_deadline  as occurs_at,
         o.apply_url             as url
    from my
    join public.opportunities o on o.id = my.listing_id
   where my.listing_kind = 'opportunity'
     and (public.is_admin() or o.posted_by = (select auth.uid())
          or public.member_admits_audience((select auth.uid()), o.eligible_audience))
  union all
  select my.listing_kind, my.listing_id, my.action_type, my.marked_at,
         e.title::text           as title,
         e.location::text        as subtitle,
         e.status::text          as status,
         e.event_at              as occurs_at,
         e.luma_link             as url
    from my
    join public.events e on e.id = my.listing_id
   where my.listing_kind = 'event'
  union all
  select my.listing_kind, my.listing_id, my.action_type, my.marked_at,
         v.name::text                           as title,
         coalesce(v.stage::text, v.kind::text)  as subtitle,
         v.status::text                         as status,
         v.deadline                             as occurs_at,
         v.link                                 as url
    from my
    join public.vcs_grants v on v.id = my.listing_id
   where my.listing_kind = 'vc_grant';
$function$;

-- A system post copies the job's title and description; it inherits the
-- job's audience on every read (§7.2), so an audience edit can't leave a
-- broadly readable copy behind.
create or replace function public.list_community_feed(p_cursor_created_at timestamp with time zone default null::timestamp with time zone, p_cursor_id uuid default null::uuid, p_limit integer default 20)
returns table(id uuid, kind text, title text, body text, created_at timestamp with time zone,
              expires_at timestamp with time zone, author_id uuid, author_first_name text,
              author_surname text, author_role user_role, source_table text, source_id uuid,
              images jsonb, like_count integer, liked_by_me boolean)
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_admin();
begin
  if not (public.is_approved() or v_admin) then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.kind, p.title, p.body, p.created_at, p.expires_at,
    p.author_id, pr.first_name, pr.surname, pr.role,
    p.source_table, p.source_id,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'blob_key', pi.blob_key, 'alt_text', pi.alt_text,
                'width', pi.width, 'height', pi.height)
              order by pi.position)
         from public.post_images pi where pi.post_id = p.id),
      '[]'::jsonb
    ),
    (select count(*)::int from public.post_likes pl where pl.post_id = p.id),
    exists (select 1 from public.post_likes pl where pl.post_id = p.id and pl.user_id = v_uid)
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where p.expires_at > now()
    and (p.kind <> 'system' or p.source_table <> 'opportunities' or v_admin
         or exists (select 1 from public.opportunities o
                     where o.id = p.source_id
                       and (o.posted_by = v_uid or public.member_admits_audience(v_uid, o.eligible_audience))))
    and (p_cursor_created_at is null
         or (p.created_at, p.id) < (p_cursor_created_at, p_cursor_id))
  order by p.created_at desc, p.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$function$;

create or replace function public.mark_listing_action(p_kind listing_event_kind, p_id uuid, p_action user_action_type)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null then
    raise exception 'Forbidden: sign-in required' using errcode = '42501';
  end if;
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;

  -- Action/kind compatibility check duplicated here so the RPC gives a
  -- clean error before hitting the table-level CHECK.
  if not (
       (p_action = 'applied' and p_kind in ('opportunity', 'vc_grant'))
    or (p_action = 'going'   and p_kind = 'event')
  ) then
    raise exception 'action_type % is not valid for listing_kind %', p_action, p_kind
      using errcode = '22023';
  end if;

  -- Validate the listing exists. RLS on the listing tables is
  -- bypassed by SECURITY DEFINER, so we check status='approved' here
  -- explicitly — we don't want users marking pending or rejected
  -- listings (which they couldn't see anyway). A job also has to be one
  -- this member's audience can see.
  case p_kind
    when 'opportunity' then
      select true into v_ok from public.opportunities
       where id = p_id and status = 'approved'
         and (posted_by = v_uid or public.member_admits_audience(v_uid, eligible_audience))
       limit 1;
    when 'event' then
      select true into v_ok from public.events        where id = p_id and status = 'approved' limit 1;
    when 'vc_grant' then
      select true into v_ok from public.vcs_grants    where id = p_id and status = 'approved' limit 1;
  end case;
  if v_ok is not true then
    raise exception 'Listing not found or not approved' using errcode = 'P0002';
  end if;

  insert into public.user_listing_actions (user_id, listing_kind, listing_id, action_type)
  values (v_uid, p_kind, p_id, p_action)
  on conflict do nothing;
end;
$function$;

create or replace function public.record_listing_event(p_kind listing_event_kind, p_id uuid, p_event_type listing_event_type)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Forbidden: sign-in required' using errcode = '42501';
  end if;

  -- Admins are allowed through on status the same way the page guards let
  -- them through, so an admin browsing the member-facing UI for diagnosis
  -- doesn't start throwing here.
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;

  -- A view of a job outside the member's audience is not recorded: they
  -- could not have seen it.
  if p_kind = 'opportunity' and not public.is_admin() and not exists (
       select 1 from public.opportunities o
        where o.id = p_id
          and (o.posted_by = v_uid or public.member_admits_audience(v_uid, o.eligible_audience))) then
    return;
  end if;

  insert into public.listing_events (listing_kind, listing_id, viewer_id, event_type)
  values (p_kind, p_id, v_uid, p_event_type)
  on conflict do nothing;
end;
$function$;

-- Bookmarking a job is the same exposure as viewing it.
drop policy if exists "opportunity_bookmarks_insert_own" on public.opportunity_bookmarks;
create policy "opportunity_bookmarks_insert_own" on public.opportunity_bookmarks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.opportunities o
                 where o.id = opportunity_bookmarks.opportunity_id
                   and o.status = 'approved'
                   and (o.posted_by = (select auth.uid())
                        or public.member_admits_audience((select auth.uid()), o.eligible_audience))));


-- ─── 8. Admin: jobs that still need an audience ─────────────────────
create or replace function public.admin_list_opportunities_needing_audience()
returns table (id uuid, position_name text, company text, application_deadline date,
               created_at timestamptz, poster_first_name text, poster_surname text)
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  return query
    select o.id, o.position_name, o.company, o.application_deadline, o.created_at,
           p.first_name, p.surname
      from public.opportunities o
      left join public.profiles p on p.id = o.posted_by
     where o.status = 'approved' and o.eligible_audience is null
       and o.application_deadline >= current_date
     order by o.created_at
     limit 200;
end;
$$;

create or replace function public.admin_set_opportunity_audience(p_id uuid, p_audience text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  perform public.assert_audience(p_audience);
  update public.opportunities set eligible_audience = p_audience where id = p_id;
  if not found then
    raise exception 'That item no longer exists.' using errcode = 'P0002';
  end if;
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'admin_set_opportunity_audience', 'opportunities', p_id, p_audience);
end;
$$;

revoke all on function public.admin_list_opportunities_needing_audience() from public, anon, authenticated;
revoke all on function public.admin_set_opportunity_audience(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_list_opportunities_needing_audience() to authenticated;
grant execute on function public.admin_set_opportunity_audience(uuid, text) to authenticated;
