-- ════════════════════════════════════════════════════════════════════
-- Foundry · Health snapshot (launch programme G3/G4)
--
-- Twice a feature has failed silently for weeks: the digest URL was never
-- seeded, and github_showcase_nudge_url was missing in prod, so the cron
-- drivers returned early and nothing ever errored. Error tracking can't
-- see that. This can:
--
--   app_health_snapshot()  one DB-only pass over every backlog, the cron
--                          run log, pg_net's response log and the
--                          app_config rows the drivers need. Returns one
--                          entry per check with ok and a report flag.
--   cron_health_check()    the pg_cron driver: posts to /api/cron/health,
--                          which reports failing checks to Sentry and
--                          checks in with a Sentry cron monitor. If this
--                          chain breaks (pg_cron, pg_net, the URL, the
--                          secret, Vercel), the missed check-in alerts.
--
-- Per-route check-ins on the drain crons would not work: their drivers
-- skip the HTTP call when the queue is empty, so an idle queue would look
-- exactly like a dead cron. Backlog age is the signal instead.
--
-- Report throttling lives here, not in the route, so the route stays
-- stateless: a check is reported when it starts failing and then at most
-- hourly while it stays failing. Every report is one Sentry event, and an
-- incident must not use up the monthly quota.
--
-- Errors and health only; nothing here is a performance metric.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.app_health_state (
  check_name       text primary key,
  failing_since    timestamptz,
  last_reported_at timestamptz
);

alter table public.app_health_state enable row level security;
revoke all on public.app_health_state from public, anon, authenticated;

create or replace function public.app_health_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke execute on function public.app_health_snapshot() from public, anon, authenticated;

create or replace function public.cron_health_check()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from public.app_config where key = 'health_url';
  select value into v_secret from public.app_config where key = 'cron_secret';
  if v_url is null or v_secret is null then
    -- Nothing reaches Sentry from here, and that is the point: the
    -- monitor's missed check-in is what alerts.
    raise warning 'cron_health_check: health_url or cron_secret not configured in app_config';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function public.cron_health_check() from public, anon, authenticated;

do $$
begin
  begin
    perform cron.unschedule('health-check');
  exception when others then
    null;
  end;
  perform cron.schedule('health-check', '*/10 * * * *', 'select public.cron_health_check();');
end $$;
