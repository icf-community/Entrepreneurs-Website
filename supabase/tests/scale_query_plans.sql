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
\echo ' 8. Connections — the benchmark gate (20260917000001-4)'
\echo '════════════════════════════════════════════════════════════'
-- Everything above measures "does this degrade with MEMBERSHIP".
-- Connections lives on a different axis: DEGREE. A member with 300
-- connections must cost the same at 5,000 members as at 200,000,
-- because every index here is keyed on the member first.
--
-- So the caller for this section is not the modal student used above.
-- It is the HUB — the ~1,650-connection account seeded deliberately by
-- section 8 of seed_scale_corpus.sql, because a uniform corpus hides the
-- worst plan and the hub is the account that actually gets opened at a
-- careers evening.
--
-- Thresholds this section is being judged against (from the plan):
--   list_my_connections (50-row page)   < 5 ms
--   my_pending_connection_count (badge) < 2 ms
--   send_connection_request (all gates) < 10 ms
--   2-hop mutual-connection count       < 50 ms
-- Read them as plan SHAPE, per this file's header. A laptop millisecond
-- is not a production millisecond; an index scan is an index scan.

set local role none;

analyze public.connections, public.connection_events, public.connection_reports;

select
  (select c.requester_id
     from public.connections c
     join auth.users au on au.id = c.requester_id
    where au.email like '%scale.invalid%'
    group by c.requester_id
    order by count(*) desc
    limit 1) as hub_id
\gset

select u.id as isolate_id
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.email like '%scale.invalid%'
   and p.status = 'approved'
   and not exists (
     select 1 from public.connections c
      where c.requester_id = u.id or c.addressee_id = u.id)
 limit 1
\gset

-- A corpus can have no isolate at all (the seed makes very few, and a
-- member delete removes one). Make one inside this transaction rather
-- than let every section that needs it fail: the least-connected
-- approved member, with their rows cleared — rolled back at the end.
\if :{?isolate_id}
\else
select u.id as isolate_id
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.email like '%scale.invalid%'
   and p.status = 'approved'
 order by (select count(*) from public.connections c
            where c.requester_id = u.id or c.addressee_id = u.id)
 limit 1
\gset
delete from public.connections
 where requester_id = :'isolate_id'::uuid or addressee_id = :'isolate_id'::uuid;
\endif

select 'connections' as tbl, count(*) from public.connections
union all select 'connection_events', count(*) from public.connection_events
union all select 'hub degree', count(*) from public.connections
  where status = 'accepted' and (requester_id = :'hub_id' or addressee_id = :'hub_id')
order by 1;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'hub_id', 'role', 'authenticated')::text, true);

\echo ''
\echo '--- 8a. list_my_connections, first page, as the HUB ---'
-- The UNION ALL of two partial indexes is the thing to confirm. Two
-- Index Scans, each pre-sorted on (member, decided_at desc), merged
-- under the limit. A Bitmap Heap Scan or a Seq Scan here means the
-- planner rejected the partial indexes and the design premise is wrong.
explain (analyze, buffers)
select * from public.list_my_connections(null, null, null, null, null, null, null, 50, null, null);

\echo ''
\echo '--- 8b. list_my_connections, DEEP keyset page ---'
-- The whole reason this is keyset and not OFFSET. If the cost here is
-- indistinguishable from 8a, keyset is doing its job; if it climbs with
-- depth, something reintroduced an offset.
set local role none;
select decided_at as cur_at, id as cur_id
  from public.connections
 where status = 'accepted'
   and (requester_id = :'hub_id' or addressee_id = :'hub_id')
 order by decided_at desc, id desc
 offset 900 limit 1
\gset
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'hub_id', 'role', 'authenticated')::text, true);

explain (analyze, buffers)
select * from public.list_my_connections(null, null, null, null, null, null, null, 50,
                                         :'cur_at'::timestamptz, :'cur_id'::uuid);

\echo ''
\echo '--- 8c. my_pending_connection_count — the sidebar badge ---'
-- The highest-frequency query in the feature by a wide margin: it
-- renders on EVERY authenticated page. Must be the partial pending
-- index plus a bounded PK lookup per row, and nothing else.
explain (analyze, buffers)
select * from public.my_pending_connection_count();

