-- Security audit fix (2026-10-25), finding #2 and #4.
--
-- Two groups of profiles columns had no write guard at all — the table-wide
-- UPDATE grant to `authenticated` from early migrations was never narrowed
-- for them, unlike role/status/avatar_path/cv_path which this project
-- already protects with a BEFORE UPDATE trigger (20260531000003,
-- 20260901000003). Same idiom here, same reason it's a trigger and not a
-- column-level grant: several of these columns are legitimately written by
-- a member's own SECURITY DEFINER RPC (submit_intake, confirm_my_graduation)
-- where auth.role() stays 'authenticated' even inside the function, so a
-- column-grant revoke would be indistinguishable from a direct PATCH and a
-- trigger needs the same transaction-local GUC marker those RPCs already
-- use elsewhere (tg_profiles_protect_avatar_path's foundry.media_write).
--
-- Group A — admin-only, no self-service writer exists:
--   is_committee, committee_role (sole writer: admin_set_committee, already
--     is_admin()-gated — 20260904000003/20260904000004)
--   created_at (no legitimate writer at all post-insert)
-- Group B — also legitimately written by the member's own RPC:
--   graduation_confirmed_at, graduation_prompted_at (confirm_my_graduation,
--     admin_prompt_graduates — 20261011000005)
--   intake_completed_at, profile_version (submit_intake — 20260901000013)
--
-- Direct exploit this closes: an approved member could
-- PATCH /rest/v1/profiles?id=eq.<self> with {"is_committee":true,
-- "committee_role":"President"} and show up with a gold officer banner to
-- every other member (list_committee_cards), or set graduation_confirmed_at
-- themselves to permanently drop out of admin_prompt_graduates's filter, or
-- backdate created_at to appear higher in "newest members".

create or replace function public.tg_profiles_protect_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_committee is distinct from old.is_committee
     or new.committee_role is distinct from old.committee_role
     or new.created_at is distinct from old.created_at then
    if auth.role() = 'service_role' then
      return new;
    end if;
    if public.is_admin() then
      return new;
    end if;
    raise exception 'is_committee, committee_role and created_at are set by admins only'
      using errcode = '42501';
  end if;

  if new.graduation_confirmed_at is distinct from old.graduation_confirmed_at
     or new.graduation_prompted_at is distinct from old.graduation_prompted_at
     or new.intake_completed_at is distinct from old.intake_completed_at
     or new.profile_version is distinct from old.profile_version then
    if auth.role() = 'service_role' then
      return new;
    end if;
    if public.is_admin() then
      return new;
    end if;
    -- Trusted-call marker, same pattern as tg_profiles_protect_avatar_path's
    -- foundry.media_write. submit_intake and confirm_my_graduation set this
    -- immediately before (and clear it immediately after) their own UPDATE
    -- of these columns — an ordinary member calling their own intake/
    -- graduation RPC stays auth.role() = 'authenticated' throughout, so
    -- without this marker every one of those calls would trip this trigger.
    if coalesce(current_setting('foundry.profile_lifecycle_write', true), '') = 'true' then
      return new;
    end if;
    raise exception 'graduation_confirmed_at, graduation_prompted_at, intake_completed_at and profile_version are set by the onboarding/graduation service, not directly'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.tg_profiles_protect_lifecycle()
  from public, anon, authenticated;

drop trigger if exists profiles_protect_lifecycle on public.profiles;
create trigger profiles_protect_lifecycle
  before update on public.profiles
  for each row execute function public.tg_profiles_protect_lifecycle();

-- ─── submit_intake: wrap its UPDATE with the new marker ───────────────
-- Identical to 20260901000013's definition except for the two
-- set_config lines around the UPDATE. Same signature, CREATE OR REPLACE.
create or replace function public.submit_intake(
  p_preferred_name     text,
  p_bio_focus          text,
  p_bio_hobbies        text,
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
  p_intents            text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_status   user_status;
  v_version  smallint;
  v_role     user_role;
  v_cv_path  text;
  v_linkedin text;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select status, profile_version, role, cv_path, linkedin_url
    into v_status, v_version, v_role, v_cv_path, v_linkedin
    from public.profiles where id = v_caller;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if v_status <> 'approved' then
    raise exception 'Your membership must be approved before you can complete your profile'
      using errcode = '42501';
  end if;
  if v_version >= 2 then
    raise exception 'You have already completed this' using errcode = '22023';
  end if;
  if v_role = 'student' and v_cv_path is null then
    raise exception 'Add your CV before finishing your profile' using errcode = '23514';
  end if;
  if v_linkedin is null then
    raise exception 'Add your LinkedIn profile before finishing your profile' using errcode = '23514';
  end if;

  perform public._apply_intake_fields(
    v_caller, p_preferred_name, p_bio_focus, p_bio_hobbies, p_current_focus,
    p_venture_stage, p_venture_name, p_venture_url, p_venture_one_liner,
    p_recruiting_status, p_intent_urgency, p_availability_hours,
    p_skill_ids, p_core_skill_ids, p_sector_ids,
    p_academic_interests, p_hobbies, p_intents
  );

  perform set_config('foundry.profile_lifecycle_write', 'true', true);
  update public.profiles
     set profile_version    = 2,
         intake_completed_at = now(),
         intake_deferred_at  = null
   where id = v_caller;
  perform set_config('foundry.profile_lifecycle_write', 'false', true);
end;
$$;

-- ─── confirm_my_graduation: wrap both branches' UPDATEs ───────────────
-- Identical to 20261011000005's definition except for the new
-- set_config lines around each UPDATE that touches graduation_*.
create or replace function public.confirm_my_graduation(
  p_graduated boolean, p_still_enrolled boolean default false, p_new_grad_year integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_prof public.profiles;
  v_year int := extract(year from now())::int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_prof from public.profiles where id = v_uid for update;
  if v_prof.id is null or v_prof.status <> 'approved' or v_prof.role <> 'student' then
    raise exception 'Only an approved student can confirm graduation.' using errcode = '42501';
  end if;
  if p_graduated is null then
    raise exception 'Say whether you have graduated.' using errcode = '22023';
  end if;

  if p_graduated then
    perform public.set_my_education(coalesce(p_still_enrolled, false), true);
    -- Opened and closed around the one UPDATE, like set_my_affiliation.
    perform set_config('foundry.affiliation_change', 'true', true);
    perform set_config('foundry.profile_lifecycle_write', 'true', true);
    update public.profiles
       set role = 'recent_grad',
           grad_year = least(coalesce(grad_year, v_year), v_year),
           graduation_confirmed_at = now(),
           graduation_prompted_at = null
     where id = v_uid;
    perform set_config('foundry.affiliation_change', 'false', true);
    perform set_config('foundry.profile_lifecycle_write', 'false', true);
    return 'recent_grad';
  end if;

  if p_new_grad_year is null or p_new_grad_year < v_year or p_new_grad_year > v_year + 8 then
    raise exception 'Choose the year you now expect to graduate.' using errcode = '22023';
  end if;
  perform set_config('foundry.profile_lifecycle_write', 'true', true);
  update public.profiles
     set grad_year = p_new_grad_year, graduation_prompted_at = null
   where id = v_uid;
  perform set_config('foundry.profile_lifecycle_write', 'false', true);
  return 'student';
end;
$$;
