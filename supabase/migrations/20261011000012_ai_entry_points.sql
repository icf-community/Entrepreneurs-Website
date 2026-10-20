-- S8 gap 20: AI entry points from /members and /opportunities. The current
-- directory filters become a visible draft on /foundry-ai, but the no-
-- criteria-in-URLs rule (AI-plan.md "no criteria in URLs") means the
-- /foundry-ai link itself can carry only an opaque, single-use, owner-
-- scoped reference — never the filter values themselves. This table is
-- that reference: short-lived (10-minute read window, hourly purge),
-- deleted the moment it is read.
create table ai_private.draft_handoffs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  mode       text not null check (mode in ('network', 'opportunities')),
  filters    jsonb not null,
  created_at timestamptz not null default now()
);
alter table ai_private.draft_handoffs enable row level security;
revoke all on ai_private.draft_handoffs from public, anon, authenticated, service_role, ai_service, cv_worker;

create or replace function public.ai_create_draft_handoff(p_mode text, p_filters jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_id uuid;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_mode not in ('network', 'opportunities') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filters) <> 'object' or length(p_filters::text) > 2000 then
    raise exception 'invalid_filters' using errcode = '22023';
  end if;
  insert into ai_private.draft_handoffs (owner_id, mode, filters)
  values (auth.uid(), p_mode, p_filters)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.ai_create_draft_handoff(text, jsonb) from public, anon, authenticated;
grant execute on function public.ai_create_draft_handoff(text, jsonb) to authenticated;

-- One-time read: the row is gone whether or not it was within the window,
-- so a second /foundry-ai load with the same link in history shows nothing
-- rather than resurrecting a stale draft.
create or replace function public.ai_consume_draft_handoff(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_filters jsonb;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  delete from ai_private.draft_handoffs
   where id = p_id and owner_id = auth.uid() and created_at > now() - interval '10 minutes'
  returning filters into v_filters;
  return v_filters;
end;
$$;
revoke all on function public.ai_consume_draft_handoff(uuid) from public, anon, authenticated;
grant execute on function public.ai_consume_draft_handoff(uuid) to authenticated;

-- Recreated from the latest definition (20261006000004): one added line so
-- an abandoned handoff (never consumed, link never clicked through) can't
-- accumulate forever.
create or replace function ai_private.cron_purge()
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  delete from ai_private.messages where expires_at <= now();
  delete from ai_private.turns where expires_at <= now();
  delete from ai_private.saved_scans where expires_at <= now();
  -- A conversation with no live message and nothing running is gone; one
  -- that still has live messages keeps only criteria whose sources live.
  delete from ai_private.conversations c
   where c.last_activity_at < now() - interval '168 hours'
     and not exists (select 1 from ai_private.messages m where m.conversation_id = c.id)
     and not exists (select 1 from ai_private.turns t where t.conversation_id = c.id);
  update ai_private.conversations c
     set spec = ai_private.effective_spec(c.spec), spec_revision = c.spec_revision + 1,
         prev_spec = case when c.prev_spec is null then null else ai_private.effective_spec(c.prev_spec) end
   where jsonb_array_length(c.spec->'atoms') <> jsonb_array_length(ai_private.effective_spec(c.spec)->'atoms')
     and not exists (select 1 from ai_private.turns t where t.conversation_id = c.id and t.status in ('queued', 'running'));
  delete from ai_private.assessments where expires_at <= now();
  delete from ai_private.query_embeddings where expires_at <= now();
  delete from ai_private.trace_spans where turn_id is null and created_at < now() - interval '7 days';
  delete from ai_private.usage_events where created_at < now() - interval '25 hours';
  delete from ai_private.surfaced_members where surfaced_at < now() - interval '25 hours';
  delete from ai_private.draft_handoffs where created_at < now() - interval '1 hour';
end;
$$;
revoke all on function ai_private.cron_purge() from public;
