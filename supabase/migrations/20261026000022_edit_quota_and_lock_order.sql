-- ════════════════════════════════════════════════════════════════════
-- Foundry · AI edit quota that deleting a conversation cannot reset, and one lock order
--
--   Q1  The 200-a-day draft-edit cap was counted by summing a counter kept inside each
--       conversation's spec, so deleting a conversation reset it, and two edits in two
--       different conversations at once could both pass at 199. It is now one row per
--       member and day, locked while the edit is validated.
--   L1  A direct write to a child table (profile_skills, opportunity_skills, ...) took its
--       own row first and the parent's lock second (the AFTER trigger bumps edit_version),
--       while the RPCs take the parent first. Touching the same child row from both
--       deadlocked and Postgres aborted one side. A BEFORE trigger now takes the parent
--       lock first for direct writes too, so there is one order everywhere.
--
-- Pre-check: none (new table and triggers). Deploy order: independent.
-- Rollback: re-apply 20261006000004 ai_edit_spec; drop the seven lock triggers, the
-- function and the table.
-- ════════════════════════════════════════════════════════════════════

-- ─── Q1 ──────────────────────────────────────────────────────────────
create table ai_private.edit_counter (
  owner_id uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  n        int  not null default 0,
  primary key (owner_id, day)
);
alter table ai_private.edit_counter enable row level security;
revoke all on table ai_private.edit_counter from public, anon, authenticated;

-- Recreated from 20261006000004 with the same signature. Lock order: the conversation row,
-- then the member's counter row (nothing else takes the counter, so no cycle is possible).
create or replace function public.ai_edit_spec(p_conversation uuid, p_expected_revision integer, p_ops jsonb)
 RETURNS TABLE(spec jsonb, spec_revision integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'ai_private'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_conv ai_private.conversations;
  v_new  jsonb;
  v_edits int;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  select * into v_conv from ai_private.conversations c where c.id = p_conversation and c.owner_id = v_uid for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_conv.spec_revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  if exists (select 1 from ai_private.turns t where t.conversation_id = v_conv.id and t.status in ('queued', 'running')) then
    raise exception 'busy' using errcode = '55006';
  end if;

  -- 200 validated draft edits a day per member (§9), however many conversations they hold or delete.
  insert into ai_private.edit_counter (owner_id, day, n) values (v_uid, current_date, 0)
    on conflict (owner_id, day) do nothing;
  select ec.n into v_edits from ai_private.edit_counter ec where ec.owner_id = v_uid and ec.day = current_date for update;
  if v_edits >= 200 then
    raise exception 'edit_limit' using errcode = '54000';
  end if;

  if p_ops = '[{"op": "undo"}]'::jsonb then
    if v_conv.prev_spec is null then
      raise exception 'nothing_to_undo' using errcode = '22023';
    end if;
    v_new := v_conv.prev_spec;
  elsif p_ops = '[{"op": "confirm_pending"}]'::jsonb then
    raise exception 'invalid_ops' using errcode = '22023';
  else
    v_new := ai_private.apply_spec_ops(v_conv.spec, p_ops, v_conv.mode, null, null, null, true);
  end if;

  -- Counted only once the edit has validated, as before.
  update ai_private.edit_counter ec set n = ec.n + 1 where ec.owner_id = v_uid and ec.day = current_date;
  delete from ai_private.edit_counter ec where ec.owner_id = v_uid and ec.day < current_date;

  update ai_private.conversations
     set prev_spec = case when p_ops = '[{"op": "undo"}]'::jsonb then null else v_conv.spec end,
         spec = v_new, spec_revision = v_conv.spec_revision + 1, pending_ops = null,
         last_activity_at = now()
   where id = v_conv.id;

  return query select ai_private.spec_for_display(v_new), v_conv.spec_revision + 1;
end;
$function$;

-- ─── L1 ──────────────────────────────────────────────────────────────
-- Same parent selection as tg_related_edit_version, but only a lock. Fires before the row
-- is touched. FOR NO KEY UPDATE is the strength the AFTER trigger's own UPDATE takes (so nothing new
-- conflicts with the foreign-key checks of unrelated inserts) and it still queues behind the
-- RPCs' FOR UPDATE, which is the point.
create or replace function public.tg_lock_related_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if tg_table_name = 'listing_edits' then
    if r->>'listing_kind' = 'event' then
      perform 1 from public.events where id = (r->>'listing_id')::uuid for no key update;
    elsif r->>'listing_kind' = 'opportunity' then
      perform 1 from public.opportunities where id = (r->>'listing_id')::uuid for no key update;
    else
      perform 1 from public.vcs_grants where id = (r->>'listing_id')::uuid for no key update;
    end if;
  elsif tg_table_name like 'profile_%' then
    perform 1 from public.profiles where id = (r->>'profile_id')::uuid for no key update;
  else
    perform 1 from public.opportunities where id = (r->>'opportunity_id')::uuid for no key update;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.tg_lock_related_parent() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['profile_skills','profile_sectors','profile_interests','profile_intents',
                           'opportunity_skills','opportunity_sectors','listing_edits']
  loop
    execute format('create trigger a_lock_related_parent before insert or update or delete on public.%I '
                   'for each row execute function public.tg_lock_related_parent()', t);
  end loop;
end $$;
