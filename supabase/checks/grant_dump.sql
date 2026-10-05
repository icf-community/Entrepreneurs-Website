-- ════════════════════════════════════════════════════════════════════
-- Foundry · Grant dump (D2) — what anon and authenticated can reach
--
-- READ-ONLY. Safe to paste into the production SQL editor. It writes
-- nothing and reads no member data, only the catalog.
--
-- One sorted row per (role, privilege, object) that the two API roles
-- hold in the exposed `public` schema: function EXECUTE, table and
-- column privileges. rls_smoke.sql §21 enforces the function allowlist
-- on a fresh local database. This exists for the other side of that
-- claim: production can drift from the migrations (a grant made by hand
-- in the dashboard, a migration applied out of order, an object that
-- only exists in prod), and only a dump of the live catalog shows it.
--
-- Use: run locally after `supabase db reset` and in production after
-- `supabase db push`, save both results as CSV, and diff them. Any line
-- only in production is a finding.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -X -A -F, -f - < supabase/checks/grant_dump.sql > grants.local.csv
-- ════════════════════════════════════════════════════════════════════

with roles(r) as (values ('anon'), ('authenticated')),
fns as (
  select r as role, 'EXECUTE' as privilege,
         'function ' || p.oid::regprocedure::text as object
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   cross join roles
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     -- extension-owned functions (pgcrypto, pg_trgm…) are not ours
     and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege(r, p.oid, 'EXECUTE')
),
tbls as (
  select r as role, priv as privilege,
         (case c.relkind when 'v' then 'view ' when 'm' then 'matview ' else 'table ' end)
           || c.oid::regclass::text as object
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join roles
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                      ('REFERENCES'), ('TRIGGER')) v(priv)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm')
     and has_table_privilege(r, c.oid, priv)
),
-- Column grants on tables the role can't read whole (profiles is read
-- through a column list): has_table_privilege is false there, so they
-- would otherwise be invisible.
cols as (
  select r as role, priv || ' (column)' as privilege,
         'column ' || c.oid::regclass::text || '.' || a.attname as object
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   cross join roles
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE')) v(priv)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not has_table_privilege(r, c.oid, priv)
     and has_column_privilege(r, c.oid, a.attnum, priv)
)
select role, privilege, object from fns
union all select role, privilege, object from tbls
union all select role, privilege, object from cols
order by role, object, privilege;
