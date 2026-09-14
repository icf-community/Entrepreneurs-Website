-- ════════════════════════════════════════════════════════════════════
-- Foundry · Admin UI toggle for the GitHub/CV ingestion kill switch
--
-- Until now github_cv_ingestion_enabled (20260911000003) could only be
-- flipped by hand in the Supabase SQL Editor — fine for the person who
-- wrote it, a real risk for anyone else who needs to pause ingestion
-- fast during an incident and has to go find the right UPDATE statement
-- first. This adds the two RPCs the admin control panel needs: one to
-- flip it, one to read its current state plus who last changed it.
--
-- app_config has RLS enabled with zero policies (20260530000003) — no
-- role can read or write it directly, by design. Both RPCs here are the
-- only way through that, same as every other app_config-backed switch.
--
-- Audit trail: admin_actions.target_id is `uuid not null` with no
-- default, built for the case where the target is a real row (a
-- profile, a listing). app_config's rows are keyed by text, not a
-- uuid, so there is no natural id to put there. Rather than growing a
-- separate audit mechanism for this one switch, target_id uses a fixed
-- nil UUID (00000000-0000-0000-0000-000000000000) with target_table =
-- 'app_config' and the config key in notes — a documented one-off, not
-- a pattern to repeat, that keeps this in the same place every other
-- admin action is already logged and queried from.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_set_ingestion_enabled(p_enabled boolean)
returns void
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

  update public.app_config
     set value      = case when p_enabled then 'true' else 'false' end,
         updated_at = now()
   where key = 'github_cv_ingestion_enabled';

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
    values (
      v_caller,
      case when p_enabled then 'resume_github_ingestion' else 'pause_github_ingestion' end,
      'app_config',
      '00000000-0000-0000-0000-000000000000'::uuid,
      'github_cv_ingestion_enabled'
    );
end;
$$;

revoke execute on function public.admin_set_ingestion_enabled(boolean) from public, anon;
grant  execute on function public.admin_set_ingestion_enabled(boolean) to authenticated;

create or replace function public.admin_get_ingestion_status()
returns table (
  enabled         boolean,
  last_changed_at timestamptz,
  last_changed_by text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  return query
    select
      public.github_cv_ingestion_enabled(),
      aa.created_at,
      trim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.surname, ''))
    from (
      select admin_id, created_at
        from public.admin_actions
       where target_table = 'app_config'
         and action in ('pause_github_ingestion', 'resume_github_ingestion')
       order by created_at desc
       limit 1
    ) aa
    left join public.profiles p on p.id = aa.admin_id;

  -- No prior toggle recorded yet (the switch defaulted on and nobody has
  -- used this RPC): still report the current boolean, with null
  -- last-changed fields rather than an empty result set.
  if not found then
    return query select public.github_cv_ingestion_enabled(), null::timestamptz, null::text;
  end if;
end;
$$;

revoke execute on function public.admin_get_ingestion_status() from public, anon;
grant  execute on function public.admin_get_ingestion_status() to authenticated;
