-- ════════════════════════════════════════════════════════════════════
-- Foundry · Connections — tables, indexes, RLS, configuration
--
-- A LinkedIn-shaped mutual connection graph whose single payoff is an
-- EMAIL EXCHANGE. Profile links (LinkedIn, GitHub, portfolio, venture)
-- are already on every member's directory card, so gating those would be
-- theatre. The one thing not discoverable today is a member's address,
-- which lives solely in auth.users.email — `profiles` has no email
-- column and deliberately still does not after this migration.
--
-- WHY THE ANTI-HARVESTING DESIGN IS AS HEAVY AS IT IS.
-- Students sign up with predictable @imperial.ac.uk addresses, so their
-- exposure here is near zero. Alumni, mentors and angel investors pass
-- manual review with PERSONAL addresses. Those are the high-value,
-- non-guessable disclosures, and they belong to exactly the cohort a
-- harvester would target. Every cap, cooldown and throttle below exists
-- for those rows, not for the students'.
--
-- THE CENTRAL DESIGN CHOICE: ONE ROW PER PAIR, FOR LIFE.
-- `connections_pair_uniq` is keyed on the UNORDERED pair, which makes
-- "A→B and B→A both exist" unrepresentable. The simultaneous-mutual-
-- request race therefore needs no application logic — the database
-- refuses it. Mirror rows (one per side) were rejected: they make
-- A-thinks-connected/B-doesn't a reachable state, and every write path
-- would have to keep both halves in lockstep forever.
--
-- The cost is that "my connections" is `requester_id = me OR
-- addressee_id = me`. That is paid once, inside the read RPC, as a
-- UNION ALL of two index scans rather than an OR — see the RPC
-- migration for why.
--
-- DIRECTION CAN REVERSE ON REUSE. A re-request after a lapsed cooldown
-- UPDATEs the existing row back to 'pending' rather than inserting, so
-- the table stays one-row-per-pair permanently. When A's declined
-- request is later re-sent BY B, the same row is reused with
-- requester_id and addressee_id SWAPPED. Forgetting this is the most
-- likely source of a wrong-way-round bug; a re-request must always
-- rewrite both id columns and never assume the existing orientation.
--
-- Note on the `ensure_rls` event trigger: it exists in prod and not in
-- this repo (see 20260608000002), so every table below enables RLS
-- explicitly rather than relying on it. A fresh local stack has no such
-- trigger.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. connections ─────────────────────────────────────────────────
-- Current state. One row per pair, for the life of the pair.
--
-- `note` PERSISTS for the life of the row rather than being cleared
-- when the request leaves 'pending'. That is deliberate and the reason
-- is moderation, not sentiment: someone declines an unpleasant message
-- and only then thinks "actually, I should report that". Clearing the
-- note on decline would hand them an empty report form at precisely the
-- moment the text matters. It is replaced, not appended, on re-request.
--
-- `decided_at` means "when this row left 'pending'", including expiry.
-- The constraint below pins that meaning so it cannot drift.
create table if not exists public.connections (
  id              uuid        primary key default gen_random_uuid(),
  requester_id    uuid        not null references public.profiles(id) on delete cascade,
  addressee_id    uuid        not null references public.profiles(id) on delete cascade,
  status          text        not null default 'pending',
  note            text,
  -- Which copy of the consent wording the accepter was shown. UK GDPR
  -- Art. 7(1) requires consent to be DEMONSTRABLE; without a version
  -- stamp a later rewording leaves no record of what anyone agreed to.
  consent_version text,
  -- Which side blocked. Only the blocker may unblock, so this cannot be
  -- inferred from the requester/addressee orientation.
  blocked_by      uuid,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  -- Claimed by the digest cron. Claim-then-send, so a pending request
  -- can only ever be digested once, with no time-window arithmetic.
  digested_at     timestamptz,
  -- Set on decline, withdraw and remove. Until it lapses, neither party
  -- may re-request the other.
  cooldown_until  timestamptz,

  constraint connections_no_self check (requester_id <> addressee_id),

  -- 'removed' is a real, persisted state rather than an immediate
  -- delete. Removal is not a decline, so it would otherwise carry no
  -- cooldown — letting someone remove, instantly re-request, and repeat:
  -- a harassment loop bounded only by the daily cap. The row is hard-
  -- deleted by cron once the cooldown lapses, so deletion is preserved,
  -- just deferred three weeks.
  constraint connections_status_valid check (
    status in ('pending', 'accepted', 'declined', 'withdrawn', 'expired', 'blocked', 'removed')
  ),

  -- length() is character-based, so this bound is unicode-safe.
  constraint connections_note_len check (note is null or length(note) between 1 and 300),

  constraint connections_blocked_by_consistency check (
    (status =  'blocked' and blocked_by is not null) or
    (status <> 'blocked' and blocked_by is null)
  ),

  -- No accepted row without consent evidence. This is the Art. 7(1)
  -- guarantee expressed as a constraint rather than a convention,
  -- because a null here would only ever be noticed at the moment it
  -- mattered.
  constraint connections_accepted_has_consent check (
    status <> 'accepted' or consent_version is not null
  ),

  constraint connections_decided_at_consistency check (
    (status =  'pending' and decided_at is null) or
    (status <> 'pending' and decided_at is not null)
  )
);

