-- Fixes for four items the D10 ledger had recorded as accepted risks.
--
--   R1  Two administrators deleting each other in the same instant could leave none.
--   R2  A rejected (banned) member could still edit their own skills and sectors.
--   R3  An email row that always answers 429 was retried every 30 minutes forever.
--   R4  A failed enqueue left the weekly showcase nudge claimed, suppressing it for 30 days.
--
-- Deploy-order safe on its own: the old frontend never calls the two new functions, and the
-- admin_delete_user change only adds waiting.

-- ─── R1: admin_delete_user serialises on the admin roster ────────────
-- Recreated from 20261011000001 with the same signature. delete_my_account (20261026000019)
-- already takes this lock; the two now share one order: roster lock first, then the row locks.
-- After the lock the caller's own admin status is read again: if another administrator deleted
-- them in the meantime this call is refused instead of removing the last remaining one.
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

  -- Only deleting an administrator can empty the roster, so only that path pays for the lock.
  if exists (select 1 from public.admins where user_id = p_user_id) then
    perform pg_advisory_xact_lock(hashtextextended('admin_roster', 0));
    if not public.is_admin() then
      raise exception 'Forbidden: not an admin' using errcode = '42501';
    end if;
  end if;

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

-- ─── R2: a rejected member cannot edit their skills or sectors ───────
-- Only `rejected` is blocked. A pending_review member legitimately fills these in during onboarding.
-- The select policies are unchanged, and account deletion and the ban purge run as security definer.
drop policy if exists profile_skills_modify_own on public.profile_skills;
create policy profile_skills_modify_own on public.profile_skills
  for all to authenticated
  using (
    profile_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'rejected')
  )
  with check (
    profile_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'rejected')
  );

drop policy if exists profile_sectors_modify_own on public.profile_sectors;
create policy profile_sectors_modify_own on public.profile_sectors
  for all to authenticated
  using (
    profile_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'rejected')
  )
  with check (
    profile_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'rejected')
  );

-- ─── R3: a 429 that never clears is eventually a failed attempt ──────
-- The drain does not burn an attempt on a 429 (Resend rate-limits per second, so a healthy row hits it
-- briefly). A row that is still being refused a day after it was queued is not rate-limited, it is
-- broken, so from then on each deferral counts as an attempt and the row is buried at max_attempts.
create or replace function public.defer_outbound_email(p_id uuid, p_error text, p_minutes int default 30)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'Forbidden: service role required' using errcode = '42501';
  end if;

  update public.outbound_email oe
     set next_attempt_at = now() + make_interval(mins => greatest(coalesce(p_minutes, 30), 1)),
         last_error      = p_error,
         attempts        = oe.attempts + case when oe.created_at < now() - interval '24 hours' then 1 else 0 end
   where oe.id = p_id
     and oe.sent_at is null;
end;
$$;

revoke all on function public.defer_outbound_email(uuid, text, int) from public, anon, authenticated;
grant execute on function public.defer_outbound_email(uuid, text, int) to service_role;

-- ─── R4: a nudge that was claimed but never queued is released ───────
-- due_github_showcase_nudges stamps the member when it hands them out (so two overlapping runs get
-- disjoint sets). If the email could not be queued afterwards, the route releases the claim so the
-- next weekly run tries again instead of waiting 30 days. Null is safe: it only makes them due.
create or replace function public.release_github_showcase_nudges(p_member_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.github_connections
     set showcase_nudged_at = null
   where member_id = any(coalesce(p_member_ids, '{}'::uuid[]));
$$;

revoke all on function public.release_github_showcase_nudges(uuid[]) from public, anon, authenticated;
grant execute on function public.release_github_showcase_nudges(uuid[]) to service_role;
