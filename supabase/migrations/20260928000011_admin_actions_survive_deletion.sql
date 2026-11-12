-- ════════════════════════════════════════════════════════════════════
-- Foundry · Deleting an account no longer deletes its admin audit trail (D3)
--
-- admin_actions.admin_id was ON DELETE RESTRICT, so every account-deletion
-- path cleared the row's own admin_actions first: delete_my_account,
-- admin_delete_user, admin_delete_graduates and reject_user all ran
-- `delete from public.admin_actions where admin_id = <them>`. Every
-- committee member is an admin at launch, so an admin could act and then
-- delete their account and the record of what they did went with it; one
-- admin deleting another erased the other's history the same way.
--
-- The key is now ON DELETE SET NULL: the action, its target, its reason and
-- its time survive; only the link to the deleted person goes, so no
-- personal data about them is retained. The four functions are recreated
-- from their live (latest) definitions with only those deletes removed.
-- Same signatures, return types, security and search_path; grants
-- re-stated below.
-- ════════════════════════════════════════════════════════════════════

alter table public.admin_actions alter column admin_id drop not null;
alter table public.admin_actions drop constraint admin_actions_admin_id_fkey;
alter table public.admin_actions
  add constraint admin_actions_admin_id_fkey
  foreign key (admin_id) references auth.users(id) on delete set null;

create or replace function public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Listings the caller posted. The CASCADE on
  -- opportunity_skills / opportunity_sectors handles the join tables.
  delete from public.opportunities where posted_by = v_caller;
  delete from public.events        where posted_by = v_caller;
  delete from public.vcs_grants    where posted_by = v_caller;

  -- Admin actions the caller authored are kept: admin_id goes to NULL with
  -- the auth row (20260928000011). They used to be deleted here, which let
  -- an admin erase their own audit trail by deleting their account.

  -- Finally remove the auth row. Cascades to public.profiles (which
  -- cascades again to profile_skills + profile_sectors) and public.admins.
  delete from auth.users where id = v_caller;
end;
$function$;

create or replace function public.admin_delete_user(p_user_id uuid, p_reason text)
 RETURNS TABLE(email text, first_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_email  text;
  v_first  text;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  if p_user_id = v_caller then
    raise exception 'Use the self-service Delete Account flow to delete your own account';
  end if;

  -- Capture identity before the cascade wipes it.
  select au.email::text, p.first_name into v_email, v_first
    from auth.users au
    left join public.profiles p on p.id = au.id
   where au.id = p_user_id;

  if v_email is null then
    raise exception 'User not found: %', p_user_id;
  end if;

  -- Same blocking-FK cleanup as delete_my_account.
  delete from public.opportunities where posted_by = p_user_id;
  delete from public.events        where posted_by = p_user_id;
  delete from public.vcs_grants    where posted_by = p_user_id;
  -- The target's own admin_actions rows are kept (admin_id → NULL).

  -- Cascades to profiles, profile_skills, profile_sectors, admins.
  delete from auth.users where id = p_user_id;

  -- Audit. Note this is logged against the deleter, with the deleted
  -- user's id captured in target_id.
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'admin_delete_user', 'auth.users', p_user_id, p_reason);

  return query select v_email, v_first;
end;
$function$;

