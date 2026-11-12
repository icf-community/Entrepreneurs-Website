-- AI races and the missing token ceiling (programme S1).
--
-- Each fix was found by server/tests/integration/test_ai_races.py, which
-- forces the interleaving and failed on the previous definitions. Every
-- function is recreated from its latest definition (20261006000004).
--
--   R1  Two in-flight turns per member, but admission reserved surfaced
--       headroom for one: at 135 surfaced both were admitted and could
--       publish 20. Admission now counts in-flight turns; publication is
--       serialised per viewer and stops at 150.
--   R3  A cancel that arrived during assessment still published results
--       once the in-flight calls returned. exec_publish now refuses.
--   R9  Confirming a job's requirements stamped whatever list the poster
--       was shown as current, even when an approved edit had changed the
--       job since, or the list was parsed from older text. Confirm now
--       refuses (requirements_outdated); the panel sends the version it
--       showed. Signature change, so dropped and recreated (F21).
--   Appendix A's 200k tokens per member per day (secondary to money) was
--   never enforced. exec_reserve now checks it under the ledger lock.

alter table ai_private.settings
  add column member_daily_token_cap int not null default 200000
    check (member_daily_token_cap between 1000 and 10000000);

-- ai_submit_turn: reserve surfaced headroom for every turn already in flight (R1).

create or replace function public.ai_submit_turn(
  p_mode               text,
  p_conversation       uuid,
  p_opportunity        uuid,
  p_kind               text,
  p_message            text,
  p_idempotency_key    text,
  p_expected_revision  int,
  p_temporary          boolean default false
)
returns table (turn_id uuid, conversation_id uuid, outcome text, retry_at timestamptz)
language plpgsql
security definer
set search_path = public, ai_private
as $$
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
      return query select null::uuid, p_conversation, 'idempotency_conflict'::text, null::timestamptz;
    end if;
    return;
  end if;

  if not public.ai_mode_enabled(p_mode) then
    return query select null::uuid, p_conversation, 'disabled'::text, null::timestamptz;
    return;
  end if;

  if p_mode = 'recruiter' then
    if p_opportunity is null or not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
      return query select null::uuid, p_conversation, 'job_not_eligible'::text, null::timestamptz;
      return;
    end if;
    if not exists (select 1 from ai_private.job_requirements r join public.opportunities o on o.id = r.opportunity_id
                    where r.opportunity_id = p_opportunity and r.status = 'confirmed'
                      and r.content_version = o.content_version) then
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
      return query select null::uuid, p_conversation, 'not_found'::text, null::timestamptz;
      return;
    end if;
    if v_conv.spec_revision <> coalesce(p_expected_revision, -1) then
      return query select null::uuid, p_conversation, 'stale_revision'::text, null::timestamptz;
      return;
    end if;
    if (select count(*) from ai_private.turns t where t.conversation_id = v_conv.id and t.expires_at > now()
          and t.status in ('completed', 'partial', 'refused', 'clarify', 'failed', 'queued', 'running')) >= 15 then
      return query select null::uuid, v_conv.id, 'thread_full'::text, null::timestamptz;
      return;
    end if;
    if p_kind = 'confirm' and v_conv.pending_ops is null then
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
      return query select null::uuid, null::uuid, 'too_many_threads'::text, null::timestamptz;
      return;
    end if;
  end if;

  -- Concurrency: one running turn per conversation, two per member.
  if p_conversation is not null and exists (select 1 from ai_private.turns t
                where t.conversation_id = p_conversation and t.status in ('queued', 'running')) then
    return query select null::uuid, p_conversation, 'busy'::text, null::timestamptz;
    return;
  end if;
  if (select count(*) from ai_private.turns t where t.owner_id = v_uid and t.status in ('queued', 'running')) >= 2 then
    return query select null::uuid, p_conversation, 'busy'::text, null::timestamptz;
    return;
  end if;

  -- Rates: 5 a minute, 40 a rolling day, shared by every mode (§9).
  select count(*), min(u.created_at) into v_count, v_oldest
    from ai_private.usage_events u where u.owner_id = v_uid and u.created_at > now() - interval '1 minute';
  if v_count >= 5 then
    return query select null::uuid, p_conversation, 'rate_minute'::text, v_oldest + interval '1 minute';
    return;
  end if;
  select count(*), min(u.created_at) into v_count, v_oldest
    from ai_private.usage_events u where u.owner_id = v_uid and u.created_at > now() - interval '24 hours';
  if v_count >= 40 then
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
      return query select null::uuid, p_conversation, 'rescan_cooldown'::text, v_oldest + interval '5 minutes';
      return;
    end if;
    if v_count >= 10 then
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
    return query select null::uuid, p_conversation, 'queue_full'::text, now() + interval '1 minute';
    return;
  end if;

  -- Budget headroom for this turn's worst case: interpreter + four
  -- assessors + one embedding, at current prices. Reservations happen
  -- per call in the executor; this only refuses a turn that cannot fit.
  select bool_or(not mp.confirmed),
         coalesce(sum(case mp.model
                        when 'gpt-5.4-mini' then (6000 * mp.input_micro_per_mtok + 1500 * mp.output_micro_per_mtok)
                        when 'gpt-5.4' then 4 * (12000 * mp.input_micro_per_mtok + 3000 * mp.output_micro_per_mtok)
                        when 'text-embedding-3-small' then 2000 * mp.input_micro_per_mtok
                      end), 0) / 1000000
    into v_unconfirmed, v_estimate
    from ai_private.model_prices mp
   where mp.model in ('gpt-5.4-mini', 'gpt-5.4', 'text-embedding-3-small');
  select coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching'), 0),
         coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching' and s.member_id = v_uid), 0)
    into v_spent, v_member
    from ai_private.spend s where s.day = v_day;
  if v_spent + v_estimate > v_cfg.matching_daily_cap_micro or v_member + v_estimate > v_cfg.member_daily_cap_micro then
    return query select null::uuid, p_conversation, 'budget_exhausted'::text, v_tomorrow;
    return;
  end if;

  -- No names as search criteria (§1): a member's full name in the
  -- message is refused, and the text is not stored.
  if v_msg is not null and exists (
       select 1 from public.profiles p
        where p.status = 'approved' and length(p.first_name) > 1 and length(p.surname) > 1
          and lower(v_msg) like '%' || lower(p.first_name || ' ' || p.surname) || '%') then
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

