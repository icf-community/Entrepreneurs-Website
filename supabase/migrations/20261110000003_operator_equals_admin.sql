-- Owner decision 2026-11-10: no separate "make someone an AI operator" SQL
-- step for handoff smoothness — every admin is automatically an AI operator.
-- Drops the ai_private.operators-row requirement; is_ai_operator() now is
-- just is_admin(). ai_private.operators stays as a harmless unused table
-- rather than a migration that drops it (nothing in prod references it yet;
-- deleting it is a later cleanup, not a blocker).

create or replace function public.is_ai_operator()
returns boolean
language sql
stable
security definer
set search_path = public, ai_private
as $$
  select public.is_admin();
$$;

revoke all on function public.is_ai_operator() from public, anon, authenticated;
grant execute on function public.is_ai_operator() to authenticated;
