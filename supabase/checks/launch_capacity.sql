-- Read-only launch snapshot. Run after the Connections migrations.
-- No credentials, addresses, JWTs, app_config values or query text are returned.
-- Run once before/after a staging load test, not on every request.
begin transaction read only;
set local statement_timeout = '10s';

select name, setting, unit from pg_settings
where name in ('max_connections', 'superuser_reserved_connections', 'shared_buffers', 'work_mem');

select application_name, usename, state, count(*) as connections,
       count(*) filter (where wait_event_type = 'Lock') as waiting_on_locks,
       max(now() - xact_start) as oldest_transaction
from pg_stat_activity where datname = current_database()
group by application_name, usename, state order by connections desc;

select pg_size_pretty(pg_database_size(current_database())) as database_size,
       pg_database_size(current_database()) as database_bytes;

select schemaname, relname, n_live_tup, n_dead_tup,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       last_autovacuum, last_autoanalyze
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc limit 15;

select count(*) as eligible_undigested_requests,
       count(distinct c.addressee_id) as recipients,
       min(c.created_at) as oldest_pending_request
from public.connections c
join public.profiles sender on sender.id = c.requester_id
join public.profiles recipient on recipient.id = c.addressee_id
where c.status = 'pending' and c.digested_at is null
  and sender.status = 'approved' and recipient.status = 'approved'
  and recipient.connection_emails_enabled;

-- Digest budget (20260917000016): recipients mailed in the last 24h plus
-- live leases, against digest_daily_cap. used >= cap means the rest of
-- today's window claims nothing; raise the cap after the Resend upgrade.
select public.connection_limit('digest_daily_cap') as digest_daily_cap,
       count(distinct c.addressee_id) as digest_budget_used,
       count(distinct c.addressee_id) filter (
         where c.status = 'pending' and c.digested_at is null
           and c.digest_claimed_at > now() - interval '10 minutes') as live_leases
from public.connections c
where c.digested_at > now() - interval '24 hours'
   or (c.status = 'pending' and c.digested_at is null
       and c.digest_claimed_at > now() - interval '10 minutes');

select count(*) filter (where sent_at is null and attempts < max_attempts) as queued_email,
       count(*) filter (where sent_at is null and attempts >= max_attempts) as exhausted_email,
       min(created_at) filter (where sent_at is null and attempts < max_attempts) as oldest_queued_email
from public.outbound_email;

select status, count(*) as jobs from public.jobs group by status;

select j.jobname, j.schedule, j.active, max(r.start_time) as last_start,
       count(*) filter (where r.status = 'failed') as failures_last_day
from cron.job j left join cron.job_run_details r
  on r.jobid = j.jobid and r.start_time > now() - interval '1 day'
group by j.jobname, j.schedule, j.active order by j.jobname;

commit;