-- THE central index. Keyed on the unordered pair, so the same two
-- members can never hold two rows in either orientation.
create unique index if not exists connections_pair_uniq
  on public.connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- Inbox: "requests waiting on me", newest first.
create index if not exists connections_inbox_idx
  on public.connections (addressee_id, created_at desc)
  where status = 'pending';

-- Sent list: "requests I am waiting on".
create index if not exists connections_sent_idx
  on public.connections (requester_id, created_at desc)
  where status = 'pending';

-- The two halves of list_my_connections' UNION ALL. Both are pre-sorted
-- on the same key the RPC orders by, so each half is a single index
-- descent and the merge is free.
create index if not exists connections_accepted_requester_idx
  on public.connections (requester_id, decided_at desc)
  where status = 'accepted';

create index if not exists connections_accepted_addressee_idx
  on public.connections (addressee_id, decided_at desc)
  where status = 'accepted';

-- The digest's claim scan. Partial on both predicates, so it holds only
-- rows the cron can actually act on and empties itself as they are
-- claimed.
create index if not exists connections_digest_pending_idx
  on public.connections (addressee_id)
  where status = 'pending' and digested_at is null;

-- The expiry and removed-row-purge scans.
create index if not exists connections_lifecycle_idx
  on public.connections (status, created_at)
  where status in ('pending', 'removed');

-- ─── The two FK-cascade indexes, which are NOT read-path indexes ────
-- This repo has already been bitten by this once; see
-- 20260827000002_index_cascade_fks.sql for the incident.
--
-- Postgres indexes the REFERENCED side of a foreign key automatically —
-- it has to, that is the primary key — and NEVER the referencing side.
-- So an unindexed FK turns every delete of a referenced row into a
-- sequential scan of the referencing table, once per deleted row.
-- `admin_delete_graduates` deletes an entire cohort in one statement,
-- which makes that one full scan of `connections` PER GRADUATE, inside
-- a single transaction holding locks.
--
-- The trap specific to this table: every other addressee_id index above
-- is PARTIAL, and a `where status = 'accepted'` index cannot serve a
-- cascade, which has to find the member's rows in EVERY status.
-- requester_id happens to be covered by the non-partial composite
-- below; addressee_id would not have been.
--
-- These two also serve the daily/weekly/outstanding cap counts, so they
-- are not dead weight — but the cascade is why they are non-partial,
-- and they must stay that way.
create index if not exists connections_requester_status_idx
  on public.connections (requester_id, status);

create index if not exists connections_addressee_status_idx
  on public.connections (addressee_id, status);

-- No CONCURRENTLY concern here, unlike 20260827000002: these indexes are
-- built on a brand-new empty table in the same migration that creates
-- it, so the ACCESS EXCLUSIVE lock is instantaneous and uncontended.

