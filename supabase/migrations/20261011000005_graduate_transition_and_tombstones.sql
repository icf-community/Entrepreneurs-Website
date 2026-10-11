-- Graduates transition instead of being deleted; deletions survive a
-- backup restore (programme S1; owner decision 2026-10-11; AI-plan §14.3
-- "Graduate lifecycle", review R38; §5.1/§14 Recovery).
--
-- GRADUATES. /admin/graduates bulk-deleted approved students by
-- graduation year, but jobs now have a Graduates audience made of exactly
-- those people. Instead:
--   * admin_prompt_graduates(cutoff) stamps graduation_prompted_at on
--     approved students due to graduate (once each; a second run is a
--     no-op for them), audits each, and returns who to email;
--   * the member answers once (confirm_my_graduation): graduated → role
--     recent_grad (the role lock's trusted marker), education updated
--     (graduates audience; still studying keeps the students one);
--     not yet → a new expected year, and the prompt clears;
--   * admin_delete_graduates loses its grant and is kept for history.
--     Deleting a single account is unchanged.
--
-- TOMBSTONES. A deleted account came back with any restore of an older
-- backup. Every deletion of auth.users (self, admin, reject, dashboard)
-- now leaves a SHA-256 of the user id: no name, no email. After a restore,
-- scripts/db-replay-deletions.sql deletes every restored account whose
-- hash is listed. The table is restored with the backup too, so the
-- runbook exports it from the live database first (docs/ops/
-- restore-deletion-replay.md). Kept 35 days: longer than the backup and
-- point-in-time windows it exists to cover, then purged daily.

-- ─── Graduates ──────────────────────────────────────────────────────
alter table public.profiles
  add column graduation_prompted_at  timestamptz,
  add column graduation_confirmed_at timestamptz;
-- profiles is read column by column (20260901000009). The member reads
-- their own prompt state on /home and admins preview the cohort; signed-in
-- only, never anon. Writes go through the two functions below.
grant select (graduation_prompted_at, graduation_confirmed_at) on public.profiles to authenticated;

create or replace function public.admin_prompt_graduates(p_cutoff_year integer)
returns table (user_id uuid, email text, first_name text)
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
  if p_cutoff_year is null or p_cutoff_year < 1950 or p_cutoff_year > 2099 then
    raise exception 'Cutoff year must be between 1950 and 2099';
  end if;

  return query
    with due as (
      select p.id
        from public.profiles p
       where p.role = 'student' and p.status = 'approved'
         and p.grad_year is not null and p.grad_year <= p_cutoff_year
         and p.graduation_prompted_at is null and p.graduation_confirmed_at is null
         and p.id is distinct from v_caller
       for update of p
    ),
    stamped as (
      update public.profiles p
         set graduation_prompted_at = now()
        from due
       where p.id = due.id
      returning p.id, p.first_name
    ),
    audited as (
      insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
      select v_caller, 'admin_prompt_graduate', 'profiles', s.id, 'Graduation prompt, cutoff_year=' || p_cutoff_year
        from stamped s
      returning target_id
    )
    select s.id, au.email::text, s.first_name
      from stamped s
      join auth.users au on au.id = s.id;
end;
$$;

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
    update public.profiles
       set role = 'recent_grad',
           grad_year = least(coalesce(grad_year, v_year), v_year),
           graduation_confirmed_at = now(),
           graduation_prompted_at = null
     where id = v_uid;
    perform set_config('foundry.affiliation_change', 'false', true);
    return 'recent_grad';
  end if;

  if p_new_grad_year is null or p_new_grad_year < v_year or p_new_grad_year > v_year + 8 then
    raise exception 'Choose the year you now expect to graduate.' using errcode = '22023';
  end if;
  update public.profiles
     set grad_year = p_new_grad_year, graduation_prompted_at = null
   where id = v_uid;
  return 'student';
end;
$$;

revoke all on function public.admin_prompt_graduates(integer) from public, anon, authenticated;
revoke all on function public.confirm_my_graduation(boolean, boolean, integer) from public, anon, authenticated;
grant execute on function public.admin_prompt_graduates(integer) to authenticated;
grant execute on function public.confirm_my_graduation(boolean, boolean, integer) to authenticated;

-- Retired, not dropped: the history of what it did stays readable.
revoke execute on function public.admin_delete_graduates(integer) from public, anon, authenticated;

create or replace function public.set_my_affiliation(p_role user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller    uuid := auth.uid();
  v_role      user_role;
  v_grad_year int;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select role, grad_year into v_role, v_grad_year
    from public.profiles where id = v_caller;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if p_role = v_role then
    return; -- no-op, not an error
  end if;

  -- The whole security argument, in two lines.
  if v_role = 'student' then
    raise exception 'Students cannot change their affiliation here. When you graduate, confirm it from the prompt on your home page.'
      using errcode = '42501';
  end if;
  if p_role = 'student' then
    raise exception 'Student accounts are only created at signup, with a verified Imperial email address.'
      using errcode = '42501';
  end if;

  -- profiles_grad_year_role_consistency requires a graduation year for the
  -- two graduated roles. Moving to one without a year on file would fail
  -- the constraint with a message nobody can act on, so say it plainly.
  if p_role in ('recent_grad', 'alum') and v_grad_year is null then
    raise exception 'Add your graduation year to your profile before switching to this affiliation'
      using errcode = '22023';
  end if;

  -- Opened immediately before the UPDATE and closed immediately after.
  -- set_config's third argument makes this transaction-local, NOT
  -- statement-local: without the reset below, the flag stays raised for the
  -- rest of the transaction and a later direct UPDATE would ride through the
  -- trigger on it. Caught by the GUC-leak assertion in
  -- supabase/tests/admission_roles.sql, which exists for exactly this.
  perform set_config('foundry.affiliation_change', 'true', true);

  -- grad_year is deliberately LEFT ALONE. An earlier draft nulled it when
  -- moving to mentor/angel/staff_faculty, on the grounds that those roles
  -- have no graduation year. That loses data on a round trip: an alum who
  -- switches to angel and back would be told to re-enter a year we had
  -- just deleted. The CHECK constraint exempts those three from *needing*
  -- one; it does not forbid holding one, and an angel who is also an
  -- Imperial alum having a graduation year on file is accurate, not stale.
  update public.profiles
     set role = p_role
   where id = v_caller;

  perform set_config('foundry.affiliation_change', 'false', true);
end;
$$;

revoke execute on function public.set_my_affiliation(user_role) from public, anon;

-- ─── Deletion tombstones ────────────────────────────────────────────
create table public.deleted_accounts (
  id_hash    text primary key check (length(id_hash) = 64),
  deleted_at timestamptz not null default now()
);
alter table public.deleted_accounts enable row level security;
revoke all on public.deleted_accounts from public, anon, authenticated;

create or replace function public.tg_auth_user_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.deleted_accounts (id_hash)
  values (encode(extensions.digest(old.id::text, 'sha256'), 'hex'))
  on conflict (id_hash) do update set deleted_at = now();
  return old;
end;
$$;
revoke all on function public.tg_auth_user_tombstone() from public, anon, authenticated;

create trigger on_auth_user_deleted_tombstone
  after delete on auth.users
  for each row execute function public.tg_auth_user_tombstone();

create or replace function public.purge_deleted_account_tombstones()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.deleted_accounts where deleted_at < now() - interval '35 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_deleted_account_tombstones() from public, anon, authenticated;

select cron.schedule('purge-deleted-account-tombstones-daily', '55 2 * * *',
                     'select public.purge_deleted_account_tombstones();');

-- After a restore: delete every restored account whose tombstone was
-- exported from the live database and loaded back (runbook). Same order
-- as admin_delete_user, so blocking FKs never stop it; the tombstone
-- trigger re-stamps each one. Service-only.
create or replace function public.replay_account_deletions()
returns integer
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in
    select u.id
      from auth.users u
      join public.deleted_accounts d on d.id_hash = encode(extensions.digest(u.id::text, 'sha256'), 'hex')
  loop
    delete from public.opportunities where posted_by = r.id;
    delete from public.events        where posted_by = r.id;
    delete from public.vcs_grants    where posted_by = r.id;
    delete from auth.users where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.replay_account_deletions() from public, anon, authenticated;
