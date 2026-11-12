-- ════════════════════════════════════════════════════════════════════
-- L-2: bound the AI money caps an operator can set.
--
-- admin_set_ai_limits limited the active-turn ceiling to a 25% step but only
-- checked the money caps for >= 0 (e2e/adversarial/ai-admin.spec.ts, "L-2": a
-- hijacked or mistaken operator call could set the per-member and matching
-- daily caps to any number, in one step). The caps are the database half of the
-- AI-bill backstop, so they get the same treatment as the turn ceiling:
--
--   * hard ceilings on the table, sized to the owner's $150/month OpenAI budget
--       matching_monthly_cap_micro  <= 150,000,000   ($150, the whole budget)
--       matching_daily_cap_micro    <=  10,000,000   ($10,  2x the $5 default)
--       member_daily_cap_micro      <=   1,000,000   ($1,   2x the $0.50 default)
--     Raising any of them later takes a deliberate migration.
--   * the function refuses a raise of more than 25% in one call, except back
--     up to the column default (so an emergency cut, even to 0, can always be
--     undone through the RPC). Lowering is always allowed.
--   * the function checks the ceilings and nulls itself and says so in plain
--     English; the CHECKs are the backstop for any other writer.
--
-- The monthly cap is still not editable through this RPC.
--
-- Body is the LATEST definition (20261006000004:2307, the only one), unchanged
-- apart from the checks added after the reason check. Signature, security
-- definer, search_path, operator gate, audit row and grants are unchanged
-- (CREATE OR REPLACE keeps the existing grants).
--
-- Prod pre-check (the CHECKs fail to validate if a stored value is above a
-- ceiling; the AI migrations have not been pushed yet, so the defaults apply):
--   select matching_monthly_cap_micro, matching_daily_cap_micro, member_daily_cap_micro
--     from ai_private.settings;
--   -- expect 150000000 / 5000000 / 500000 or lower
-- Rollback:
--   alter table ai_private.settings
--     drop constraint settings_matching_monthly_cap_max,
--     drop constraint settings_matching_daily_cap_max,
--     drop constraint settings_member_daily_cap_max;
--   then re-apply the function from 20261006000004_ai_turns.sql.
-- ════════════════════════════════════════════════════════════════════

alter table ai_private.settings
  add constraint settings_matching_monthly_cap_max check (matching_monthly_cap_micro <= 150000000) not valid,
  add constraint settings_matching_daily_cap_max   check (matching_daily_cap_micro   <= 10000000)  not valid,
  add constraint settings_member_daily_cap_max     check (member_daily_cap_micro     <= 1000000)   not valid;

alter table ai_private.settings validate constraint settings_matching_monthly_cap_max;
alter table ai_private.settings validate constraint settings_matching_daily_cap_max;
alter table ai_private.settings validate constraint settings_member_daily_cap_max;

create or replace function public.admin_set_ai_limits(
  p_active_turn_ceiling int, p_matching_daily_cap_micro bigint, p_member_daily_cap_micro bigint, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_old ai_private.settings;
  -- Column defaults: a raise back up to these is always allowed.
  c_matching_default constant bigint := 5000000;
  c_member_default   constant bigint := 500000;
begin
  if not public.is_ai_operator() then
    raise exception 'Forbidden: AI operators only' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 300 then
    raise exception 'Give a reason (3–300 characters).' using errcode = '22023';
  end if;
  if p_active_turn_ceiling is null or p_matching_daily_cap_micro is null or p_member_daily_cap_micro is null then
    raise exception 'Give a value for every limit.' using errcode = '22023';
  end if;
  if p_matching_daily_cap_micro > 10000000 then
    raise exception 'The matching daily cap cannot be set above $10.' using errcode = '22023';
  end if;
  if p_member_daily_cap_micro > 1000000 then
    raise exception 'The per-member daily cap cannot be set above $1.' using errcode = '22023';
  end if;
  select * into v_old from ai_private.settings where id = 1 for update;
  if p_active_turn_ceiling > ceil(v_old.active_turn_ceiling * 1.25) then
    raise exception 'Raise the ceiling in steps of at most 25%%.' using errcode = '22023';
  end if;
  if p_matching_daily_cap_micro > greatest(ceil(v_old.matching_daily_cap_micro * 1.25), c_matching_default)
     or p_member_daily_cap_micro > greatest(ceil(v_old.member_daily_cap_micro * 1.25), c_member_default) then
    raise exception 'Raise the daily caps in steps of at most 25%% (or back to the default).' using errcode = '22023';
  end if;
  update ai_private.settings
     set previous = to_jsonb(v_old) - 'previous',
         active_turn_ceiling = p_active_turn_ceiling,
         matching_daily_cap_micro = p_matching_daily_cap_micro,
         member_daily_cap_micro = p_member_daily_cap_micro,
         updated_at = now(), updated_by = auth.uid(), reason = p_reason
   where id = 1;
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (auth.uid(), 'ai_limits_changed', 'app_config', '00000000-0000-0000-0000-000000000000'::uuid,
          format('ceiling %s→%s, daily %s→%s, member %s→%s: %s', v_old.active_turn_ceiling, p_active_turn_ceiling,
                 v_old.matching_daily_cap_micro, p_matching_daily_cap_micro, v_old.member_daily_cap_micro,
                 p_member_daily_cap_micro, p_reason));
end;
$$;