\echo ''
\echo '--- 8d. connection_state_with — drives the MemberDialog control ---'
-- Runs once per dialog open. The lookup is on the canonical-pair
-- expression index, so it must be an Index Scan on connections_pair_uniq
-- — a Seq Scan here means the least()/greatest() predicate stopped
-- matching the index expression.
explain (analyze, buffers)
select * from public.connection_state_with(:'isolate_id'::uuid);

\echo ''
\echo '--- 8e. list_my_connection_facets — the filter chips ---'
explain (analyze, buffers)
select * from public.list_my_connection_facets();

\echo ''
\echo '--- 8f. list_my_connection_graph — the ego-graph payload ---'
explain (analyze, buffers)
select * from public.list_my_connection_graph();

\echo ''
\echo '--- 8g. send_connection_request — every gate, including the caps ---'
-- This one WRITES. The whole file runs inside a transaction that ends in
-- ROLLBACK, so the row never survives; that is also why this is safe to
-- run against the corpus and nowhere else.
--
-- The cost to watch is connection_assert_can_send: the daily and weekly
-- counts scan connection_events by actor over a rolling window, against
-- ~248k rows here. If that is a Seq Scan, every send in production pays
-- for the whole history of the platform.
--
-- THE SENDER IS NOT THE HUB, and that is not a dodge. The hub has ~1,650
-- 'requested' events spread over 300 corpus days, so ~38 of them land
-- inside the rolling 7-day window and the weekly cap of 25 correctly
-- REFUSES it — which aborts the transaction and takes the rest of this
-- file with it. The caps working is the right outcome; it just cannot
-- also be the measurement.
--
-- So the sender is picked as the busiest member who is still under the
-- cap: a non-trivial number of rows for the window scan to walk, and a
-- send that actually completes.
set local role none;
select u.id as sender_id
  from auth.users u
  join public.profiles p on p.id = u.id
  left join (
    select actor_id, count(*) as n
      from public.connection_events
     where event = 'requested' and created_at > now() - interval '7 days'
     group by actor_id
  ) w on w.actor_id = u.id
 where u.email like '%scale.invalid%'
   and p.status = 'approved'
   and p.profile_version >= 2
   and coalesce(w.n, 0) < public.connection_limit('weekly_cap')
   and not exists (
     select 1 from public.connections c
      where least(c.requester_id, c.addressee_id)    = least(u.id, :'isolate_id'::uuid)
        and greatest(c.requester_id, c.addressee_id) = greatest(u.id, :'isolate_id'::uuid))
   and u.id <> :'isolate_id'::uuid
 order by coalesce(w.n, 0) desc
 limit 1
\gset

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'sender_id', 'role', 'authenticated')::text, true);

explain (analyze, buffers)
select public.send_connection_request(
  :'isolate_id'::uuid, public.connection_consent_version(), 'Scale corpus probe');

\echo ''
\echo '--- 8h. the isolate — cold start must be empty, not slow ---'
select set_config('request.jwt.claims',
  json_build_object('sub', :'isolate_id', 'role', 'authenticated')::text, true);
explain (analyze, buffers)
select * from public.list_my_connections(null, null, null, null, null, null, null, 50, null, null);

\echo ''
\echo '--- 8i. 2-hop mutual connections — the escape-hatch question ---'
-- Not an RPC and deliberately not shipped: "N mutual connections" is out
-- of scope because at this community size a count of 1 is an
-- identification. It is measured anyway, because it is the query that
-- would decide whether a graph database was ever needed — and the
-- argument in the plan for staying in Postgres rests on this being tens
-- of milliseconds rather than seconds. ~1,650 x ~100 is ~165k candidate
-- paths, hash-aggregated.
set local role none;
explain (analyze, buffers)
with mine as (
  select addressee_id as other_id from public.connections
   where requester_id = :'hub_id' and status = 'accepted'
  union all
  select requester_id from public.connections
   where addressee_id = :'hub_id' and status = 'accepted'
),
theirs as (
  select c.addressee_id as other_id from public.connections c
    join mine m on m.other_id = c.requester_id where c.status = 'accepted'
  union all
  select c.requester_id from public.connections c
    join mine m on m.other_id = c.addressee_id where c.status = 'accepted'
)
select other_id, count(*) as mutuals from theirs group by other_id order by mutuals desc limit 20;