-- exec_publish: no results after a cancel (R3), never surface past 150 (R1).

create or replace function ai_private.exec_publish(
  p_turn uuid, p_lease uuid, p_fence bigint, p_spec_revision int, p_results jsonb, p_partial boolean
)
returns int
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v      ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_conv ai_private.conversations;
  r      jsonb;
  v_slot int := 0;
  v_target uuid;
  v_body text;
begin
  if v.fence <> p_fence then
    raise exception 'stale_lease' using errcode = 'P0001';
  end if;
  -- A cancel that arrives while assessments are in flight: what they cost
  -- is settled, but nothing is shown (R3).
  if v.cancel_requested then
    raise exception 'cancelled' using errcode = 'P0001';
  end if;
  select * into v_conv from ai_private.conversations where id = v.conversation_id;
  if v_conv.spec_revision <> p_spec_revision then
    raise exception 'stale_revision' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 10 then
    raise exception 'invalid_results' using errcode = '22023';
  end if;

  -- One publication per viewer at a time, so the surfaced cap below is
  -- exact even with two turns finishing together (R1).
  perform pg_advisory_xact_lock(hashtext('ai_surface'), hashtext(v.owner_id::text));

  delete from ai_private.results where turn_id = v.id;
  for r in select * from jsonb_array_elements(p_results) loop
    v_target := (r->>'target')::uuid;
    if v.mode in ('recruiter', 'network') then
      continue when not exists (select 1 from ai_private.turn_candidates c
                                 where c.turn_id = v.id and c.target_member = v_target);
      continue when not ai_private.member_candidate_ok(v.owner_id, v.mode, v_target, v.opportunity_id, v_conv.spec);
      -- A profile that changed while it was being assessed is left out
      -- rather than shown with a score for evidence it no longer has.
      continue when (select d.projection_hash from ai_private.member_docs d
                      where d.member_id = v_target and d.purpose = v.mode) is distinct from (r->>'projection_hash');
      -- A member not already surfaced today counts against the 150 (R1).
      continue when not exists (select 1 from ai_private.surfaced_members sm
                                 where sm.owner_id = v.owner_id and sm.member_id = v_target
                                   and sm.surfaced_at > now() - interval '24 hours')
                and (select count(*) from ai_private.surfaced_members sm
                      where sm.owner_id = v.owner_id and sm.surfaced_at > now() - interval '24 hours') >= 150;
      v_slot := v_slot + 1;
      insert into ai_private.surfaced_members as sm (owner_id, member_id) values (v.owner_id, v_target)
      on conflict (owner_id, member_id) do update set surfaced_at = now();
      insert into ai_private.results (turn_id, slot, target_member, score, tier, exact_tier, coverage, components,
                                      evidence_ids, projection_hash)
      values (v.id, v_slot, v_target, (r->>'score')::int, r->>'tier', coalesce((r->>'exact_tier')::int, 0),
              coalesce(r->'coverage', '[]'::jsonb), coalesce(r->'components', '{}'::jsonb),
              -- Evidence ids must belong to this candidate (§7).
              array(select e.id from ai_private.member_evidence e
                     where e.member_id = v_target and e.purpose = v.mode
                       and e.id in (select x::bigint from jsonb_array_elements_text(coalesce(r->'evidence_ids', '[]'::jsonb)) x)),
              (select d.projection_hash from ai_private.member_docs d where d.member_id = v_target and d.purpose = v.mode));
    else
      continue when not exists (select 1 from ai_private.turn_candidates c
                                 where c.turn_id = v.id and c.target_opportunity = v_target);
      continue when not ai_private.job_candidate_ok(v.owner_id, v_target);
      v_slot := v_slot + 1;
      insert into ai_private.results (turn_id, slot, target_opportunity, score, tier, exact_tier, coverage, components,
                                      projection_hash)
      values (v.id, v_slot, v_target, (r->>'score')::int, r->>'tier', coalesce((r->>'exact_tier')::int, 0),
              coalesce(r->'coverage', '[]'::jsonb),
              coalesce(r->'components', '{}'::jsonb)
                || jsonb_build_object('content_version', (select j.content_version from ai_private.job_docs j
                                                           where j.opportunity_id = v_target)),
              (select j.content_version::text from ai_private.job_docs j where j.opportunity_id = v_target));
    end if;
  end loop;

  v_body := case
    when v_slot = 0 and v.mode = 'recruiter'
      then 'No matches yet. Few members have opted in to recruiter search so far.'
    when v_slot = 0 then 'No matches for these criteria. Try fewer must-haves.'
    when v_slot = 1 then '1 match.'
    else v_slot || ' matches.'
  end || case when p_partial then ' Some profiles couldn''t be checked this time.' else '' end;
  insert into ai_private.messages (conversation_id, owner_id, role, kind, body, turn_id)
  values (v.conversation_id, v.owner_id, 'system', 'results', v_body, v.id);

  update ai_private.turns
     set status = case when p_partial then 'partial' else 'completed' end, outcome = null, stage = 'done',
         result_count = v_slot, finished_at = now(), lease_token = null, revision = revision + 1
   where id = v.id;
  update ai_private.conversations set last_activity_at = now() where id = v.conversation_id;
  return v_slot;