create or replace function public.admin_delete_graduates(p_cutoff_year integer)
 RETURNS TABLE(user_id uuid, email text, first_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_count  int;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  if p_cutoff_year is null or p_cutoff_year < 1950 or p_cutoff_year > 2099 then
    raise exception 'Cutoff year must be between 1950 and 2099';
  end if;

  -- `on commit drop` only fires at commit, so a second call in the same
  -- transaction would otherwise collide with the first call's table.
  drop table if exists _to_delete;

  -- Materialise the set of doomed users so we can audit + email after
  -- the deletes finish.
  create temporary table _to_delete on commit drop as
    select p.id as user_id, au.email::text as email, p.first_name
      from public.profiles p
      join auth.users au on au.id = p.id
     where p.role = 'student'
       and p.status = 'approved'
       and p.grad_year is not null
       and p.grad_year <= p_cutoff_year
       -- Never the admin running this. See the header: admin_delete_user
       -- already refuses this for a single target, and an annual cleanup
       -- that deletes the person running it is the worse version of the
       -- same mistake. They can still close their own account through
       -- the self-service flow.
       and p.id is distinct from v_caller;

  select count(*) into v_count from _to_delete;

  if v_count = 0 then
    return;
  end if;

  -- AUDIT FIRST. One row per graduate, written before anything is
  -- destroyed, so a failure part-way through still leaves a record that
  -- this was attempted and by whom.
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  select v_caller,
         'admin_delete_graduate',
         'auth.users',
         td.user_id,
         'Graduate cleanup, cutoff_year=' || p_cutoff_year
    from _to_delete td;

  -- Clear blocking FKs for the entire cohort in one statement each.
  -- Every subselect is aliased: a bare `user_id` here is ambiguous
  -- against this function's OUT parameter of the same name.
  delete from public.opportunities where posted_by in (select td.user_id from _to_delete td);
  delete from public.events        where posted_by in (select td.user_id from _to_delete td);
  delete from public.vcs_grants    where posted_by in (select td.user_id from _to_delete td);
  -- Any admin_actions rows they authored are kept (admin_id → NULL).

  -- Cascade-delete the auth rows themselves.
  delete from auth.users where id in (select td.user_id from _to_delete td);

  return query
    select td.user_id, td.email, td.first_name from _to_delete td;
end;
$function$;

create or replace function public.reject_user(p_user_id uuid, p_reason text)
 RETURNS TABLE(email text, first_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_email  text;
  v_first  text;
  v_status public.user_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Rejection reason is required';
  end if;
  if p_user_id = v_caller then
    raise exception 'Cannot reject your own account';
  end if;

  -- Capture identity + current status before the cascade wipes it.
  select au.email::text, p.first_name, p.status
    into v_email, v_first, v_status
    from auth.users au
    left join public.profiles p on p.id = au.id
   where au.id = p_user_id;

  if v_email is null then
    raise exception 'User not found: %', p_user_id;
  end if;

  -- Hard guard: rejection is for users still under review. Approved
  -- members go through admin_delete_user (which also captures a
  -- reason); already-deleted rows never reach here.
  if v_status is null or v_status <> 'pending_review' then
    raise exception 'User is not pending review (status=%)', v_status;
  end if;

  -- Same blocking-FK cleanup as admin_delete_user. A pending_review
  -- user normally has zero posted listings (post buttons require
  -- approved status), but we include the cleanup for defence against
  -- future flow changes.
  delete from public.opportunities where posted_by = p_user_id;
  delete from public.events        where posted_by = p_user_id;
  delete from public.vcs_grants    where posted_by = p_user_id;
  -- Any admin_actions rows they authored are kept (admin_id → NULL).

  -- Cascades through profile, profile_skills, profile_sectors,
  -- opportunity_bookmarks (FK cascade), and listing_events viewer rows.
  delete from auth.users where id = p_user_id;

  -- Audit row captures the rejection. target_id points at the now-
  -- deleted auth.users uuid; the reason text is the only PII we retain.
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'reject_user', 'auth.users', p_user_id, p_reason);

  return query select v_email, v_first;
end;
$function$;

revoke execute on function public.delete_my_account()                 from public, anon, authenticated;
revoke execute on function public.admin_delete_user(uuid, text)       from public, anon, authenticated;
revoke execute on function public.admin_delete_graduates(integer)     from public, anon, authenticated;
revoke execute on function public.reject_user(uuid, text)             from public, anon, authenticated;
grant  execute on function public.delete_my_account()                 to authenticated;
grant  execute on function public.admin_delete_user(uuid, text)       to authenticated;
grant  execute on function public.admin_delete_graduates(integer)     to authenticated;
grant  execute on function public.reject_user(uuid, text)             to authenticated;
