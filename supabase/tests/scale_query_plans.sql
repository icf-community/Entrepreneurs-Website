-- ════════════════════════════════════════════════════════════════════
-- Foundry · C2 scalability audit, part 1: query plans at 2000 members
--
-- Run AFTER supabase/snippets/seed_scale_corpus.sql against a local
-- stack:
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -f - < supabase/tests/scale_query_plans.sql
--
-- ──────────────────────────────────────────────────────────────────────
-- WHAT THIS ANSWERS, AND WHAT IT DOES NOT
-- ──────────────────────────────────────────────────────────────────────
-- The audit plan (C2, item 2) asks for `explain (analyze, buffers)` on
-- the hot read paths "under a realistic row count, not the ~30 rows in
-- the DB today", because a policy that runs a correlated subquery per
-- row is invisible at 30 and fatal at 2000. That is what this measures:
-- the SHAPE of the plan and the number of buffers touched.
--
-- It does NOT measure production latency. This runs on a laptop, against
-- a container, with a cold-ish cache and no concurrency. The absolute
-- milliseconds are not transferable to Supabase's hardware and must not
-- be quoted as if they were. What IS transferable:
--
--   * Seq Scan vs Index Scan on a 2000-row table
--   * a nested loop whose inner side re-executes per outer row
--   * `rows=` estimate vs `actual rows=` off by an order of magnitude
--   * shared buffer counts, which are hardware-independent
--
-- Read the output for those four things and ignore the timings.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHY EVERY QUERY RUNS AS `authenticated`, NOT `postgres`
-- ──────────────────────────────────────────────────────────────────────
-- The whole point is RLS cost. As superuser, RLS is bypassed entirely
-- and every plan below would come back clean and mean nothing. Each
-- section therefore sets a real member's JWT claims and switches role,
-- exactly as PostgREST does.
-- ════════════════════════════════════════════════════════════════════

\timing off
\pset pager off

begin;

-- Pick a stable member out of the corpus to act as the caller: an
-- approved student, which is the modal case and the one whose RLS path
-- is longest.
--
-- Captured into a psql variable with \gset, NOT a temporary table. A
-- temp table is owned by `postgres` and carries no grant for
-- `authenticated`, so every query below it fails with "permission denied
-- for table _caller" the moment the role switches — and inside a
-- transaction that first failure aborts all seventeen that follow. The
-- variable is substituted client-side and needs no privileges at all.
select u.id as caller_id, u.email as caller_email
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.email like '%scale.invalid%'
   and p.status = 'approved'
   and p.role = 'student'
 order by u.id
 limit 1
\gset

\echo 'caller:' :caller_email

-- Row counts the plans below are being read against, so the output is
-- self-describing when it is pasted into the findings doc.
select 'profiles'       as tbl, count(*) from public.profiles
union all select 'profile_skills',   count(*) from public.profile_skills
union all select 'events',           count(*) from public.events
union all select 'opportunities',    count(*) from public.opportunities
union all select 'vcs_grants',       count(*) from public.vcs_grants
union all select 'posts',            count(*) from public.posts
union all select 'post_likes',       count(*) from public.post_likes
union all select 'listing_events',   count(*) from public.listing_events
union all select 'cv_chunks',        count(*) from public.cv_chunks
union all select 'member_skills',    count(*) from public.member_skills
order by 1;

-- Statistics must be current or the planner is choosing against numbers
-- from an empty database, and every plan below is an artefact of that
-- rather than of the query. Named tables only: a bare `analyze` walks
-- the shared catalogs too and buries the run in permission-denied
-- warnings for pg_authid and friends.
analyze public.profiles, public.profile_skills, public.profile_sectors,
        public.events, public.opportunities, public.vcs_grants,
        public.posts, public.post_likes, public.listing_events,
        public.cv_chunks, public.cv_profiles, public.cvs,
        public.member_skills, public.github_connections;

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo ' 1. list_directory_cards — /members, the biggest fan-out'
\echo '════════════════════════════════════════════════════════════'

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'caller_id', 'role', 'authenticated')::text, true);

-- Unfiltered first page: what an arriving member pays.
explain (analyze, buffers, verbose off)
select * from public.list_directory_cards(null, null, null, null, null, null, null, 24, 0, null);

\echo ''
\echo '--- 1b. deep page (offset 1000) — offset paging is O(offset) ---'
explain (analyze, buffers)
select * from public.list_directory_cards(null, null, null, null, null, null, null, 24, 1000, null);