alter table public.connections enable row level security;
-- No policies → deny-all, for members and admins alike. Every access
-- goes through a SECURITY DEFINER RPC. The email-disclosure rule is
-- conditional on the pair's status, the caller's membership of the
-- pair, and both parties still being approved — too much to express in
-- a `using` clause, and a policy that is nearly right here leaks
-- addresses.


-- ─── 2. connection_events ───────────────────────────────────────────
-- Append-only history. This is what the reputation throttle counts and
-- what gives the admin queue an audit trail.
--
-- NO FOREIGN KEY on connection_id, actor_id or subject_id, deliberately,
-- following post_moderation_log (20260829000001) and admin_actions
-- verbatim. If these cascaded, a member could destroy the record of
-- their own behaviour by deleting their account — and this table exists
-- precisely for the case where that record matters. It also has to
-- survive the hard deletion of the connection row it describes.
--
-- Lawful basis for retaining it past an erasure request: UK GDPR
-- Article 17(3)(e), retention for the establishment, exercise or
-- defence of legal claims. Bounded to 12 months and purged by cron, the
-- same window post_reports and post_moderation_log use.
-- THE actor/subject CONVENTION, which the throttle depends on and which
-- is easy to get backwards:
--
--   actor_id    the member who DID the thing (null for cron events)
--   subject_id  the member it was done TO / about
--
-- So for 'blocked', actor is the blocker and subject is the member who
-- got blocked. The reputation throttle counts DISTINCT ACTORS against a
-- given subject, which is why the actor index below exists.
--
-- 'report_upheld' bends this deliberately: its actor_id is the ORIGINAL
-- REPORTER, not the admin who upheld it. The throttle asks "how many
-- distinct members raised a signal about this person", and recording
-- the admin there would make five upheld reports from one reporter look
-- like five independent signals — or, worse, make one admin resolving
-- five reports look like one signal. The admin's identity is recorded
-- in admin_actions, which is where an admin's actions belong.
create table if not exists public.connection_events (
  id            uuid        primary key default gen_random_uuid(),
  connection_id uuid        not null,
  -- Nullable: cron-driven events (expiry, purge) have no actor.
  actor_id      uuid,
  -- Denormalised "who this event is ABOUT", so the reputation count is
  -- a single index scan and never has to re-derive the other party from
  -- a connection row that may no longer exist.
  subject_id    uuid        not null,
  event         text        not null,
  created_at    timestamptz not null default now(),
  purge_after   timestamptz not null default now() + interval '12 months',

  constraint connection_events_event_valid check (
    event in ('requested', 'accepted', 'declined', 'withdrawn', 'blocked',
              'unblocked', 'removed', 'expired', 'reported', 'report_upheld',
              'throttle_cleared')
  )
);

-- The reputation count: distinct ACTORS who raised a signal against a
-- given subject, within a window.
create index if not exists connection_events_subject_idx
  on public.connection_events (subject_id, event, created_at desc);

-- The send-rate counts. Daily and weekly caps are counted from
-- 'requested' EVENTS rather than from connections.created_at, because a
-- re-request reuses and resets the connection row — so the row count
-- silently under-counts how many requests a member has actually fired.
-- An append-only log cannot be reset by row reuse.
create index if not exists connection_events_actor_idx
  on public.connection_events (actor_id, event, created_at desc);

-- Admin drill-down into one connection's history.
create index if not exists connection_events_connection_idx
  on public.connection_events (connection_id, created_at desc);

-- The 12-month purge.
create index if not exists connection_events_purge_idx
  on public.connection_events (purge_after);

alter table public.connection_events enable row level security;
-- No policies → deny-all, including for admins, matching
-- post_moderation_log. An audit log the application can read is one the
-- application can be tricked into leaking. Read it with the service
-- role or from the SQL editor.


