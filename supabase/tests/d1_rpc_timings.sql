-- ════════════════════════════════════════════════════════════════════
-- Foundry · D1 audit: time every read the app makes, at corpus scale
--
-- Run AFTER supabase/snippets/seed_scale_corpus.sql, local stack only:
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -X -q -f - < supabase/tests/d1_rpc_timings.sql
--
-- Every read RPC the frontend calls (grep `.rpc("…")` in frontend/src),
-- plus the table reads behind the detail pages, each run 1 + 20 times as
-- `authenticated` with a real member's JWT claims, exactly as PostgREST
-- runs them, so RLS and the in-body gates are paid. Three callers:
--
--   typical  an approved member with ~100 connections (the median)
--   hub      the most-connected member (the worst case)
--   admin    the corpus admin, for the admin surfaces
--
-- Prints p50 / p95 / max in ms per (read, caller). The D1 gate is
-- p95 < 100 ms at 10k members. Laptop numbers: read the ranking and the
-- outliers, not the absolute milliseconds (scale_query_plans.sql has
-- the EXPLAINs for the shapes). Writes are timed by the k6 write mix.
-- Nothing is written; the whole run is one rolled-back transaction.
-- ════════════════════════════════════════════════════════════════════

begin;

create temp table d1_degree on commit drop as
  select id, count(*) as n
    from (select requester_id as id from public.connections where status = 'accepted'
          union all
          select addressee_id from public.connections where status = 'accepted') u
   group by id;

create temp table d1_ctx on commit drop as
select
  (select d.id from d1_degree d join public.profiles p on p.id = d.id
    where p.status = 'approved' and p.intake_completed_at is not null
    order by abs(d.n - (select percentile_disc(0.5) within group (order by n) from d1_degree)), d.id
    limit 1)                                                                    as typical,
  (select d.id from d1_degree d join public.profiles p on p.id = d.id
    where p.status = 'approved' order by d.n desc, d.id limit 1)                as hub,
  (select a.user_id from public.admins a order by a.created_at limit 1)         as admin,
  (select o.id from public.opportunities o where o.status = 'approved'
    order by o.created_at desc limit 1)                                         as opp,
  (select e.id from public.events e where e.status = 'approved'
    order by e.created_at desc limit 1)                                         as evt,
  (select v.id from public.vcs_grants v where v.status = 'approved'
    order by v.created_at desc limit 1)                                         as vc,
  (select c.member_id from public.cvs c order by c.member_id limit 1)           as cv_owner;

select typical, hub, admin, opp, evt, vc, cv_owner from d1_ctx \gset

