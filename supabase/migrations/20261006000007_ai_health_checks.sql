-- ════════════════════════════════════════════════════════════════════
-- Foundry · AI checks in app_health_snapshot (programme G4, AI-plan §10.1)
--
-- Recreated from the live definition (20260928000006) with four AI checks
-- appended: queue age, unreconciled provider calls, spend at 80% of any
-- daily cap, and a failure-rate spike. Same signature and return type, so
-- create or replace is safe; same throttle (first failing run, then hourly).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.app_health_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'ai_private'
AS $function$
declare
  v_checks jsonb := '[]'::jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_c      jsonb;
  v_ok     boolean;
  v_state  public.app_health_state%rowtype;
  v_report boolean;
  v_age    interval;
  v_n      int;
  v_names  text[];
begin
  -- Email outbox: something is due and has waited over 30 minutes.
  select now() - min(next_attempt_at) into v_age
    from public.outbound_email
   where sent_at is null and attempts < max_attempts and next_attempt_at <= now();
  v_checks := v_checks || jsonb_build_object('check', 'email_backlog',
    'ok', coalesce(v_age < interval '30 minutes', true), 'detail', coalesce(v_age::text, 'empty'));

  -- Email given up on in the last day.
  select count(*) into v_n from public.outbound_email
   where sent_at is null and attempts >= max_attempts and last_attempted_at > now() - interval '24 hours';
  v_checks := v_checks || jsonb_build_object('check', 'email_dead_24h', 'ok', v_n = 0, 'detail', v_n);

  -- Blob deletions due for over an hour.
  select now() - min(next_attempt_at) into v_age
    from public.blob_deletion_queue
   where deleted_at is null and attempts < max_attempts and next_attempt_at <= now();
  v_checks := v_checks || jsonb_build_object('check', 'blob_deletion_backlog',
    'ok', coalesce(v_age < interval '1 hour', true), 'detail', coalesce(v_age::text, 'empty'));

  -- CV/GitHub jobs due for over 30 minutes: the worker isn't claiming.
  select now() - min(next_attempt_at) into v_age
    from public.jobs where status = 'pending' and next_attempt_at <= now();
  v_checks := v_checks || jsonb_build_object('check', 'worker_backlog',
    'ok', coalesce(v_age < interval '30 minutes', true), 'detail', coalesce(v_age::text, 'empty'));

  select count(*) into v_n from public.jobs where status = 'dead' and updated_at > now() - interval '24 hours';
  v_checks := v_checks || jsonb_build_object('check', 'jobs_dead_24h', 'ok', v_n = 0, 'detail', v_n);

  -- Moderation: anything waiting on an admin for over three days.
  select now() - min(t) into v_age from (
    select min(created_at) t from public.opportunities where status = 'pending'
    union all select min(created_at) from public.events where status = 'pending'
    union all select min(created_at) from public.vcs_grants where status = 'pending'
    union all select min(created_at) from public.listing_edits where status = 'pending'
    union all select min(created_at) from public.post_reports where status = 'open'
    union all select min(created_at) from public.connection_reports where status = 'open'
    union all select min(created_at) from public.profiles where status = 'pending_review'
  ) q;
  v_checks := v_checks || jsonb_build_object('check', 'moderation_age',
    'ok', coalesce(v_age < interval '72 hours', true), 'detail', coalesce(v_age::text, 'empty'));

  -- pg_cron jobs that failed in the last 70 minutes.
  select coalesce(array_agg(distinct j.jobname), '{}') into v_names
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where d.status = 'failed' and d.start_time > now() - interval '70 minutes';
  v_checks := v_checks || jsonb_build_object('check', 'cron_failures',
    'ok', cardinality(v_names) = 0, 'detail', to_jsonb(v_names));

  -- Cron HTTP calls that didn't get a 2xx: a wrong secret (403), the apex
  -- redirect (307), a timeout. From the database these look like success.
  select count(*) into v_n from net._http_response
   where created > now() - interval '70 minutes'
     and (error_msg is not null or timed_out or status_code not between 200 and 299);
  v_checks := v_checks || jsonb_build_object('check', 'cron_http_failures', 'ok', v_n = 0, 'detail', v_n);

  -- The rows every cron driver needs. A missing one makes its driver
  -- return early, silently: the failure this whole file exists for.
  select coalesce(array_agg(k), '{}') into v_names
    from unnest(array['cron_secret', 'drain_email_url', 'drain_blob_deletions_url',
                      'connections_digest_url', 'github_showcase_nudge_url', 'health_url']) k
   where not exists (select 1 from public.app_config c where c.key = k and nullif(btrim(c.value), '') is not null);
  v_checks := v_checks || jsonb_build_object('check', 'config_missing',
    'ok', cardinality(v_names) = 0, 'detail', to_jsonb(v_names));

  -- AI (programme G4, AI-plan §9, §10.1). A turn waiting over three
  -- minutes means the executor isn't claiming; an unreconciled provider
  -- call has been counted at its upper bound; spend at 80% of a daily cap
  -- is the alert the plan asks for, before the cap itself refuses work.
  select now() - min(created_at) into v_age from ai_private.turns where status = 'queued';
  v_checks := v_checks || jsonb_build_object('check', 'ai_queue_age',
    'ok', coalesce(v_age < interval '3 minutes', true), 'detail', coalesce(v_age::text, 'empty'));

  select count(*) into v_n from ai_private.spend
   where status = 'unknown' and created_at > now() - interval '24 hours';
  v_checks := v_checks || jsonb_build_object('check', 'ai_unreconciled_24h', 'ok', v_n = 0, 'detail', v_n);

  select coalesce(array_agg(x.cap), '{}') into v_names
    from (select 'matching' as cap
            from ai_private.settings c
           where (select coalesce(sum(ai_private.spend_charged(s)), 0) from ai_private.spend s
                   where s.day = (now() at time zone 'utc')::date and s.purpose = 'matching')
                 >= 0.8 * c.matching_daily_cap_micro and c.matching_daily_cap_micro > 0
          union all
          select 'ingestion'
            from ai_private.settings c
           where (select coalesce(sum(ai_private.spend_charged(s)), 0) from ai_private.spend s
                   where s.day = (now() at time zone 'utc')::date and s.purpose = 'ingestion')
                 >= 0.8 * c.ingestion_daily_cap_micro and c.ingestion_daily_cap_micro > 0
          union all
          select 'controller'
            from ai_private.settings c
           where (select coalesce(sum(ai_private.spend_charged(s)), 0) from ai_private.spend s
                   where s.day = (now() at time zone 'utc')::date)
                 >= 0.8 * c.controller_daily_cap_micro and c.controller_daily_cap_micro > 0) x;
  v_checks := v_checks || jsonb_build_object('check', 'ai_spend_80pct',
    'ok', cardinality(v_names) = 0, 'detail', to_jsonb(v_names));

  -- More than a fifth of the last hour's turns failed (at least five).
  select count(*) filter (where status = 'failed' and coalesce(outcome, '') not in ('budget_exhausted', 'cancelled'))
    into v_n from ai_private.turns where created_at > now() - interval '1 hour';
  v_checks := v_checks || jsonb_build_object('check', 'ai_turn_failures',
    'ok', v_n < greatest(5, (select count(*) from ai_private.turns where created_at > now() - interval '1 hour') / 5),
    'detail', v_n);

  -- Throttle: report on the first failing run, then hourly.
  for v_c in select * from jsonb_array_elements(v_checks) loop
    v_ok := (v_c->>'ok')::boolean;
    select * into v_state from public.app_health_state where check_name = v_c->>'check';
    if v_ok then
      v_report := false;
      delete from public.app_health_state where check_name = v_c->>'check';
    else
      v_report := v_state.check_name is null
               or v_state.last_reported_at is null
               or v_state.last_reported_at < now() - interval '1 hour';
      insert into public.app_health_state (check_name, failing_since, last_reported_at)
      values (v_c->>'check', now(), case when v_report then now() end)
      on conflict (check_name) do update
        set last_reported_at = case when v_report then now() else app_health_state.last_reported_at end;
    end if;
    v_out := v_out || (v_c || jsonb_build_object('report', v_report,
      'failing_since', case when v_ok then null else coalesce(v_state.failing_since, now()) end));
  end loop;

  return v_out;
end;
$function$;

revoke all on function public.app_health_snapshot() from public, anon, authenticated;
