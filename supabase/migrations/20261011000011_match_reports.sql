-- S8 gap 18: "Report this match" on each AI result card. Enum reason only,
-- no free text (AI-plan §14.2). Cascades off the turn on purpose: a report
-- is a live-triage signal for the admin AI overview, and turns (with their
-- results, the only thing that makes a report's target_id meaningful) are
-- already purged on the same 7-day lifetime everything else in ai_private
-- uses — there is nothing left to triage once the turn that produced the
-- match is gone.
create table ai_private.match_reports (
  id          uuid primary key default gen_random_uuid(),
  turn_id     uuid not null references ai_private.turns(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('member', 'opportunity')),
  target_id   uuid not null,
  reason      text not null check (reason in ('wrong_skills', 'not_relevant', 'outdated', 'other')),
  created_at  timestamptz not null default now(),
  unique (turn_id, reporter_id, target_id)
);
alter table ai_private.match_reports enable row level security;
revoke all on ai_private.match_reports from public, anon, authenticated, service_role, ai_service, cv_worker;

-- Idempotent by way of the unique index (B7/D3 double-submit rule):
-- reporting the same card twice from a double click succeeds silently.
-- target_id must actually be one of this turn's results, which stops a
-- caller from reporting an arbitrary id under cover of a turn they own.
create or replace function public.ai_report_match(p_turn uuid, p_target_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_turn ai_private.turns;
  v_kind text;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_reason not in ('wrong_skills', 'not_relevant', 'outdated', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select * into v_turn from ai_private.turns t
   where t.id = p_turn and t.owner_id = v_uid and t.expires_at > now() and t.status in ('completed', 'partial');
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_turn.mode in ('recruiter', 'network') then
    select 'member' into v_kind from ai_private.results r
     where r.turn_id = p_turn and r.target_member = p_target_id;
  else
    select 'opportunity' into v_kind from ai_private.results r
     where r.turn_id = p_turn and r.target_opportunity = p_target_id;
  end if;
  if v_kind is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into ai_private.match_reports (turn_id, reporter_id, target_kind, target_id, reason)
  values (p_turn, v_uid, v_kind, p_target_id, p_reason)
  on conflict (turn_id, reporter_id, target_id) do nothing;
end;
$$;
revoke all on function public.ai_report_match(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ai_report_match(uuid, uuid, text) to authenticated;

-- Admin aggregate (§14 Admin visibility, gap 7/8), recreated from the
-- latest definition (20261011000008) with one addition: match report
-- counts by reason over the same rolling 24h window as the rest of the
-- overview.
create or replace function public.admin_ai_overview()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, ai_private
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_overview:'||auth.uid()::text,0));
  if not exists(select 1 from public.admin_actions where admin_id=auth.uid() and action='ai_overview_viewed'
                and created_at>=date_trunc('hour',now())) then
    insert into public.admin_actions(admin_id,action,target_table,target_id)
    values(auth.uid(),'ai_overview_viewed','ai_private.settings','00000000-0000-0000-0000-000000000000');
  end if;
  return jsonb_build_object(
    'refusals_24h', (select coalesce(jsonb_object_agg(reason,n),'{}') from
      (select reason,sum(count) n from ai_private.admission_refusals where hour>=date_trunc('hour',now())-interval '23 hours' group by reason) r),
    'polls_24h', (select coalesce(sum(count),0) from ai_private.poll_counts where hour>=date_trunc('hour',now())-interval '23 hours'),
    'provider_errors_24h', (select jsonb_build_object(
       'timeout',count(*) filter(where outcome='timeout'),
       'rate_limit',count(*) filter(where outcome='rate_limit'),
       'server_error',count(*) filter(where outcome='server_error'),
       'other',count(*) filter(where outcome='provider_error'))
       from ai_private.trace_spans where created_at>now()-interval '24 hours'),
    'queue_wait_ms_24h',(select jsonb_build_object(
       'p50',percentile_cont(0.5) within group(order by extract(epoch from claimed_at-created_at)*1000),
       'p95',percentile_cont(0.95) within group(order by extract(epoch from claimed_at-created_at)*1000))
       from ai_private.turns where created_at>now()-interval '24 hours' and claimed_at is not null),
    'provider_in_flight',(select count(*) from ai_private.spend where status='reserved' and purpose='matching' and created_at>now()-interval '2 minutes'),
    'cost_today',(select jsonb_build_object(
       'reserved',coalesce(sum(reserved_micro) filter(where status in ('reserved','unknown')),0),
       'settled',coalesce(sum(settled_micro) filter(where status='settled'),0),
       'projected',round(coalesce(sum(ai_private.spend_charged(s)),0)*86400/greatest(3600,extract(epoch from now()-(v_day::timestamp at time zone 'utc')))))
       from ai_private.spend s where day=v_day),
    'is_operator', public.is_ai_operator(),
    'flags', jsonb_build_object(
      'ai_enabled', coalesce((select value = 'true' from public.app_config where key = 'ai_enabled'), false),
      'recruiter', coalesce((select value = 'true' from public.app_config where key = 'ai_recruiter_enabled'), false),
      'network', coalesce((select value = 'true' from public.app_config where key = 'ai_network_enabled'), false),
      'opportunities', coalesce((select value = 'true' from public.app_config where key = 'ai_opportunities_enabled'), false)),
    'limits', (select to_jsonb(s) - 'previous' - 'updated_by' from ai_private.settings s where s.id = 1),
    'spend_today', (select jsonb_build_object(
                      'matching', coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching'), 0),
                      'ingestion', coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'ingestion'), 0),
                      'unreconciled', count(*) filter (where s.status in ('reserved', 'unknown')))
                      from ai_private.spend s where s.day = v_day),
    'prices_confirmed', not exists (select 1 from ai_private.model_prices
                                     where model in ('gpt-5.4', 'gpt-5.4-mini', 'text-embedding-3-small')
                                       and not confirmed),
    'turns_24h', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                    from (select t.status, count(*) as n from ai_private.turns t
                           where t.created_at > now() - interval '24 hours' group by t.status) x),
    'outcomes_24h', (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb)
                       from (select t.outcome, count(*) as n from ai_private.turns t
                              where t.created_at > now() - interval '24 hours' and t.outcome is not null
                              group by t.outcome) x),
    'queue', (select jsonb_build_object(
                'queued', count(*) filter (where t.status = 'queued'),
                'running', count(*) filter (where t.status = 'running'),
                'oldest_queued_seconds', extract(epoch from now() - min(t.created_at) filter (where t.status = 'queued'))::int)
                from ai_private.turns t where t.status in ('queued', 'running')),
    'latency_ms_24h', (select jsonb_build_object(
                         'p50', percentile_cont(0.5) within group (order by extract(epoch from t.finished_at - t.created_at) * 1000),
                         'p95', percentile_cont(0.95) within group (order by extract(epoch from t.finished_at - t.created_at) * 1000))
                         from ai_private.turns t
                        where t.created_at > now() - interval '24 hours' and t.status in ('completed', 'partial')),
    'opted_in', jsonb_build_object(
      'recruiter', (select count(*) from ai_private.member_docs where purpose = 'recruiter'),
      'network', (select count(*) from ai_private.member_docs where purpose = 'network')),
    'requirements', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                       from (select r.status, count(*) as n from ai_private.job_requirements r group by r.status) x),
    'jobs_needing_audience', (select count(*) from public.opportunities o
                               where o.status = 'approved' and o.eligible_audience is null
                                 and o.application_deadline >= current_date),
    'match_reports_24h', (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
                             from (select mr.reason, count(*) as n from ai_private.match_reports mr
                                    where mr.created_at > now() - interval '24 hours' group by mr.reason) x),
    'recent_changes', coalesce((
      select jsonb_agg(jsonb_build_object('action', a.action, 'notes', a.notes, 'at', a.created_at) order by a.created_at desc)
        from (select * from public.admin_actions a2
               where a2.action in ('ai_flag_on', 'ai_flag_off', 'ai_limits_changed', 'ai_rebuild_index')
               order by a2.created_at desc limit 10) a), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_ai_overview() from public, anon, authenticated;
grant execute on function public.admin_ai_overview() to authenticated;
