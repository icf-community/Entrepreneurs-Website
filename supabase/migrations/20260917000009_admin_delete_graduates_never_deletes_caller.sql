-- ════════════════════════════════════════════════════════════════════
-- Foundry · admin_delete_graduates: never delete the admin running it,
--           and write the audit before the destruction, not after
--
-- Found by the connections benchmark harness (scale_query_plans.sql
-- §8k-iii) the first time it called the RPC against a corpus whose admin
-- account was itself a student in the cohort:
--
--   ERROR:  insert or update on table "admin_actions" violates foreign
--           key constraint "admin_actions_admin_id_fkey"
--   DETAIL: Key (admin_id)=(…) is not present in table "users".
--   CONTEXT: PL/pgSQL function admin_delete_graduates(integer) line 47
--
-- TWO SEPARATE BUGS, both dating to 20260529000007.
--
-- 1. THE CALLER IS NOT EXCLUDED FROM THE COHORT. `admin_delete_user`
--    refuses outright when the target is the caller — "Use the
--    self-service Delete Account flow to delete your own account" — so
--    the intent is already settled in this codebase: an admin must never
--    delete their own account through an admin path. The bulk variant
--    takes a year rather than a target and so never inherited that
--    guard. Admins here ARE members (admin is granted by email after
--    onboarding), so a committee member who is an admin and whose
--    graduation year has passed is in their own cohort. Running the
--    annual cleanup would then delete the person running it.
--
-- 2. THE AUDIT ROW IS WRITTEN AFTER `delete from auth.users`. When the
--    caller was in the cohort their own auth.users row was already gone,
--    the FK on admin_actions.admin_id failed, and the exception rolled
--    back the ENTIRE cleanup — hundreds of intended deletions lost to an
--    opaque constraint error with nothing in the audit log to say it had
--    been attempted. Writing the audit first is the same discipline as
--    admin_reveal_connection_note and admin_log_cv_access: the record
--    that something was attempted has to survive the thing failing.
--
-- Excluding the caller also keeps the audit rows safe from the
-- `delete from public.admin_actions where admin_id in (_to_delete)`
-- step, which would otherwise delete the rows just written.
--
-- Recreate-from-latest of 20260917000006 with the signature unchanged, so
-- this replaces it rather than creating a dead overload.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_delete_graduates(
  p_cutoff_year int
)
returns table(user_id uuid, email text, first_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
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
  -- this was attempted and by whom. v_caller is excluded from
  -- _to_delete above, so the admin_actions cleanup below cannot delete
  -- these rows.
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
  delete from public.admin_actions where admin_id  in (select td.user_id from _to_delete td);

  -- Cascade-delete the auth rows themselves.
  delete from auth.users where id in (select td.user_id from _to_delete td);

  return query
    select td.user_id, td.email, td.first_name from _to_delete td;
end;
$$;

revoke all     on function public.admin_delete_graduates(int) from public, anon;
grant  execute on function public.admin_delete_graduates(int) to authenticated;