-- ─── 3. connection_reports ──────────────────────────────────────────
-- Mirrors post_reports (20260829000001). The report route is not
-- optional: a UK user-to-user service has to run a complaints mechanism
-- and act on illegal content once it knows about it, and the optional
-- 300-character note makes this feature user-to-user content.
--
-- note_snapshot is the one addition over post_reports, and it is
-- load-bearing. `remove_connection` and the removed-row purge both
-- hard-delete the connection row, so a report pointing at a deleted
-- connection would otherwise be unadjudicable — the admin would see a
-- complaint about a message that no longer exists anywhere.
create table if not exists public.connection_reports (
  id                 uuid        primary key default gen_random_uuid(),
  -- NO FK, same reasoning as connection_events: the report must outlive
  -- the connection it is about.
  connection_id      uuid        not null,
  reporter_id        uuid        references auth.users(id) on delete set null,
  reported_member_id uuid        references auth.users(id) on delete set null,
  category           text        not null,
  reason             text        not null,
  -- The note text as it stood when the report was filed. Null when the
  -- request carried no note.
  note_snapshot      text,
  status             text        not null default 'open',
  resolved_by        uuid        references auth.users(id) on delete set null,
  resolved_at        timestamptz,
  resolution_note    text,
  created_at         timestamptz not null default now(),
  purge_after        timestamptz not null default now() + interval '12 months',

  -- Shaped around the illegal-content categories a UK service is
  -- expected to act on, plus the two that actually matter for a
  -- connection request.
  constraint connection_reports_category check (
    category in ('harassment', 'spam', 'impersonation', 'illegal', 'hate', 'sexual', 'other')
  ),
  constraint connection_reports_status check (status in ('open', 'actioned', 'dismissed')),
  constraint connection_reports_reason_len check (length(reason) between 1 and 1000),
  constraint connection_reports_resolution check (
    (status =  'open' and resolved_at is null     and resolved_by is null) or
    (status <> 'open' and resolved_at is not null and resolved_by is not null)
  )
);

-- One report per person per connection. The cheapest defence against
-- report-bombing, and the same "make the duplicate impossible" move
-- post_reports uses.
create unique index if not exists connection_reports_one_per_reporter_idx
  on public.connection_reports (connection_id, reporter_id);

-- The admin queue: open reports, newest first.
create index if not exists connection_reports_status_idx
  on public.connection_reports (status, created_at desc);

-- FK-cascade indexes. `on delete set null` still has to FIND the
-- referencing rows, so it scans exactly as a cascade would — the
-- 20260827000002 rule applies to SET NULL too, not only to CASCADE.
create index if not exists connection_reports_reporter_idx
  on public.connection_reports (reporter_id);

create index if not exists connection_reports_reported_idx
  on public.connection_reports (reported_member_id);

create index if not exists connection_reports_resolved_by_idx
  on public.connection_reports (resolved_by);

-- The 12-month purge.
create index if not exists connection_reports_purge_idx
  on public.connection_reports (purge_after);

alter table public.connection_reports enable row level security;
-- No policies → deny-all. report_connection writes;
-- admin_list_connection_reports and admin_resolve_connection_report
-- read and update. A reporter cannot read the table back: knowing which
-- of your requests has been reported, and by whom, is exactly what
-- makes reporting unsafe to use.


-- ─── 4. profiles: two new columns ───────────────────────────────────
-- connection_emails_enabled is not politeness. Auth mail and connection
-- digests share one sending domain, so spam complaints on digests
-- degrade SIGN-IN email deliverability. The opt-out protects the
-- domain, which is why it defaults on but must exist.
alter table public.profiles
  add column if not exists connection_emails_enabled boolean not null default true;

-- open_to_connections is a pause switch. Committee members, mentors and
-- angels are the most visible people in the directory and will receive
-- the most requests; without this, a swamped mentor's only options are
-- declining forty requests or disengaging from the platform entirely.
--
-- When false, send_connection_request refuses with the SAME generic
-- message as block and cooldown, so it cannot be used to probe. Existing
-- connections and already-pending requests are unaffected.
alter table public.profiles
  add column if not exists open_to_connections boolean not null default true;


