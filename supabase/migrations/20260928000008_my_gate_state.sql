-- ════════════════════════════════════════════════════════════════════
-- Foundry · One round trip for the page gate (B26, E1b Stage 1)
--
-- requireApprovedUser / requireSignedInUser / getActionAuth each made two
-- PostgREST calls on every page and action: rpc/is_admin and a profiles
-- read. At 250 signed-in members those two were ~40% of all PostgREST
-- traffic, queueing behind a small connection pool. This returns both in
-- one row. Keyed on auth.uid() only, so it can't name anyone else; with
-- no profile row (never onboarded) the profile columns are null.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.my_gate_state()
returns table (
  is_admin           boolean,
  status             public.user_status,
  profile_version    smallint,
  intake_deferred_at timestamptz,
  first_name         text,
  surname            text,
  preferred_name     text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.admins a where a.user_id = u.uid),
    p.status, p.profile_version, p.intake_deferred_at, p.first_name, p.surname, p.preferred_name
  from (select auth.uid() as uid) u
  left join public.profiles p on p.id = u.uid
  where u.uid is not null;
$$;

revoke execute on function public.my_gate_state() from public, anon, authenticated;
grant  execute on function public.my_gate_state() to authenticated;