end;
$$;

-- exec_reserve: the per-member token ceiling (Appendix A: 200k a day, secondary to money).

create or replace function ai_private.exec_reserve(p_turn uuid, p_lease uuid, p_stage text, p_model text,
                                                   p_max_in int, p_max_out int)
returns uuid
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_cfg ai_private.settings;
  v_id uuid;
begin
  if v.cancel_requested then
    raise exception 'cancelled' using errcode = 'P0001';
  end if;
  if now() > v.deadline_at then
    raise exception 'deadline' using errcode = 'P0001';
  end if;
  select * into v_cfg from ai_private.settings where id = 1;
  -- In-flight provider requests have their own cap, separate from active
  -- turns (F3). Counted under the ledger's own lock (spend_reserve takes
  -- the same one), so concurrent batches can't all pass the count.
  perform pg_advisory_xact_lock(hashtext('ai_private.spend'));
  if (select count(*) from ai_private.spend s
       where s.status = 'reserved' and s.purpose = 'matching' and s.created_at > now() - interval '2 minutes')
     >= v_cfg.provider_request_ceiling then
    raise exception 'provider_busy' using errcode = 'P0001';
  end if;
  -- Tokens per member per UTC day, counted at their reserved upper bound
  -- (settled rows at actual use), under the same lock as the money caps.
  if coalesce((select sum(case when s.status = 'settled' then coalesce(s.input_tokens, 0) + coalesce(s.output_tokens, 0)
                                else s.max_input_tokens + s.max_output_tokens end)
                 from ai_private.spend s
                where s.member_id = v.owner_id and s.purpose = 'matching' and s.status <> 'released'
                  and s.day = (now() at time zone 'utc')::date), 0)
     + p_max_in + p_max_out > v_cfg.member_daily_token_cap then
    raise exception 'budget_exhausted: member_tokens' using errcode = 'P0001';
  end if;
  v_id := ai_private.spend_reserve('matching', v.mode, v.owner_id, v.id, null, p_stage, p_model, p_max_in, p_max_out);
  update ai_private.turns set provider_calls = provider_calls + 1 where id = p_turn;
  return v_id;