\echo ''
\echo '--- 8j. claim_connection_digests — one morning-window run (20260917000016) ---'
-- Rolled back: the claim writes leases, and complete writes digested_at
-- and outbox rows. The cap is lifted so the budget cannot hide the cost.
-- A SAVEPOINT, not begin/rollback: this whole file is one transaction
-- (line 42), and a bare `rollback` here would end it — every "rolled
-- back" section after this point would then run in autocommit and
-- really delete a member and really purge the corpus.
savepoint before_digest_claim;
update public.app_config
   set value = (value::jsonb || '{"digest_daily_cap":10000}')::text
 where key = 'connection_limits';
explain (analyze, buffers)
select * from public.claim_connection_digests(50);
rollback to savepoint before_digest_claim;

\echo ''
\echo '--- 8l. block_member — the write path added after the first gate run ---'
-- Added because 20260917000012 changed this path and the C3 gate predates
-- it. Block takes an ARBITRARY member id and creates a row from nothing,
-- which is the same write-amplifier shape as send, so it gained its own
-- authoritative database cap. Two new costs to look at, neither of which
-- existed when §8g was measured:
--
--   1. connection_assert_can_block counts this caller's 'blocked' events
--      in the last 24 hours. Same shape as the send-cap count and the
--      same failure mode: a Seq Scan here means every block in production
--      walks the whole event history. It must use
--      connection_events_subject_event_idx's actor-side counterpart.
--   2. pg_advisory_xact_lock, taken per-caller before the count. It is
--      a hash of the caller's own id, so two different members never
--      contend; what would be wrong is seeing it anywhere near the top
--      of the plan's time.
--
-- Run as the hub, because the hub is the account that would plausibly
-- block several people in a day. Writes, rolled back with the rest.
set local role none;
select u.id as block_target
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.email like '%scale.invalid%'
   and p.status = 'approved'
   and u.id <> :'hub_id'::uuid
   and not exists (
     select 1 from public.connections c
      where least(c.requester_id, c.addressee_id)    = least(u.id, :'hub_id'::uuid)
        and greatest(c.requester_id, c.addressee_id) = greatest(u.id, :'hub_id'::uuid))
 limit 1
\gset

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'hub_id', 'role', 'authenticated')::text, true);

explain (analyze, buffers)
select public.block_member(:'block_target'::uuid);

\echo ''
\echo '--- 8m. the retention crons at corpus scale ---'
-- purge_removed_connections stopped being "removed rows only" in
-- 20260917000011: it now sweeps declined, withdrawn and expired as well,
-- which is a much larger slice of a real table. The plan shape that
-- matters is whether it can *find* 500 doomed rows without reading the
-- whole table.
--
-- When this section was first run it could not: Parallel Seq Scan over
-- 248k rows, 74,286 rows removed by filter, 49.6 ms. 20260917000014 added
-- connections_settled_purge_idx and restated the predicate so the planner
-- can prove the partial index applies. The expected shape now is a
-- **Bitmap Index Scan on connections_settled_purge_idx** — anything with
-- `Seq Scan on connections` under it is that migration regressing.
--
-- The residual filter's row estimate is known to be bad (747 estimated
-- vs ~25k actual on a cold corpus) so the planner picks a bitmap scan and
-- a top-N sort over an ordered index scan that would be ~4x cheaper.
-- Priced and deliberately not chased; see that migration's header.
--
-- Note it is measured as `postgres`: these are cron functions, revoked
-- from every client role on purpose.
set local role none;
explain (analyze, buffers)
select public.purge_removed_connections();

explain (analyze, buffers)
select public.purge_connection_records();

-- 20260917000013. Small table by construction (drained every 5 minutes,
-- purged daily) and deliberately carrying NO index for this predicate —
-- a Seq Scan here is the expected and correct answer, recorded so the
-- plan is not later mistaken for a regression. What would matter is the
-- row count it scans growing into the tens of thousands, which would mean
-- the drain has stopped rather than that this query is wrong.
explain (analyze, buffers)
select public.purge_sent_outbound_email();

