-- ════════════════════════════════════════════════════════════════════
-- Foundry · Data invariants after concurrent load (READ-ONLY)
--
-- Run after every load or burst run, locally (S0/S6/S7) and in the
-- pre-launch prod window (E3, owner, in the SQL editor). It performs no
-- writes. It checks the outcomes concurrency can break, which no single
-- request's response would show: one decision per listing, one paid job
-- per target, caps that held, leases and claims that did not get stuck.
--
-- Collects every violation, then raises once with the full list, so one
-- run tells the whole story. A clean run prints OK lines only.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_fail text[] := '{}';
  v_n    bigint;
  v_cap  int;
begin
  -- 1. A listing or member is decided at most once (approve/reject race, D9).
  select count(*) into v_n from (
    select target_id from public.admin_actions
     where action in ('approve_event', 'reject_event', 'approve_opportunity', 'reject_opportunity',
                      'approve_vc_grant', 'reject_vc_grant', 'approve_user', 'reject_user')
     group by target_id having count(*) > 1) d;
  if v_n > 0 then v_fail := v_fail || format('1 %s targets decided more than once', v_n); end if;

  -- 2. A post is removed, and a report resolved, at most once.
  select count(*) into v_n from (
    select post_id from public.post_moderation_log group by post_id having count(*) > 1) d;
  if v_n > 0 then v_fail := v_fail || format('2a %s posts with more than one removal log row', v_n); end if;
  select count(*) into v_n from (
    select target_id from public.admin_actions where action = 'admin_resolve_post_report'
     group by target_id having count(*) > 1) d;
  if v_n > 0 then v_fail := v_fail || format('2b %s reports resolved more than once', v_n); end if;

  -- 3. One upload ticket, one CV, one ingestion job.
  select count(*) into v_n from (
    select blob_key from public.cvs group by blob_key having count(*) > 1) d;
  if v_n > 0 then v_fail := v_fail || format('3a %s CV uploads recorded twice', v_n); end if;
  select count(*) into v_n from (
    select payload->>'cv_id' from public.jobs where kind = 'ingest_cv'
     group by payload->>'cv_id' having count(*) > 1) d;
  if v_n > 0 then v_fail := v_fail || format('3b %s CVs with more than one ingestion job', v_n); end if;

  -- 4. At most one pending background job per kind and target (jobs_one_pending).
  select count(*) into v_n from (
    select kind, coalesce(payload->>'member_id', payload->>'opportunity_id')
      from public.jobs
     where status = 'pending'
       and kind in ('refresh_member_ai', 'refresh_job_ai', 'refresh_github_summary', 'scan_github')
     group by 1, 2 having count(*) > 1) d;
  if v_n > 0 then v_fail := v_fail || format('4 %s targets with duplicate pending jobs', v_n); end if;

  -- 5. Nothing stuck: jobs running for 30+ minutes (the reaper runs every 5).
  select count(*) into v_n from public.jobs
   where status = 'running' and updated_at < now() - interval '30 minutes';
  if v_n > 0 then v_fail := v_fail || format('5 %s jobs stuck in running', v_n); end if;

  -- 6. Connection caps held: no member sent more requests in a day than the cap.
  v_cap := public.connection_limit('daily_cap');
  select count(*) into v_n from (
    select actor_id from public.connection_events
     where event = 'requested' and created_at > now() - interval '7 days'
     group by actor_id, date_trunc('day', created_at) having count(*) > v_cap) d;
  if v_n > 0 then v_fail := v_fail || format('6 %s member-days over the connection daily cap (%s)', v_n, v_cap); end if;

  -- 7. Outbox: no row claimed and then abandoned (attempted, unsent, retry
  --    overdue by an hour). A drain that never runs at all is the health
  --    check's outbox-age alarm (G4), not a concurrency outcome.
  select count(*) into v_n from public.outbound_email
   where sent_at is null and attempts > 0 and attempts < max_attempts
     and next_attempt_at < now() - interval '1 hour';
  if v_n > 0 then v_fail := v_fail || format('7 %s outbound emails overdue by an hour', v_n); end if;

  -- 8. AI turns: no live lease past expiry, no queue older than its wait limit,
  --    result_count agrees with the rows, results only for issued candidates.
  select count(*) into v_n from ai_private.turns
   where status = 'running' and lease_expires_at < now() - interval '2 minutes';
  if v_n > 0 then v_fail := v_fail || format('8a %s running AI turns past their lease', v_n); end if;
  select count(*) into v_n from ai_private.turns t, ai_private.settings s
   where s.id = 1 and t.status = 'queued'
     and t.created_at < now() - make_interval(secs => s.max_queue_wait_seconds + 120);
  if v_n > 0 then v_fail := v_fail || format('8b %s AI turns queued past the wait limit', v_n); end if;
  select count(*) into v_n from ai_private.turns t
   where t.status in ('completed', 'partial')
     and t.result_count <> (select count(*) from ai_private.results r where r.turn_id = t.id);
  if v_n > 0 then v_fail := v_fail || format('8c %s AI turns whose result_count disagrees with their rows', v_n); end if;
  select count(*) into v_n from ai_private.results r
   where r.target_member is not null
     and not exists (select 1 from ai_private.turn_candidates c
                      where c.turn_id = r.turn_id and c.target_member = r.target_member);
  if v_n > 0 then v_fail := v_fail || format('8d %s AI results for members never retrieved for that turn', v_n); end if;

  -- 9. AI money: no reservation left open for an hour; caps held per UTC day.
  select count(*) into v_n from ai_private.spend
   where status = 'reserved' and created_at < now() - interval '1 hour';
  if v_n > 0 then v_fail := v_fail || format('9a %s spend reservations open for over an hour', v_n); end if;
  select count(*) into v_n from (
    select sp.day from ai_private.spend sp, ai_private.settings s
     where s.id = 1 and sp.purpose = 'matching' and sp.status <> 'released'
     group by sp.day, s.matching_daily_cap_micro
    having sum(case when sp.status = 'settled' then sp.settled_micro else sp.reserved_micro end)
           > s.matching_daily_cap_micro) d;
  if v_n > 0 then v_fail := v_fail || format('9b %s days over the matching cap', v_n); end if;
  select count(*) into v_n from (
    select sp.member_id, sp.day from ai_private.spend sp, ai_private.settings s
     where s.id = 1 and sp.member_id is not null and sp.status <> 'released'
     group by sp.member_id, sp.day, s.member_daily_cap_micro
    having sum(case when sp.status = 'settled' then sp.settled_micro else sp.reserved_micro end)
           > s.member_daily_cap_micro) d;
  if v_n > 0 then v_fail := v_fail || format('9c %s member-days over the per-member cap', v_n); end if;

  -- 10. Surfaced-members cap (150 a rolling day per viewer).
  select count(*) into v_n from (
    select owner_id from ai_private.surfaced_members
     where surfaced_at > now() - interval '24 hours'
     group by owner_id having count(*) > 150) d;
  if v_n > 0 then v_fail := v_fail || format('10 %s viewers over 150 surfaced members', v_n); end if;

  -- 11. S8: draft_handoffs is purged hourly (ai_private.cron_purge); double
  -- the interval as slack for a run between cron ticks, so this only fires
  -- if the purge itself broke. match_reports cascades off its turn, so a
  -- report for a turn that no longer exists would mean the FK/cascade is
  -- not doing its job.
  select count(*) into v_n from ai_private.draft_handoffs
   where created_at < now() - interval '2 hours';
  if v_n > 0 then v_fail := v_fail || format('11a %s draft handoffs older than 2 hours (purge not running?)', v_n); end if;
  select count(*) into v_n from ai_private.match_reports mr
   where not exists (select 1 from ai_private.turns t where t.id = mr.turn_id);
  if v_n > 0 then v_fail := v_fail || format('11b %s match reports for a turn that no longer exists', v_n); end if;

  if cardinality(v_fail) > 0 then
    raise exception E'INVARIANTS FAILED (%):\n  %', cardinality(v_fail), array_to_string(v_fail, E'\n  ');
  end if;
  raise notice 'OK  all 11 invariant groups hold';
end;
$$;