end;
$$;

-- ai_get_job_requirements: also return the job version the requirements are for (R9).

create or replace function public.ai_get_job_requirements(p_opportunity uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
    return null;
  end if;
  return (
    select jsonb_build_object(
             'status', case when r.content_version = o.content_version then r.status else 'pending' end,
             'role_level', r.role_level,
             'atoms', ai_private.spec_for_display(jsonb_build_object('atoms',
                        coalesce(case when r.status = 'confirmed' then r.confirmed else r.parsed end, '[]'::jsonb)))->'atoms',
             'confirmed_at', r.confirmed_at,
             'content_version', o.content_version)
      from public.opportunities o
      left join ai_private.job_requirements r on r.opportunity_id = o.id
     where o.id = p_opportunity);
end;
$$;

-- ai_confirm_job_requirements: refuse confirming requirements for an older version of the job (R9).

drop function public.ai_confirm_job_requirements(uuid, jsonb);

create function public.ai_confirm_job_requirements(p_opportunity uuid, p_atoms jsonb, p_expected_version int default null)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_req  ai_private.job_requirements;
  v_ver  int;
  v_ops  jsonb := '[]'::jsonb;
  a      jsonb;
  v_spec jsonb;
begin
  if not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
    raise exception 'job_not_eligible' using errcode = '42501';
  end if;
  -- for share: the job cannot change under the confirmation (R9).
  select content_version into v_ver from public.opportunities where id = p_opportunity for share;
  select * into v_req from ai_private.job_requirements where opportunity_id = p_opportunity for update;
  -- The poster confirms what they were shown. If the job changed since
  -- (an approved edit) or its requirements were parsed from an older
  -- version, confirming would stamp outdated criteria as current.
  if (p_expected_version is not null and p_expected_version <> v_ver)
     or (v_req.opportunity_id is not null and v_req.content_version <> v_ver
         and exists (select 1 from jsonb_array_elements(p_atoms) x_atom where x_atom ? 'id')) then
    raise exception 'requirements_outdated' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_atoms) <> 'array' or jsonb_array_length(p_atoms) > 12 then
    raise exception 'invalid_requirements' using errcode = '22023';
  end if;

  -- Each confirmed atom is either a parsed one (by id, free text kept as
  -- the job states it) or a dictionary concept.
  for a in select * from jsonb_array_elements(p_atoms) loop
    if a ? 'id' then
      select x || jsonb_build_object('required', coalesce((a->>'required')::boolean, (x->>'required')::boolean, false))
        into a
        from jsonb_array_elements(coalesce(v_req.parsed, '[]'::jsonb)) x where x->>'id' = a->>'id';
      if a is null then
        raise exception 'invalid_requirements' using errcode = '22023';
      end if;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'add', 'kind', a->>'kind', 'concept', a->>'concept',
                                                             'free_text', a->>'free_text', 'required', a->'required',
                                                             'group', a->>'group'));
    else
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'add', 'kind', coalesce(a->>'kind', 'tool'),
                                                             'concept', a->>'concept', 'required', a->'required'));
    end if;
  end loop;

  v_spec := ai_private.apply_spec_ops(null, v_ops, 'recruiter', null, null, null, true);
  -- Job criteria are not chat memory: they follow the job, not the
  -- seven-day chat lifetime.
  v_spec := jsonb_set(v_spec, '{atoms}', coalesce((
    select jsonb_agg(x || jsonb_build_object('source', jsonb_build_object('type', 'job', 'content_version', v_ver)))
      from jsonb_array_elements(v_spec->'atoms') x), '[]'::jsonb));

  insert into ai_private.job_requirements (opportunity_id, content_version, status, confirmed, confirmed_by, confirmed_at)
  values (p_opportunity, v_ver, 'confirmed', v_spec->'atoms', v_uid, now())
  on conflict (opportunity_id) do update
     set content_version = v_ver, status = 'confirmed', confirmed = v_spec->'atoms',
         confirmed_by = v_uid, confirmed_at = now(), updated_at = now();
end;
$$;

revoke all on function public.ai_confirm_job_requirements(uuid, jsonb, int) from public, anon, authenticated;

grant execute on function public.ai_confirm_job_requirements(uuid, jsonb, int) to authenticated;