\echo ''
\echo '--- 8k. THE FK-CASCADE CHECK — 20260827000002 all over again ---'
-- Postgres indexes the REFERENCED side of a foreign key automatically
-- and NEVER the referencing side, so an unindexed FK turns every delete
-- of a profile into a sequential scan of `connections` — once per
-- deleted row. admin_delete_graduates deletes a whole cohort in ONE
-- statement, which makes that one full scan of a 247k-row table PER
-- GRADUATE, inside a single transaction holding locks.
--
-- READ THE "Trigger for constraint ..." LINES, not the plan. That is
-- where the RI check's cost appears, and it is the only place it does.
-- Both connections_requester_id_fkey and connections_addressee_id_fkey
-- must be there and must be cheap.
--
-- First: prove directly that a lookup on each FK column is an index
-- scan. These two plans are the actual invariant; the delete below is
-- the end-to-end confirmation.
explain (analyze, buffers)
select 1 from public.connections where requester_id = :'hub_id';

explain (analyze, buffers)
select 1 from public.connections where addressee_id = :'hub_id';

\echo ''
\echo '--- 8k-ii. single-member delete (rolled back) ---'
-- A graph isolate can still own listings. Clear the same RESTRICT FKs
-- as the cohort path below; otherwise a valid corpus stops this harness
-- before retention and size checks run. Restore everything immediately.
savepoint before_single_delete;
delete from public.opportunities where posted_by = :'isolate_id'::uuid;
delete from public.events where posted_by = :'isolate_id'::uuid;
delete from public.vcs_grants where posted_by = :'isolate_id'::uuid;
explain (analyze, buffers)
delete from public.profiles where id = :'isolate_id'::uuid;
rollback to savepoint before_single_delete;

\echo ''
\echo '--- 8k-iii. COHORT delete — the REAL admin_delete_graduates ---'
-- The one that actually bit this repo before, and it has to be the
-- actual RPC rather than a hand-written `delete from profiles`: that
-- raw form fails on opportunities_posted_by_fkey, which does NOT
-- cascade. admin_delete_graduates clears those blocking FKs first and
-- then deletes the cohort in one statement, and it is that final
-- statement — with `connections` now among the cascading children —
-- that this is here to measure.
--
-- Hundreds of profiles in one statement, each one firing an RI check
-- against a 247k-row `connections`. Unindexed, that is hundreds of
-- sequential scans inside a single locking transaction. Watch the
-- "Trigger for constraint" lines; nothing in the plan itself will show
-- it.
--
-- ─── THE RPC ITSELF, then the same work decomposed ──────────────────
-- Run in that order for one reason: `EXPLAIN ANALYZE` on a SECURITY
-- DEFINER function reports a single Function Scan and NO "Trigger for
-- constraint" lines — RI checks fired by a statement nested inside a
-- function are not attributed to the outer EXPLAIN. So the RPC is called
-- for real (proving it runs to completion on a non-empty cohort) inside
-- a savepoint that is rolled back, and the cascade is then measured on
-- the decomposed statement sequence the RPC performs: clear the blocking
-- non-cascading FKs, then delete the cohort from auth.users in one
-- statement and let the cascade run. That chain is
-- auth.users -> profiles -> connections, which is exactly the RI check
-- this section exists to look at.
--
-- Until 20260917000006 the RPC call below raised
-- "column reference user_id is ambiguous" on any non-empty cohort —
-- see docs/audits/C3-connections-benchmark-gate.md, Finding 2.
savepoint before_cohort_rpc;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);

select count(*) as rpc_deleted_graduates
  from public.admin_delete_graduates(2021);

rollback to savepoint before_cohort_rpc;

set local role none;

create temporary table _cohort on commit drop as
  select p.id
    from public.profiles p
    join auth.users au on au.id = p.id
   where au.email like '%scale.invalid%'
     and p.role = 'student'
     and p.status = 'approved'
     and p.grad_year is not null
     and p.grad_year <= 2021;

select count(*) as cohort_size from _cohort;

delete from public.opportunities where posted_by in (select id from _cohort);
delete from public.events        where posted_by in (select id from _cohort);
delete from public.vcs_grants    where posted_by in (select id from _cohort);
delete from public.admin_actions where admin_id  in (select id from _cohort);

explain (analyze, buffers)
delete from auth.users where id in (select id from _cohort);

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