-- label | caller | statement. :'x' is substituted client-side, so the
-- statements run as `authenticated` need no grant on the temp tables.
create temp table d1_calls (ord serial, label text, who text, stmt text) on commit drop;
insert into d1_calls (label, who, stmt) values
  -- every signed-in page
  ('my_gate_state',                    'typical', 'select * from public.my_gate_state()'),
  ('get_site_banner',                  'typical', 'select * from public.get_site_banner()'),
  ('my_unread_notification_count',     'hub',     'select public.my_unread_notification_count()'),
  ('my_pending_connection_count',      'hub',     'select public.my_pending_connection_count()'),
  ('is_admin',                         'typical', 'select public.is_admin()'),
  -- /home
  ('list_newest_events',               'typical', 'select * from public.list_newest_events(3)'),
  ('list_newest_opportunities',        'typical', 'select * from public.list_newest_opportunities(3)'),
  ('get_my_activity',                  'hub',     'select * from public.get_my_activity()'),
  -- listings
  ('list_approved_events',             'typical', 'select * from public.list_approved_events()'),
  ('list_approved_opportunities',      'typical', 'select * from public.list_approved_opportunities()'),
  ('list_approved_vcs_grants',         'typical', 'select * from public.list_approved_vcs_grants(null, null, null, null, 24, 0)'),
  ('list_approved_vcs_grants q',       'typical', 'select * from public.list_approved_vcs_grants(''seed'', null, null, null, 24, 0)'),
  ('get_my_listing_actions',           'typical', 'select * from public.get_my_listing_actions()'),
  ('list_my_bookmarked_opportunities', 'typical', 'select * from public.list_my_bookmarked_opportunities()'),
  ('get_my_listing_stats',             'typical', 'select * from public.get_my_listing_stats()'),
  ('opportunity detail (table)',       'typical', 'select * from public.opportunities where id = ' || quote_literal(:'opp')),
  ('event detail (table)',             'typical', 'select * from public.events where id = ' || quote_literal(:'evt')),
  ('vc detail (table)',                'typical', 'select * from public.vcs_grants where id = ' || quote_literal(:'vc')),
  ('opportunity skills (table)',       'typical', 'select * from public.opportunity_skills where opportunity_id = ' || quote_literal(:'opp')),
  ('get_opportunity_for_edit',         'admin',   'select * from public.get_opportunity_for_edit(' || quote_literal(:'opp') || ')'),
  ('get_event_for_edit',               'admin',   'select * from public.get_event_for_edit(' || quote_literal(:'evt') || ')'),
  ('listing_has_pending_edit',         'typical', 'select public.listing_has_pending_edit(''opportunity'', ' || quote_literal(:'opp') || ')'),
  ('get_my_pending_listing_edit',      'typical', 'select * from public.get_my_pending_listing_edit(''opportunity'', ' || quote_literal(:'opp') || ')'),
  -- members
  ('list_directory_cards',             'typical', 'select * from public.list_directory_cards(null, null, null, null, null, null, null, 24, 0, null)'),
  ('list_directory_cards deep page',   'typical', 'select * from public.list_directory_cards(null, null, null, null, null, null, null, 24, 2400, null)'),
  ('list_directory_cards q',           'typical', 'select * from public.list_directory_cards(''payments'', null, null, null, null, null, null, 24, 0, null)'),
  ('list_directory_facets',            'typical', 'select * from public.list_directory_facets()'),
  ('member dialog (table)',            'typical', 'select bio_focus, bio_hobbies, linkedin_url, github_url, portfolio_url from public.profiles where id = ' || quote_literal(:'hub')),
  ('member skills (table)',            'typical', 'select * from public.profile_skills where profile_id = ' || quote_literal(:'hub')),
  ('connection_panel_state',           'typical', 'select * from public.connection_panel_state(' || quote_literal(:'hub') || ')'),
  ('list_committee_cards',             'typical', 'select * from public.list_committee_cards()'),
  -- connections
  ('list_my_connections',              'typical', 'select * from public.list_my_connections()'),
  ('list_my_connections',              'hub',     'select * from public.list_my_connections()'),
  ('list_my_connections q',            'hub',     'select * from public.list_my_connections(''eng'')'),
  ('list_my_connection_graph',         'typical', 'select * from public.list_my_connection_graph()'),
  ('list_my_connection_graph',         'hub',     'select * from public.list_my_connection_graph()'),
  ('list_my_connection_facets',        'typical', 'select * from public.list_my_connection_facets()'),
  ('list_my_connection_facets',        'hub',     'select * from public.list_my_connection_facets()'),
  ('list_my_pending_requests',         'hub',     'select * from public.list_my_pending_requests(48, null, null)'),
  ('list_my_sent_requests',            'hub',     'select * from public.list_my_sent_requests(48, null, null)'),
  ('connection_consent_version',       'typical', 'select public.connection_consent_version()'),
  ('my_connection_settings',           'typical', 'select * from public.my_connection_settings()'),
  ('list_my_blocked_members',          'typical', 'select * from public.list_my_blocked_members()'),
  -- community
  ('list_community_feed',              'typical', 'select * from public.list_community_feed(null, null, 20)'),
  ('list_my_posts',                    'hub',     'select * from public.list_my_posts(null, null, 20)'),
  ('get_post_like_counts',             'typical', 'select * from public.get_post_like_counts((select array_agg(id) from (select id from public.posts order by created_at desc limit 20) x))'),
  -- notifications, profile, settings
  ('list_my_notifications',            'hub',     'select * from public.list_my_notifications(30, null)'),
  ('get_my_cv_status',                 'typical', 'select * from public.get_my_cv_status()'),
  ('get_my_cv_info',                   'typical', 'select * from public.get_my_cv_info()'),
  ('get_my_cv_profile',                'typical', 'select * from public.get_my_cv_profile()'),
  ('get_my_github_status',             'typical', 'select * from public.get_my_github_status()'),
  ('get_my_github_showcase',           'typical', 'select * from public.get_my_github_showcase()'),
  ('github_cv_ingestion_enabled',      'typical', 'select public.github_cv_ingestion_enabled()'),
  ('export_my_data',                   'hub',     'select public.export_my_data()'),
  -- admin
  ('admin_list_profiles',              'admin',   'select * from public.admin_list_profiles(null, null, null, null, null, null, null, null, 50, 0)'),
  ('admin_list_profiles q',            'admin',   'select * from public.admin_list_profiles(''eng'', null, null, null, null, null, null, null, 50, 0)'),
  ('admin_list_pending_profiles',      'admin',   'select * from public.admin_list_pending_profiles(50, 0)'),
  ('admin_profile_facets',             'admin',   'select * from public.admin_profile_facets()'),
  ('admin_get_signup_emails',          'admin',   'select * from public.admin_get_signup_emails((select array_agg(id) from (select id from public.profiles order by id limit 50) x))'),
  ('admin_get_cv_info',                'admin',   'select * from public.admin_get_cv_info(' || quote_literal(:'cv_owner') || ')'),
  ('list_pending_events_admin',        'admin',   'select * from public.list_pending_events_admin()'),
  ('list_pending_opportunities_admin', 'admin',   'select * from public.list_pending_opportunities_admin()'),
  ('admin_list_listing_edits',         'admin',   'select * from public.admin_list_listing_edits()'),
  ('admin_list_post_reports',          'admin',   'select * from public.admin_list_post_reports(''open'', 50, 0)'),
  ('admin_list_connection_reports',    'admin',   'select * from public.admin_list_connection_reports(''open'', 50, 0)'),
  ('admin_list_flagged_senders',       'admin',   'select * from public.admin_list_flagged_senders(50)'),
  ('admin_connection_stats',           'admin',   'select * from public.admin_connection_stats()'),
  ('admin_get_connections_status',     'admin',   'select * from public.admin_get_connections_status()'),
  ('admin_get_ingestion_status',       'admin',   'select * from public.admin_get_ingestion_status()'),
  ('admin_get_site_banner',            'admin',   'select * from public.admin_get_site_banner()');