\echo ''
\echo '--- 1c. skill filter — joins through profile_skills (~12k rows) ---'
explain (analyze, buffers)
select * from public.list_directory_cards(
  null, null, null, null,
  array(select name from public.skills order by id limit 2),
  null, null, 24, 0, null);

\echo ''
\echo '--- 1d. text search ---'
explain (analyze, buffers)
select * from public.list_directory_cards('payments', null, null, null, null, null, null, 24, 0, null);

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo ' 2. list_directory_facets — every facet count, no arguments'
\echo '════════════════════════════════════════════════════════════'
-- Cached in Upstash for an hour in production, which is exactly why its
-- uncached cost has never been looked at. It is the cold-start bill on
-- every cache miss and every deploy.
explain (analyze, buffers)
select * from public.list_directory_facets();

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo ' 3. list_approved_events / _opportunities / _vcs_grants'
\echo '════════════════════════════════════════════════════════════'
-- B3.3: these are the spike landing pages and they are deliberately
-- NOT cached, because contact_email is caller-dependent. So this plan
-- runs on EVERY view. It is the single most-executed query in the app.
explain (analyze, buffers)
select * from public.list_approved_events();

\echo ''
explain (analyze, buffers)
select * from public.list_approved_opportunities();

\echo ''
explain (analyze, buffers)
select * from public.list_approved_vcs_grants(null, null, null, null, 24, 0);

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo ' 4. list_community_feed — keyset paged, 1500 posts + 12k likes'
\echo '════════════════════════════════════════════════════════════'
explain (analyze, buffers)
select * from public.list_community_feed(null, null, 20);

\echo ''
\echo '--- 4b. second page, via the keyset cursor ---'
explain (analyze, buffers)
select * from public.list_community_feed(now() - interval '30 days', null, 20);

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo ' 5. Admin paths — admin_list_profiles over 2000 rows'
\echo '════════════════════════════════════════════════════════════'
-- admin_list_profiles gates on public.is_admin(), which reads auth.uid()
-- against the `admins` table. A service_role claim alone does NOT
-- satisfy it — is_admin() asks *who* you are, not what role you hold, so
-- a claims blob with no `sub` raises "Forbidden: not an admin" and, in
-- one transaction, takes every later section down with it. The caller
-- has to be an actual admin account.
reset role;
select a.user_id as admin_id
  from public.admins a
 order by a.user_id
 limit 1
\gset

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);

explain (analyze, buffers)
select * from public.admin_list_profiles(null, null, array['pending_review'], null, null, null, null, null, 25, 0);

\echo ''
\echo '--- 5b. the whole member list, unfiltered — 2000 rows ---'
explain (analyze, buffers)
select * from public.admin_list_profiles(null, null, null, null, null, null, null, null, 25, 0);

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo ' 6. cv_chunks vector scan — the ANN index question'
\echo '════════════════════════════════════════════════════════════'
-- Back to the owner: cv_chunks is deny-all RLS with no grant to
-- `authenticated` at all, so this section cannot run as a member — and
-- that is correct, not a gap. The Phase 2 agent will reach it through a
-- SECURITY DEFINER RPC, which does not exist yet
-- ([[phase1-read-path-missing]]). What is measured here is the raw scan
-- cost that RPC will inherit.
reset role;
--
-- 20260906000001:95 defers the HNSW index deliberately. This is the
-- measurement that decides when that stops being the right call: a
-- brute-force scan over ~10k × vector(1536) is ~60 MB read per search,
-- and the Phase 2 agent issues several searches per conversational turn.
explain (analyze, buffers)
select id, member_id
  from public.cv_chunks
 order by embedding <=> (select embedding from public.cv_chunks limit 1)
 limit 10;

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo ' 7. Table and index sizes — the Supabase 500 MB ceiling'
\echo '════════════════════════════════════════════════════════════'
select
  c.relname                                            as table_name,
  s.n_live_tup                                         as live_rows,
  pg_size_pretty(pg_table_size(c.oid))                 as heap,
  pg_size_pretty(pg_indexes_size(c.oid))               as indexes,
  pg_size_pretty(pg_total_relation_size(c.oid))        as total
from pg_stat_user_tables s
join pg_class c on c.oid = s.relid
where s.n_live_tup > 0
order by pg_total_relation_size(c.oid) desc
limit 20;

select pg_size_pretty(pg_database_size(current_database())) as database_total;

rollback;
