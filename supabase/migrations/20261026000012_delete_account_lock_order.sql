-- ════════════════════════════════════════════════════════════════════
-- Account deletion no longer deadlocks with writers that reference the member.
--
-- Found by the I-1b sweep (e2e/adversarial/concurrency.spec.ts, "send racing the
-- ADDRESSEE deleting their account"): when a connection request to a member
-- raced that member's own delete_my_account, Postgres aborted the delete with
-- "deadlock detected" (40P01) in 3 of 3 runs, and the member's deletion failed.
-- The request holds a KEY SHARE lock on the member's profile from its foreign-key
-- check; the delete, going straight for auth.users and the cascade, interleaved
-- with it. Any write that references a member (a post, a reaction, a connection)
-- can meet the same shape.
--
-- A second shape of the same bug, found by the class sweep of every RPC that
-- targets another member: respond_to_connection_request updates the connection
-- row and THEN reaches the profile (event-log foreign key), while the delete took
-- the profile first and then cascaded into the connection row. A lock-order
-- inversion, `deadlock detected` again, this time on the responder.
--
-- Fix: delete_my_account, admin_delete_user and admin_delete_graduates lock the
-- member's connection rows and then their profile (FOR UPDATE, in id order)
-- before anything else, which is the order every writer already uses. In-flight
-- writers finish first, later writers queue behind the delete, and a writer that
-- arrives after it fails its foreign key and gets the generic refusal
-- (20261026000011 for connection requests). reject_user locks only the profile
-- and acts on pending-review members who have no connections; it is unchanged.
--
-- Bodies are the LIVE definitions (the result of every earlier migration, last
-- touched by 20261011000005 / 20260928000011) with only the lock added. Signatures,
-- security definer, search_path and grants are unchanged (CREATE OR REPLACE keeps them).
--
-- Prod pre-check: none, no data is touched.
-- Rollback: re-apply the three functions from 20260928000011_admin_actions_survive_deletion.sql
--           and 20261011000005_graduate_transition_and_tombstones.sql.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_my_account()
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

  -- Lock order (20261026000012): this member's connection rows, then their
  -- profile, then everything else. Writers that touch a connection take the
  -- connection row first and reach the profile afterwards (the event-log foreign
  -- key takes a KEY SHARE lock on it), and a connection request holds KEY SHARE
  -- on the profile until it commits. Deleting in the opposite order, or
  -- interleaving, is what produced "deadlock detected" when a request to or a
  -- response from this member raced their own account deletion.
  perform 1 from public.connections c
   where c.requester_id = v_caller or c.addressee_id = v_caller
   order by c.id
     for update;
  perform 1 from public.profiles where id = v_caller for update;

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

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid, p_reason text)
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

  -- Connection rows, then the profile, then auth.users: the same order
  -- delete_my_account takes (20261026000012).
  perform 1 from public.connections c
   where c.requester_id = p_user_id or c.addressee_id = p_user_id
   order by c.id
     for update;
  perform 1 from public.profiles where id = p_user_id for update;
  perform 1 from auth.users where id = p_user_id for update;

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

CREATE OR REPLACE FUNCTION public.admin_delete_graduates(p_cutoff_year integer)
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

  -- Lock the doomed members' connection rows, then their profiles, each in id
  -- order, before touching anything (20261026000012): the order writers use, and a
  -- stable one so two cleanups cannot deadlock each other.
  perform 1 from public.connections c
   where c.requester_id in (select td.user_id from _to_delete td)
      or c.addressee_id in (select td.user_id from _to_delete td)
   order by c.id
     for update;
  perform 1 from public.profiles p
   where p.id in (select td.user_id from _to_delete td)
   order by p.id
     for update;

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
