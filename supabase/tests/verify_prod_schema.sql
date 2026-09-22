-- ════════════════════════════════════════════════════════════════════
-- Foundry · Production schema verification (READ-ONLY)
--
-- Run in the Supabase SQL editor against PROD after applying migrations.
-- It performs NO writes. It RAISES EXCEPTION on the first broken invariant
-- (so a clean run = everything below held), then prints a snapshot to eyeball.
--
-- Safe to re-run anytime. Covers the security-critical invariants that, if
-- silently drifted, would mean a real hole: dead RPC overloads, the role/
-- status/email-domain/society-flag protection triggers, RLS coverage, and
-- SECURITY DEFINER on the privileged RPCs.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  v_bad   text;
  v_n     int;
begin
  -- 1. No dead overloads. A CREATE OR REPLACE with a drifted signature makes
  --    a SECOND function; supabase-js .rpc() then can't disambiguate. Exclude
  --    extension-owned functions (deptype 'e').
  select string_agg(p.proname || ' (' || c || ')', ', ')
    into v_bad
  from (
    select p.oid, p.proname, count(*) over (partition by p.proname) as c
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  ) p
  where p.c > 1;
  if v_bad is not null then
    raise exception 'DEAD OVERLOAD(S): %', v_bad;
  end if;
  raise notice 'OK  1  no duplicate function overloads in public';

  -- 2. Security-critical triggers present (one row each, on the right table).
  for v_bad in
    select x.want
    from (values
      ('profiles',     'profiles_protect_role'),
      ('profiles',     'profiles_protect_status'),
      ('events',       'events_protect_society_flag'),
      ('events',       'events_protect_status'),
      ('opportunities','opportunities_protect_status'),
      ('vcs_grants',   'vcs_grants_protect_status')
    ) as x(tbl, want)
    where not exists (
      select 1 from pg_trigger t
      join pg_class c   on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = x.tbl
        and t.tgname  = x.want
        and not t.tgisinternal
    )
  loop
    raise exception 'MISSING TRIGGER: %', v_bad;
  end loop;
  raise notice 'OK  2  role/status/society-flag protection triggers present';

  -- 2b. Email-domain lock on auth.users (Imperial re-check on email change).
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
      and t.tgname = 'on_auth_user_email_change' and not t.tgisinternal
  ) then
    raise exception 'MISSING TRIGGER: auth.users on_auth_user_email_change';
  end if;
  raise notice 'OK  2b on_auth_user_email_change present on auth.users';

  -- 3. Signature integrity for the two RPCs whose arg lists changed last:
  --    submit_onboarding = 5 args (shrunk to identity-only by
  --    20260901000006, when the rich intake fields moved to
  --    submit_intake), update_profile = 24 args (grew to cover every
  --    intake field, same migration). Wrong count = either a drifted
  --    overload or the wrong migration applied.
  select pronargs into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'submit_onboarding';
  if v_n is distinct from 5 then
    raise exception 'submit_onboarding has % args, expected 5', coalesce(v_n::text,'NONE');
  end if;
  select pronargs into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_profile';
  if v_n is distinct from 24 then
    raise exception 'update_profile has % args, expected 24', coalesce(v_n::text,'NONE');
  end if;
  raise notice 'OK  3  submit_onboarding(5) + update_profile(24) signatures intact';

  -- 4. RLS enabled on every base table in public (no table silently world-open).
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'RLS DISABLED on: %', v_bad;
  end if;
  raise notice 'OK  4  RLS enabled on all public base tables';

  -- 4b. Every RLS-enabled table has at least one policy (RLS with zero policies
  --     = locked shut for non-owners; usually a mistake unless intended).
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  if v_bad is not null then
    raise notice 'WARN 4b RLS on but NO policy (intended?): %', v_bad;
  else
    raise notice 'OK  4b every RLS table has >=1 policy';
  end if;

  -- 5. SECURITY DEFINER on the privileged RPCs (they bypass RLS by design;
  --    if one lost prosecdef it would run as the caller and break/leak).
  for v_bad in
    select want from (values
      ('submit_onboarding'),('update_profile'),('approve_user'),('reject_user'),
      ('delete_my_account'),('admin_create_event'),('admin_create_opportunity'),
      ('admin_create_vc_grant'),('enqueue_outbound_email'),('claim_outbound_email_batch'),
      -- Paginated list RPCs (20260826000003/4). These are how the directory
      -- and the two admin profile pages avoid PostgREST's silent 1000-row
      -- truncation; if one is missing, the page it backs is broken, and if
      -- one lost prosecdef the auth.users join in it would fail outright.
      ('list_directory_cards'),('list_directory_facets'),
      ('admin_list_profiles'),('admin_profile_facets'),('admin_list_pending_profiles')
    ) as x(want)
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = x.want and p.prosecdef
    )
  loop
    raise exception 'NOT SECURITY DEFINER (or missing): %', v_bad;
  end loop;
  raise notice 'OK  5  privileged RPCs are SECURITY DEFINER';

  -- 6. Society-flag column shipped by 20260603000002.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'is_society_event'
  ) then
    raise exception 'events.is_society_event column missing';
  end if;
  raise notice 'OK  6  events.is_society_event present';

  -- 7. Connections (20260917000001-4). Every item here is something that
  --    would be invisible if it drifted: the feature would keep working
  --    and quietly stop being safe.

  -- 7a. The three tables exist with RLS on and ZERO policies. Zero is the
  --     intent, not an oversight — the email-disclosure rule depends on
  --     the pair's status, the caller's membership of the pair, and both
  --     parties still being approved, which is more than a `using` clause
  --     can say. A policy appearing here means someone tried to express
  --     it anyway, and a policy that is nearly right leaks addresses.
  for v_bad in
    select x.want from (values
      ('connections'), ('connection_events'), ('connection_reports')
    ) as x(want)
    where not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = x.want
        and c.relkind = 'r' and c.relrowsecurity
    )
  loop
    raise exception 'MISSING or RLS-DISABLED connections table: %', v_bad;
  end loop;

  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('connections', 'connection_events', 'connection_reports')
    and exists (select 1 from pg_policy p where p.polrelid = c.oid);
  if v_bad is not null then
    raise exception 'UNEXPECTED RLS POLICY on deny-all connections table(s): %', v_bad;
  end if;
  raise notice 'OK  7a connections tables present, RLS on, zero policies (intended)';

  -- 7b. The canonical-pair unique index. This is what makes "A→B and B→A
  --     both exist" unrepresentable, which is the entire reason the
  --     simultaneous-mutual-request race needs no application logic. Lose
  --     it and nothing fails loudly — the duplicates just start arriving.
  if not exists (
    select 1 from pg_class i join pg_namespace n on n.oid = i.relnamespace
    where n.nspname = 'public' and i.relname = 'connections_pair_uniq' and i.relkind = 'i'
  ) then
    raise exception 'MISSING INDEX connections_pair_uniq — duplicate pairs are now possible';
  end if;
  raise notice 'OK  7b connections_pair_uniq present';

  -- 7c. The two NON-PARTIAL FK-cascade indexes. Postgres never indexes the
  --     referencing side of a foreign key, so without these a cohort
  --     delete via admin_delete_graduates is one sequential scan of
  --     `connections` PER GRADUATE inside a single locking transaction —
  --     the exact failure 20260827000002 was written to fix. They must
  --     stay non-partial: a `where status = 'accepted'` index cannot
  --     serve a cascade, which has to find rows in every status.
  for v_bad in
    select x.want from (values
      ('connections_requester_status_idx'), ('connections_addressee_status_idx')
    ) as x(want)
    where not exists (
      select 1 from pg_class i
      join pg_namespace n on n.oid = i.relnamespace
      join pg_index ix on ix.indexrelid = i.oid
      where n.nspname = 'public' and i.relname = x.want
        and ix.indpred is null      -- non-partial, and that is the point
    )
  loop
    raise exception 'MISSING or PARTIAL FK-cascade index: % (cohort deletes will seq-scan)', v_bad;
  end loop;
  raise notice 'OK  7c both FK-cascade indexes present and non-partial';

  -- 7c-ii. The purge index (20260917000014). Without it the nightly
  --     retention job sequentially scans the whole edge table — 49 ms at
  --     248k rows, and growing with total membership forever. It is not
  --     a correctness index, so its absence fails nothing visible; that
  --     is exactly why it is asserted here rather than left to be
  --     rediscovered by the next person to run the benchmark harness.
  if not exists (
    select 1 from pg_class i
    join pg_namespace n on n.oid = i.relnamespace
    join pg_index ix on ix.indexrelid = i.oid
    where n.nspname = 'public'
      and i.relname = 'connections_settled_purge_idx'
      and ix.indpred is not null      -- partial, and that is the point
  ) then
    raise exception 'MISSING INDEX connections_settled_purge_idx — the nightly purge will seq-scan connections';
  end if;
  raise notice 'OK  7c-ii settled-purge index present and partial';

  -- 7d. The privileged connections RPCs are SECURITY DEFINER. Each reads
  --     or writes tables with no policies at all; one that lost prosecdef
  --     would run as the caller and fail outright rather than leak — but
  --     it would fail on the member's screen, in production, at the only
  --     moment the feature matters.
  for v_bad in
    select want from (values
      ('send_connection_request'),('respond_to_connection_request'),
      ('withdraw_connection_request'),('remove_connection'),
      ('block_member'),('unblock_member'),('report_connection'),
      ('list_my_connections'),('list_my_pending_requests'),('list_my_sent_requests'),
      ('connection_state_with'),('my_pending_connection_count'),
      ('list_my_connection_graph'),('claim_connection_digests'),
      ('admin_resolve_connection_report'),('admin_reveal_connection_note'),
      -- 20260917000007. The only route back from a block: without it the
      -- blocker's sole option is finding the person again in a directory
      -- of thousands, which is exactly the search a blocker should not
      -- have to perform.
      ('list_my_blocked_members')
    ) as x(want)
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = x.want and p.prosecdef
    )
  loop
    raise exception 'NOT SECURITY DEFINER (or missing): %', v_bad;
  end loop;
  raise notice 'OK  7d connections RPCs are SECURITY DEFINER';

  -- 7e. The internal helpers are unreachable from every client role.
  --     REVOKE FROM public is a NO-OP on Supabase because anon and
  --     authenticated hold their own default grants ([[function-grant-
  --     default-privileges]]) — this repo has been bitten by that
  --     repeatedly, so the grants are enumerated here rather than
  --     inferred from the migration text.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'connection_refusal_message','connection_log_event',
      'connection_assert_can_send','connection_sender_throttled',
      'connection_clean_note','connection_limit_defaults',
      'expire_connection_requests','purge_removed_connections',
      'purge_connection_records','cron_connection_digest',
      'claim_connection_digests',
      -- Not a connections helper, but shipped on the same branch and
      -- internal for the same reason: it deletes rows.
      'purge_sent_outbound_email'
    )
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'INTERNAL connections function(s) reachable by anon/authenticated: %', v_bad;
  end if;
  raise notice 'OK  7e internal connections helpers are client-unreachable';

  -- 7f. The three app_config keys the MIGRATIONS seed. These are schema,
  --     so their absence is a hard failure: without them the feature
  --     falls back to shipped defaults and a permanently-off kill switch.
  select string_agg(k.key, ', ') into v_bad
  from (values ('connections_enabled'), ('connection_limits'),
               ('connection_consent_version')
  ) as k(key)
  where not exists (select 1 from public.app_config c where c.key = k.key);
  if v_bad is not null then
    raise exception 'MISSING app_config key(s): % — run snippets/seed_app_config.sql', v_bad;
  end if;
  raise notice 'OK  7f connections app_config keys present';

  -- 7f-ii. connections_digest_url is DEPLOYMENT config, not schema — it
  --     legitimately does not exist on a local stack, which is why this
  --     is a warning and not an exception, matching how the other three
  --     cron URLs are treated (absent from this file entirely).
  --
  --     But it is the worst of the four to forget, because it fails
  --     QUIETLY: cron_connection_digest raises a warning, SUCCEEDS, and
  --     mails nobody, for the rest of time. The member-facing symptom is
  --     "nobody ever answers my connection requests", which no one would
  --     think to report as a bug. On prod, this line must read OK.
  if not exists (select 1 from public.app_config where key = 'connections_digest_url') then
    raise notice 'WARN 7f-ii connections_digest_url MISSING — expected locally; on PROD the digest will silently mail nobody. Run snippets/seed_app_config.sql';
  else
    raise notice 'OK  7f-ii connections_digest_url present';
  end if;

  -- 7g. The four cron jobs are registered. A schedule that silently
  --     failed to register means pending requests never expire, removed
  --     connections are never actually deleted (the hard delete a member
  --     asked for is merely deferred, not cancelled), no digest ever
  --     goes out, and the outbound queue quietly becomes a permanent
  --     archive of message bodies again.
  for v_bad in
    select x.want from (values
      ('expire-connection-requests-daily'),
      ('purge-connection-records-daily'),
      ('connections-digest-daily'),
      ('purge-outbound-email-daily')
    ) as x(want)
    where not exists (select 1 from cron.job j where j.jobname = x.want and j.active)
  loop
    raise exception 'MISSING or INACTIVE cron job: %', v_bad;
  end loop;
  raise notice 'OK  7g connections cron jobs registered and active';

  raise notice '─── ALL ASSERTIONS PASSED ───';
end $$;

-- ──────────────────────────────────────────────────────────────────────
-- Snapshot to eyeball (counts should look sane; no assertion here)
-- ──────────────────────────────────────────────────────────────────────

-- Function inventory + overload count per name.
select p.proname,
       count(*)                                   as overloads,
       bool_and(p.prosecdef)                      as security_definer,
       string_agg(p.pronargs::text, '/' order by p.pronargs) as arg_counts
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
group by p.proname
order by p.proname;

-- Per-table: RLS flag + policy count.
select c.relname                                  as table_name,
       c.relrowsecurity                           as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- User-defined triggers per table (excludes internal FK/constraint triggers).
select c.relname as table_name, t.tgname as trigger_name
from pg_trigger t
join pg_class c   on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','auth') and not t.tgisinternal
order by c.relname, t.tgname;