-- ─── 4b. Table-grant lockdown ───────────────────────────────────────
-- RLS with no policies already denies every one of these roles, so this
-- is defence in depth rather than the control — but it is not
-- ceremonial either.
--
-- Supabase's default privileges hand `anon` and `authenticated` full
-- table grants on everything created in `public`, and `revoke ... from
-- public` does NOT take them away, because those two hold their own
-- direct grants. This repo has been bitten by the function-level version
-- of exactly that, repeatedly ([[function-grant-default-privileges]]).
--
-- With the grants in place, "is this data safe" has a single answer:
-- RLS is on and has no policies. With them revoked it has two
-- independent ones. Given that the data here is other people's email
-- addresses and a private note, one is not enough — an RLS policy added
-- later by someone who does not know that zero-policies was deliberate
-- would otherwise open the table immediately.
--
-- service_role is deliberately untouched: the digest route reads through
-- it, and it bypasses RLS anyway.
revoke all on public.connections        from anon, authenticated;
revoke all on public.connection_events  from anon, authenticated;
revoke all on public.connection_reports from anon, authenticated;


-- ─── 5. Kill switch ─────────────────────────────────────────────────
-- Same shape as github_cv_ingestion_enabled() (20260911000003): an
-- app_config flag read through a SECURITY DEFINER function, seeded
-- 'true' so the missing-row fallback is never exercised in the common
-- case, and still defaulting to false if the row is ever deleted.
--
-- IT GATES NEW REQUESTS ONLY. Accept, decline, withdraw, block, report
-- and remove all keep working while it is off, and the digest keeps
-- running. Gating everything would strand every member mid-handshake
-- with an inbox they cannot clear — a kill switch should stop the
-- inflow, not trap the people already inside it.
insert into public.app_config (key, value)
values ('connections_enabled', 'true')
on conflict (key) do nothing;

create or replace function public.connections_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value = 'true' from public.app_config where key = 'connections_enabled'),
    false
  );
$$;

revoke execute on function public.connections_enabled() from public, anon;
grant  execute on function public.connections_enabled() to authenticated;


-- ─── 6. Tunable limits ──────────────────────────────────────────────
-- Every threshold in this feature lives in ONE app_config row, so
-- tuning a cap after launch is a SQL update rather than a migration
-- plus a deploy. Caps that need a deploy to change do not get changed.
--
-- WHAT THE NUMBERS MEAN:
--   daily_cap   10  new requests per rolling 24h
--   weekly_cap  25  per rolling 7 days — the real budget (~3.5/day)
--   outstanding 30  requests sitting unanswered AT ONCE (a stock, not a
--                   rate). This is the cap that actually stops
--                   harvesting: rate caps alone let someone send 25 a
--                   week into the void forever, whereas requiring that
--                   people answer you before you send more means a
--                   member nobody responds to grinds to a halt on their
--                   own, with nobody having to report them.
--
-- The daily and weekly caps do different jobs. Nobody networks evenly —
-- you come back from a careers evening wanting to add eight people.
-- 10/day allows that burst; 25/week stops it becoming every day.
--
-- For scale: LinkedIn is roughly 100/week. Four times tighter is
-- deliberate. This community is ~2,000 people, not a billion, and the
-- payoff here is somebody's actual email address.
--
--   cooldown_days 21  before the same pair may be re-requested
--   expiry_months  6  until a pending request expires
--   note_max_chars 300 (also pinned by a CHECK constraint above)
--   throttle_*        see the reputation throttle in the RPC migration
--   digest_min_hours 20  guard against a cron misfire double-sending
insert into public.app_config (key, value)
values ('connection_limits', jsonb_build_object(
  'daily_cap',                 10,
  'weekly_cap',                25,
  'outstanding_cap',           30,
  'cooldown_days',             21,
  'expiry_months',              6,
  'note_max_chars',           300,
  'throttle_distinct_signals',  5,
  'throttle_lookback_days',    90,
  'throttle_duration_days',    30,
  'throttle_daily_cap',         3,
  'digest_min_hours',          20
)::text)
on conflict (key) do nothing;

-- The shipped defaults, in one place, as the single source of truth for
-- both functions below. Deleting or corrupting the app_config row falls
-- back to exactly these — it can never fall back to "no limit".
create or replace function public.connection_limit_defaults()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'daily_cap',                 10,
    'weekly_cap',                25,
    'outstanding_cap',           30,
    'cooldown_days',             21,
    'expiry_months',              6,
    'note_max_chars',           300,
    'throttle_distinct_signals',  5,
    'throttle_lookback_days',    90,
    'throttle_duration_days',    30,
    'throttle_daily_cap',         3,
    'digest_min_hours',          20
  );
