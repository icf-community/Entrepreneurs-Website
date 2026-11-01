-- ════════════════════════════════════════════════════════════════════
-- Foundry · Authorization invariants (Part 2 security matrix, static half)
--
-- Structural properties of the schema that, if they drift, silently open
-- a hole. They read catalogue state only (no function calls, so they are
-- safe on the CLI 2.116 image that segfaults on denied definer calls).
--
--   1. anon can execute exactly three non-extension functions.
--   2. Every SECURITY DEFINER function pins search_path.
--   3. Every table in public/ai_* has row level security enabled.
--   4. Every admin_* function that authenticated can execute checks
--      is_admin() / is_ai_operator() before doing anything.
--   5. The ai_private / ai_public internals are not executable by anon.
--   6. The audit, ledger and admin-roster tables have no write policy.
--
-- Success is SILENT; a violation raises FAIL(..). Read-only.
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/authz_invariants.sql
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  v_bad text;
begin
  -- 1 ── anon surface. Extension functions (citext, pgvector, pg_trgm) land
  -- in public and are anon-executable by default; they are pure and are
  -- excluded by their pg_depend extension link.
  select string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'ai_private', 'ai_public')
     and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and p.proname not in ('get_site_banner', 'is_admin', 'is_approved');
  if v_bad is not null then
    raise exception 'FAIL(anon surface): anon can execute %', v_bad;
  end if;

  -- 2 ── search_path pinned on every definer function we own.
  select string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'ai_private', 'ai_public')
     and p.prokind = 'f' and p.prosecdef
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if v_bad is not null then
    raise exception 'FAIL(search_path): definer functions without a pinned search_path: %', v_bad;
  end if;

  -- 3 ── RLS on everywhere.
  select string_agg(n.nspname || '.' || c.relname, ', ' order by c.relname) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'ai_private', 'ai_public')
     and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'FAIL(rls): tables without row level security: %', v_bad;
  end if;

  -- 4 ── admin_* functions check the caller's standing.
  select string_agg(p.proname || '(' || oidvectortypes(p.proargtypes) || ')', ', ' order by p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_%'
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prosrc !~* 'is_admin\(|is_ai_operator\(|is_operator\(';
  if v_bad is not null then
    raise exception 'FAIL(admin guard): admin_* functions without an admin/operator check: %', v_bad;
  end if;

  -- 5 ── ai_private internals are not reachable by a signed-in member
  -- except through the public wrappers (they are all in ai_private, which
  -- PostgREST does not expose, but the grant is checked too).
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'ai_private' and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'FAIL(ai_private): anon can execute ai_private.%', v_bad;
  end if;

  -- 6 ── no write policy for anon/authenticated on the audit, ledger and
  -- admin-roster tables: only definer functions may write them. (Table
  -- GRANTs exist by Supabase default; RLS with no write policy is what
  -- denies, so that is what is pinned.)
  select string_agg(tablename || ':' || policyname, ', ' order by tablename) into v_bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('admin_actions', 'outbound_email', 'admins')
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if v_bad is not null then
    raise exception 'FAIL(write policy): write policies on audit/ledger tables: %', v_bad;
  end if;

  -- 7 ── service-only entry points (cron, queue claims, worker, GitHub token
  -- handling, tombstone purge/replay, spend ledger, trigger bodies) are not
  -- executable by a browser client at all. Several take a caller id or a
  -- token as an argument and trust it, so the grant IS the access control.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and (p.proname ~ '^(cron_|claim_|worker_|purge_|replay_|tg_|spend_|enqueue_|rls_auto_enable)'
          or p.proname in ('confirm_github_connected', 'update_cv_currency',
                           'mark_github_showcase_nudged', 'connection_assert_can_block',
                           'connection_refusal_message'))
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'FAIL(service-only): browser roles can execute %', v_bad;
  end if;

  -- 8 ── a signed-in member cannot call ai_private directly either (check 5
  -- only covered anon); the public ai_* wrappers are the sole door.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'ai_private' and p.prokind = 'f'
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'FAIL(ai_private): authenticated can execute ai_private.%', v_bad;
  end if;
end;
$$;
