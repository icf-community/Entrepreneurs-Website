-- ════════════════════════════════════════════════════════════════════
-- Foundry · Query snapshot for LOCAL load tests (launch programme E1c, M4)
--
-- Run before and after each load run against the local stack. Reset
-- first so the snapshot covers only that run:
--   psql "$LOCAL" -c "select pg_stat_statements_reset()"
--   … run k6 …
--   psql "$LOCAL" -X --csv -f supabase/checks/pg_stat_snapshot.sql > .perf/pgstat.csv
--
-- Query text is normalised by pg_stat_statements ($1, $2 …), so no member
-- data appears in the output. Never needed in prod: the Supabase
-- dashboard's Query Performance page shows the same thing there.
-- ════════════════════════════════════════════════════════════════════
select
  s.calls,
  round(s.total_exec_time::numeric, 1)                      as total_ms,
  round(s.mean_exec_time::numeric, 2)                       as mean_ms,
  round(s.max_exec_time::numeric, 1)                        as max_ms,
  s.rows,
  round(100.0 * s.shared_blks_hit / nullif(s.shared_blks_hit + s.shared_blks_read, 0), 1) as cache_hit_pct,
  case when s.query ~* '^\s*(select|with\s[^;]*select)' and s.query !~* '\m(insert|update|delete)\M' then 'read' else 'write' end as kind,
  left(regexp_replace(s.query, '\s+', ' ', 'g'), 160)        as query
from pg_stat_statements s
join pg_database d on d.oid = s.dbid and d.datname = current_database()
where s.query !~* 'pg_stat_statements|pg_catalog\.|information_schema|pg_timezone_names|base_types|pg_namespace'
order by s.total_exec_time desc
limit 20;