$$;

revoke execute on function public.connection_limit_defaults() from public, anon, authenticated;

-- The merged view: defaults on the left, stored config on the right, so
-- `||` lets a stored key win and a MISSING key fall through to its
-- default. Adding a new limit in a later migration therefore does not
-- require rewriting the stored row.
--
-- Malformed JSON returns the defaults rather than raising. A typo in a
-- config row must not take the feature down, and it must especially not
-- take it down in the direction of "no limits applied".
create or replace function public.connection_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw    text;
  v_stored jsonb;
begin
  select value into v_raw from public.app_config where key = 'connection_limits';

  if v_raw is null or btrim(v_raw) = '' then
    return public.connection_limit_defaults();
  end if;

  begin
    v_stored := v_raw::jsonb;
  exception when others then
    return public.connection_limit_defaults();
  end;

  if jsonb_typeof(v_stored) <> 'object' then
    return public.connection_limit_defaults();
  end if;

  return public.connection_limit_defaults() || v_stored;
end;
$$;

revoke execute on function public.connection_limits() from public, anon;
grant  execute on function public.connection_limits() to authenticated;

-- The accessor every RPC actually calls. Validates on the way out, so a
-- hand-edited config row containing "banana", -5 or 10.5 yields the
-- shipped default for that key instead of a cast error mid-transaction
-- or a nonsensical cap.
--
-- Zero IS allowed and meaningful: `daily_cap = 0` is how you stop new
-- requests for everyone without touching the kill switch.
create or replace function public.connection_limit(p_key text)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_defaults constant jsonb := public.connection_limit_defaults();
  v_val      jsonb;
  v_out      numeric;
begin
  if not (v_defaults ? p_key) then
    raise exception 'Unknown connection limit key: %', p_key using errcode = '22023';
  end if;

  v_val := public.connection_limits() -> p_key;

  if v_val is null or jsonb_typeof(v_val) <> 'number' then
    return (v_defaults ->> p_key)::int;
  end if;

  v_out := floor((v_val #>> '{}')::numeric);

  -- A fat-fingered 100000 is not a policy decision, it is a typo.
  if v_out < 0 or v_out > 100000 then
    return (v_defaults ->> p_key)::int;
  end if;

  return v_out::int;
end;
$$;

revoke execute on function public.connection_limit(text) from public, anon;
grant  execute on function public.connection_limit(text) to authenticated;


-- ─── 7. Consent version ─────────────────────────────────────────────
-- Accepting a connection request is the act that discloses two email
-- addresses, so it is the consent event, and UK GDPR Art. 7(1) requires
-- that consent be DEMONSTRABLE. `connections.consent_version` is that
-- evidence — but only if it records the wording the member actually
-- SAW, not merely that some dialog appeared.
--
-- So the version is SERVER-SIDE, here, rather than a string the client
-- invents. The UI reads it, renders the copy that matches it, and sends
-- it back; the RPC refuses the write if it does not match what the
-- server currently considers live.
--
-- That mismatch is a real case, not a theoretical one: deploy new
-- wording while somebody has the dialog open and their client is now
-- showing superseded copy. Refusing — and asking them to refresh — is
-- the correct behaviour for a consent flow. Silently stamping the new
-- version against the old wording would make the evidence a lie, which
-- is worse than an error message.
--
-- Bump this ONLY when the consent copy in
-- frontend/src/lib/connections/consent.ts changes, and add the new
-- wording there under the new key rather than editing the old entry —
-- rows stamped with the old version must stay interpretable.
insert into public.app_config (key, value)
values ('connection_consent_version', '2026-09-17')
on conflict (key) do nothing;

create or replace function public.connection_consent_version()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(value), '') from public.app_config where key = 'connection_consent_version'),
    '2026-09-17'
  );
$$;

revoke execute on function public.connection_consent_version() from public, anon;
grant  execute on function public.connection_consent_version() to authenticated;
