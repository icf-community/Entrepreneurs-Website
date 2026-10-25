-- Security audit fix (2026-10-25), finding #3.
--
-- ai_submit_turn already computes v_unconfirmed (bool_or(not mp.confirmed)
-- over the models its budget estimate prices) but never reads it again —
-- a real exception would have already raised a visible error, so an
-- unconfirmed placeholder price (every new model row is inserted
-- confirmed=false until the owner checks it against OpenAI's pricing page)
-- silently governs the real spend caps instead of blocking admission until
-- it's confirmed. This also fixes admin_ai_overview's prices_confirmed
-- check, which still names 'gpt-5.4' (retired by 20261011000014) instead of
-- 'gpt-6.1-sol', so it could never have reflected the actual unconfirmed row
-- either.

alter table ai_private.admission_refusals drop constraint admission_refusals_reason_check;
alter table ai_private.admission_refusals add constraint admission_refusals_reason_check
  check (reason in ('budget_exhausted','busy','disabled','idempotency_conflict','invalid_message',
                     'job_not_eligible','named_person','not_found','nothing_to_confirm','price_unconfirmed',
                     'queue_full','rate_day','rate_minute','requirements_unconfirmed','rescan_cooldown',
                     'rescan_limit','stale_revision','surface_limit','thread_full','too_many_threads'));

-- ─── ai_submit_turn: fail closed on an unconfirmed price ──────────────
-- Identical to 20261011000014's definition except for the new
-- v_unconfirmed check immediately after it's computed.
CREATE OR REPLACE FUNCTION public.ai_submit_turn(p_mode text, p_conversation uuid, p_opportunity uuid, p_kind text, p_message text, p_idempotency_key text, p_expected_revision integer, p_temporary boolean DEFAULT false)
 RETURNS TABLE(turn_id uuid, conversation_id uuid, outcome text, retry_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'ai_private'
AS $$
declare
  v_uid       uuid := auth.uid();
  v_conv      ai_private.conversations;
  v_cfg       ai_private.settings;
  v_msg       text;
  v_digest    text;
  v_existing  ai_private.turns;
  v_count     int;
  v_oldest    timestamptz;
  v_surfaced  int;
  v_msg_id    uuid;
  v_turn      uuid;
  v_estimate  bigint;
  v_spent     bigint;
  v_member    bigint;
  v_day       date := (now() at time zone 'utc')::date;
  v_tomorrow  timestamptz := ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
  v_unconfirmed boolean;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_mode not in ('recruiter', 'network', 'opportunities') or p_kind not in ('message', 'run', 'confirm', 'rescan') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Cheap checks first; nothing below writes until every check passes.
  v_msg := nullif(btrim(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]', ' ', 'g')), '');
  if p_kind = 'message' and (v_msg is null or char_length(v_msg) > 600) then
    perform ai_private.record_admission_refusal('invalid_message');
    return query select null::uuid, p_conversation, 'invalid_message'::text, null::timestamptz;
    return;
  end if;
  if p_kind <> 'message' then
    v_msg := null;
  end if;

  -- One admission at a time per member, held to commit: concurrent tabs
  -- or retries cannot each see the same counts and all pass the per-member
  -- limits, and a repeated idempotency key finds the first turn instead of
  -- racing it to the unique constraint.
  perform pg_advisory_xact_lock(hashtext('ai_submit_member'), hashtext(v_uid::text));

  v_digest := encode(sha256(convert_to(concat_ws('|', p_mode, p_conversation, p_opportunity, p_kind, v_msg,
                                                 p_expected_revision, p_temporary), 'utf8')), 'hex');
  select * into v_existing from ai_private.turns t where t.owner_id = v_uid and t.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.body_digest = v_digest then
      return query select v_existing.id, v_existing.conversation_id, 'duplicate'::text, null::timestamptz;
    else
      perform ai_private.record_admission_refusal('idempotency_conflict');
      return query select null::uuid, p_conversation, 'idempotency_conflict'::text, null::timestamptz;
    end if;
    return;
  end if;

  if not public.ai_mode_enabled(p_mode) then
    perform ai_private.record_admission_refusal('disabled');
    return query select null::uuid, p_conversation, 'disabled'::text, null::timestamptz;
    return;
  end if;

  if p_mode = 'recruiter' then
    if p_opportunity is null or not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
      perform ai_private.record_admission_refusal('job_not_eligible');
      return query select null::uuid, p_conversation, 'job_not_eligible'::text, null::timestamptz;
      return;
    end if;
    if not exists (select 1 from ai_private.job_requirements r join public.opportunities o on o.id = r.opportunity_id
                    where r.opportunity_id = p_opportunity and r.status = 'confirmed'
                      and r.content_version = o.content_version) then
      perform ai_private.record_admission_refusal('requirements_unconfirmed');
      return query select null::uuid, p_conversation, 'requirements_unconfirmed'::text, null::timestamptz;
      return;
    end if;
  elsif p_opportunity is not null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Conversation: existing (owner, mode and job must match; compare-and-
  -- swap on the spec revision) or a new one.
  if p_conversation is not null then
    select * into v_conv from ai_private.conversations c
     where c.id = p_conversation and c.owner_id = v_uid for update;
    if not found or v_conv.mode <> p_mode or v_conv.opportunity_id is distinct from p_opportunity then
      perform ai_private.record_admission_refusal('not_found');
      return query select null::uuid, p_conversation, 'not_found'::text, null::timestamptz;
      return;
    end if;
    if v_conv.spec_revision <> coalesce(p_expected_revision, -1) then
      perform ai_private.record_admission_refusal('stale_revision');
      return query select null::uuid, p_conversation, 'stale_revision'::text, null::timestamptz;
      return;
    end if;
    if (select count(*) from ai_private.turns t where t.conversation_id = v_conv.id and t.expires_at > now()
          and t.status in ('completed', 'partial', 'refused', 'clarify', 'failed', 'queued', 'running')) >= 15 then
      perform ai_private.record_admission_refusal('thread_full');
      return query select null::uuid, v_conv.id, 'thread_full'::text, null::timestamptz;
      return;
    end if;
    if p_kind = 'confirm' and v_conv.pending_ops is null then
      perform ai_private.record_admission_refusal('nothing_to_confirm');
      return query select null::uuid, v_conv.id, 'nothing_to_confirm'::text, null::timestamptz;
      return;
    end if;
  else
    if p_kind not in ('message') then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    if (select count(*) from ai_private.conversations c
         where c.owner_id = v_uid
           and exists (select 1 from ai_private.messages m where m.conversation_id = c.id and m.expires_at > now())) >= 5 then
      perform ai_private.record_admission_refusal('too_many_threads');
      return query select null::uuid, null::uuid, 'too_many_threads'::text, null::timestamptz;
      return;
    end if;
  end if;

  -- Concurrency: one running turn per conversation, two per member.
  if p_conversation is not null and exists (select 1 from ai_private.turns t
                where t.conversation_id = p_conversation and t.status in ('queued', 'running')) then
    perform ai_private.record_admission_refusal('busy');
    return query select null::uuid, p_conversation, 'busy'::text, null::timestamptz;
    return;
  end if;
  if (select count(*) from ai_private.turns t where t.owner_id = v_uid and t.status in ('queued', 'running')) >= 2 then
    perform ai_private.record_admission_refusal('busy');
    return query select null::uuid, p_conversation, 'busy'::text, null::timestamptz;
    return;
  end if;

  -- Rates: 5 a minute, 40 a rolling day, shared by every mode (§9).
  select count(*), min(u.created_at) into v_count, v_oldest
    from ai_private.usage_events u where u.owner_id = v_uid and u.created_at > now() - interval '1 minute';
  if v_count >= 5 then
    perform ai_private.record_admission_refusal('rate_minute');
    return query select null::uuid, p_conversation, 'rate_minute'::text, v_oldest + interval '1 minute';
    return;
  end if;
  select count(*), min(u.created_at) into v_count, v_oldest
    from ai_private.usage_events u where u.owner_id = v_uid and u.created_at > now() - interval '24 hours';
  if v_count >= 40 then
    perform ai_private.record_admission_refusal('rate_day');
    return query select null::uuid, p_conversation, 'rate_day'::text, v_oldest + interval '24 hours';
    return;
  end if;

  -- Rescans (§8.1): five-minute cooldown, ten a day per job.
  if p_kind = 'rescan' then
    if p_mode <> 'recruiter' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    select count(*), max(u.created_at) into v_count, v_oldest
      from ai_private.usage_events u
     where u.owner_id = v_uid and u.kind = 'rescan:' || p_opportunity::text
       and u.created_at > now() - interval '24 hours';
    if v_oldest is not null and v_oldest > now() - interval '5 minutes' then
      perform ai_private.record_admission_refusal('rescan_cooldown');
      return query select null::uuid, p_conversation, 'rescan_cooldown'::text, v_oldest + interval '5 minutes';
      return;
    end if;
    if v_count >= 10 then
      perform ai_private.record_admission_refusal('rescan_limit');
      return query select null::uuid, p_conversation, 'rescan_limit'::text, now() + interval '24 hours';
      return;
    end if;
  end if;

  -- Distinct members surfaced, checked before any money is reserved (F7).
  if p_mode in ('recruiter', 'network') then
    select count(*) into v_surfaced
      from ai_private.surfaced_members sm
     where sm.owner_id = v_uid and sm.surfaced_at > now() - interval '24 hours';
    -- Each in-flight recruiter/network turn may still surface up to 10
    -- members; a member may have two in flight, and checking only this
    -- turn's 10 let the pair pass at 135 and publish 20 (R1).
    select count(*) into v_count
      from ai_private.turns t
     where t.owner_id = v_uid and t.status in ('queued', 'running') and t.mode in ('recruiter', 'network');
    if v_surfaced + 10 * (v_count + 1) > 150 then
      perform ai_private.record_admission_refusal('surface_limit');
      return query select null::uuid, p_conversation, 'surface_limit'::text, now() + interval '24 hours';
      return;
    end if;
  end if;

  -- Queue bound (§9): refuse before any provider call, keep the draft.
  -- Serialised across members from here to commit, so a burst can't all
  -- read the same queue length; the lock is held only for the few
  -- milliseconds left in this transaction.
  perform pg_advisory_xact_lock(hashtext('ai_submit_queue'));
  select * into v_cfg from ai_private.settings where id = 1;
  if (select count(*) from ai_private.turns t where t.status = 'queued') >= v_cfg.queue_capacity then
    perform ai_private.record_admission_refusal('queue_full');
    return query select null::uuid, p_conversation, 'queue_full'::text, now() + interval '1 minute';
    return;
  end if;

  -- Budget headroom for this turn's worst case: interpreter + four
  -- assessors + one embedding, at current prices. Reservations happen
  -- per call in the executor; this only refuses a turn that cannot fit.
  -- gpt-6.1-sol is the recruiter assessor's replacement for gpt-5.4, not
  -- an additional model in play — summing both would price a turn as if
  -- it called both assessors, roughly doubling the estimate.
  select bool_or(not mp.confirmed),
         coalesce(sum(case mp.model
                        when 'gpt-5.4-mini' then (6000 * mp.input_micro_per_mtok + 1500 * mp.output_micro_per_mtok)
                        when 'gpt-6.1-sol' then 4 * (12000 * mp.input_micro_per_mtok + 3000 * mp.output_micro_per_mtok)
                        when 'text-embedding-3-small' then 2000 * mp.input_micro_per_mtok
                      end), 0) / 1000000
    into v_unconfirmed, v_estimate
    from ai_private.model_prices mp
   where mp.model in ('gpt-5.4-mini', 'gpt-6.1-sol', 'text-embedding-3-small');
  -- Fail closed: a placeholder price (every new model row starts
  -- confirmed=false until the owner checks it against OpenAI's pricing
  -- page) must not silently govern a real spend cap — refuse admission
  -- until it's confirmed, same as every other admission check here.
  if v_unconfirmed then
    perform ai_private.record_admission_refusal('price_unconfirmed');
    return query select null::uuid, p_conversation, 'price_unconfirmed'::text, null::timestamptz;
    return;
  end if;
  select coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching'), 0),
         coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching' and s.member_id = v_uid), 0)
    into v_spent, v_member
    from ai_private.spend s where s.day = v_day;
  if v_spent + v_estimate > v_cfg.matching_daily_cap_micro or v_member + v_estimate > v_cfg.member_daily_cap_micro then
    perform ai_private.record_admission_refusal('budget_exhausted');
    return query select null::uuid, p_conversation, 'budget_exhausted'::text, v_tomorrow;
    return;
  end if;

  -- No names as search criteria (§1): a member's full name in the
  -- message is refused, and the text is not stored.
  if v_msg is not null and exists (
       select 1 from public.profiles p
        where p.status = 'approved' and length(p.first_name) > 1 and length(p.surname) > 1
          and lower(v_msg) like '%' || lower(p.first_name || ' ' || p.surname) || '%') then
    perform ai_private.record_admission_refusal('named_person');
    return query select null::uuid, p_conversation, 'named_person'::text, null::timestamptz;
    return;
  end if;

  -- Admitted.
  if p_conversation is null then
    insert into ai_private.conversations (owner_id, mode, opportunity_id, temporary, title, spec)
    values (v_uid, p_mode, p_opportunity, coalesce(p_temporary, false),
            left(ai_private.redact_contact(v_msg), 60),
            case when p_mode = 'recruiter'
                 then (select jsonb_build_object('schema_version', 1, 'next_id', 100,
                                                 'atoms', coalesce(r.confirmed, '[]'::jsonb))
                         from ai_private.job_requirements r where r.opportunity_id = p_opportunity)
                 else '{"schema_version": 1, "atoms": [], "next_id": 1}'::jsonb end)
    returning * into v_conv;
  end if;

  if v_msg is not null then
    insert into ai_private.messages (conversation_id, owner_id, role, kind, body)
    values (v_conv.id, v_uid, 'member', 'message', left(ai_private.redact_contact(v_msg), 700))
    returning id into v_msg_id;
  end if;

  insert into ai_private.turns (conversation_id, owner_id, mode, opportunity_id, kind, message_id,
                                idempotency_key, body_digest, expected_revision, stage)
  values (v_conv.id, v_uid, p_mode, p_opportunity, p_kind, v_msg_id, p_idempotency_key, v_digest,
          v_conv.spec_revision, 'queued')
  returning id into v_turn;

  update ai_private.messages set turn_id = v_turn where id = v_msg_id;
  update ai_private.conversations set last_activity_at = now() where id = v_conv.id;
  insert into ai_private.usage_events (owner_id, mode, kind)
  values (v_uid, p_mode, case when p_kind = 'rescan' then 'rescan:' || p_opportunity::text else p_kind end);

  return query select v_turn, v_conv.id, 'queued'::text, null::timestamptz;
end;
$$;

revoke all on function public.ai_submit_turn(text, uuid, uuid, text, text, text, int, boolean) from public, anon, authenticated;
grant execute on function public.ai_submit_turn(text, uuid, uuid, text, text, text, int, boolean) to authenticated;

-- ─── admin_ai_overview: fix the stale gpt-5.4 price check ─────────────
-- Identical to 20261011000011's definition except prices_confirmed now
-- names the models actually priced by ai_submit_turn's budget estimate
-- (gpt-5.4 was retired by 20261011000014; gpt-6.1-sol replaced it, and
-- was never added here, so this could never have reflected the real
-- unconfirmed row either).
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
                                     where model in ('gpt-5.4-mini', 'gpt-6.1-sol', 'text-embedding-3-small')
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
