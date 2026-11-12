-- ════════════════════════════════════════════════════════════════════
-- Foundry · Database health during LOCAL load tests (launch programme E1c, M4)
--   psql "$LOCAL" -X --csv -f supabase/checks/db_health.sql
-- Connections by state, lock waits, buffer cache hit ratio and size.
-- ════════════════════════════════════════════════════════════════════
select 'connections' as metric, coalesce(state, 'background') as label, count(*)::text as value
  from pg_stat_activity group by state
union all
select 'waiting_on_lock', wait_event_type, count(*)::text
  from pg_stat_activity where wait_event_type = 'Lock' group by wait_event_type
union all
select 'cache_hit_pct', current_database(),
       round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2)::text
  from pg_stat_database where datname = current_database()
union all
select 'xact_commit', current_database(), xact_commit::text from pg_stat_database where datname = current_database()
union all
select 'deadlocks', current_database(), deadlocks::text from pg_stat_database where datname = current_database()
union all
select 'db_size', current_database(), pg_size_pretty(pg_database_size(current_database()));
