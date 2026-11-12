-- ════════════════════════════════════════════════════════════════════
-- Foundry · One read for the Connect control (launch programme B25)
--
-- ConnectControl opened with FOUR RPCs per dialog (connection_state_with,
-- connection_consent_version, connections_enabled, my_connection_quota),
-- and re-read two of them after every action. At 500 members active at
-- once that is four PostgREST round trips per profile opened, Frankfurt
-- to London each way.
--
-- This composes the existing functions rather than re-implementing any of
-- them, so their latest definitions (20260917000017 / 20260917000001)
-- stay the single source of each rule; nothing here is recreated.
--
-- Same authorisation as its parts: connection_state_with and
-- my_connection_quota each raise 42501 for a caller who is not an
-- approved member or admin, and that raise propagates unchanged.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.connection_panel_state(p_member uuid)
returns table (
  state              text,
  connection_id      uuid,
  available_at       timestamptz,
  consent_version    text,
  enabled            boolean,
  daily_cap          int,
  weekly_cap         int,
  outstanding        int,
  limit_reason       text,
  quota_available_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  q record;
begin
  select * into s from public.connection_state_with(p_member) limit 1;
  select * into q from public.my_connection_quota() limit 1;

  return query select
    s.state,
    s.connection_id,
    s.available_at,
    public.connection_consent_version(),
    public.connections_enabled(),
    q.daily_cap,
    q.weekly_cap,
    q.outstanding,
    q.limit_reason,
    q.available_at;
end;
$$;

-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon and authenticated; revoking from public alone leaves anon's grant.
revoke execute on function public.connection_panel_state(uuid) from public, anon;
grant  execute on function public.connection_panel_state(uuid) to authenticated;