create temp table d1_out (ord int, label text, who text, p50 numeric, p95 numeric, mx numeric, err text) on commit drop;

-- psql does not substitute :variables inside the $$ body, so the callers
-- come from d1_ctx, read while still `postgres`.
do $$
declare
  x   record;
  c   record;
  uid uuid;
  t0  timestamptz;
  ms  numeric[];
  i   int;
  n   constant int := 20;
begin
  select * into x from d1_ctx;
  for c in select * from d1_calls order by ord loop
    uid := case c.who when 'typical' then x.typical
                      when 'hub'     then x.hub
                      else                x.admin end;
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    ms := '{}';
    begin
      execute 'set local role authenticated';
      execute c.stmt;                       -- warm-up, not counted
      for i in 1..n loop
        t0 := clock_timestamp();
        execute c.stmt;
        ms := ms || round(extract(epoch from clock_timestamp() - t0)::numeric * 1000, 2);
      end loop;
      execute 'reset role';
      insert into d1_out
        select c.ord, c.label, c.who,
               percentile_disc(0.5)  within group (order by v),
               percentile_disc(0.95) within group (order by v),
               max(v), null
          from unnest(ms) v;
    exception when others then
      execute 'reset role';
      insert into d1_out values (c.ord, c.label, c.who, null, null, null, sqlerrm);
    end;
  end loop;
end $$;

\pset footer off
select label, who, p50, p95, mx as max, coalesce(err, '') as error
  from d1_out order by p95 desc nulls first, ord;

rollback;
