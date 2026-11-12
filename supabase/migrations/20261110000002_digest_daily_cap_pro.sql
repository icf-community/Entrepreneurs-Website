-- Resend Pro is live: raise the digest recipient cap from the Free-tier-safe
-- 40/day default to 800/day. See docs/owner-decisions.md and
-- memory resend-pro-raise-digest-cap: never do this before Pro is active,
-- Free starves sign-in OTP sends sharing the same account.

-- Body copied from the LATEST definition (20260917000016), digest_daily_cap only changed.
create or replace function public.connection_limit_defaults()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'daily_cap',                 10,
    'weekly_cap',                25,
    'outstanding_cap',           30,
    'block_daily_cap',           20,
    'cooldown_days',             21,
    'expiry_months',              6,
    'note_max_chars',           300,
    'throttle_distinct_signals',  5,
    'throttle_lookback_days',    90,
    'throttle_duration_days',    30,
    'throttle_daily_cap',         3,
    'digest_min_hours',          20,
    'digest_daily_cap',         800
  );
$$;

revoke execute on function public.connection_limit_defaults() from public, anon, authenticated;

update public.app_config
   set value = (value::jsonb || jsonb_build_object('digest_daily_cap', 800))::text
 where key = 'connection_limits'
   and value is not null
   and btrim(value) <> ''
   and (value::jsonb) ? 'digest_daily_cap';
