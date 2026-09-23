-- ════════════════════════════════════════════════════════════════════
-- Foundry · Connection digest: lease + atomic complete + daily budget
--
-- Found by the C6 launch-capacity audit, re-verified against the code.
--
-- WHAT WAS WRONG with claim_connection_digests (20260917000004):
--
--   1. It limited REQUEST ROWS before grouping by recipient, so a member
--      with five pending requests could be told about two today and
--      three tomorrow.
--   2. It stamped digested_at BEFORE the route enqueued the mail. A
--      crash or timeout in between lost those digests for good — the
--      documented at-most-once tradeoff.
--   3. `digest_min_hours` (20) was registered as a limit and read by
--      nothing. There was no per-recipient spacing at all.
--   4. One run a day at 200 rows, with nothing tying volume to the email
--      budget that sign-in codes share.
--
-- THE NEW SHAPE. Two functions, both service-role only:
--
--   claim_connection_digests(p_limit)
--     Reserves RECIPIENTS, not rows: up to p_limit members, every
--     eligible pending row of each, stamped with a claim id and a lease
--     time. It does NOT set digested_at. Serialised by an advisory lock
--     so two runs can never both spend the same budget.
--
--   complete_connection_digests(p_claim_id, p_emails)
--     In ONE transaction: stamps digested_at on the rows still holding
--     this claim id and inserts the outbound_email row. Both or neither.
--
-- If the route dies between the two, nothing was stamped and nothing was
-- queued; the lease lapses after 10 minutes and a later run re-claims
-- under a NEW claim id. A stale completer that wakes up afterwards
-- matches zero rows and queues nothing. That is exactly-once without a
-- dedupe key, and without touching outbound_email or enqueueEmailsBulk,
-- which other paths share.
--
-- THE PAYLOAD STILL CARRIES NAMES AND COUNTS, NEVER NOTE TEXT — see the
-- reasoning on the original function in 20260917000004. Unchanged.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. Lease columns ───────────────────────────────────────────────
-- Nullable, no default: a catalog-only change, no table rewrite. The
-- table has zero RLS policies and revoked client grants (20260917000001
-- §4b), so neither column is visible to any member.
--
-- send_connection_request's row reuse resets digested_at but not these.
-- That is fine by construction: a claim only counts while its lease is
-- live, and a reused row with a stale claim id is simply eligible again.
alter table public.connections
  add column if not exists digest_claim_id   uuid,
  add column if not exists digest_claimed_at timestamptz;

-- Serves the per-recipient spacing check and the daily budget count.
-- Partial, so it only holds rows that have ever been digested.
create index if not exists connections_digested_recent_idx
  on public.connections (addressee_id, digested_at)
  where digested_at is not null;


-- ─── 2. The budget knob ─────────────────────────────────────────────
-- digest_daily_cap: recipients mailed per rolling 24h. 40 is safe on
-- Resend's free tier (100/day, shared with sign-in codes). Raise it with
-- one SQL update once the paid plan is live; 0 pauses digests.
--
-- Body copied from the LATEST definition (20260917000012), plus the key.
create or replace function public.connection_limit_defaults()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'daily_cap',                 10,
    'weekly_cap',                25,
    'outstanding_cap',           30,
    'block_daily_cap',           20,
    'cooldown_days',             21,
    'expiry_months',              6,
    'note_max_chars',           300,
    'throttle_distinct_signals',  5,
    'throttle_lookback_days',    90,
    'throttle_duration_days',    30,
    'throttle_daily_cap',         3,
    'digest_min_hours',          20,
    'digest_daily_cap',          40
  );
$$;

revoke execute on function public.connection_limit_defaults() from public, anon, authenticated;

update public.app_config
   set value = (value::jsonb || jsonb_build_object('digest_daily_cap', 40))::text
 where key = 'connection_limits'
   and value is not null
   and btrim(value) <> ''
   and (value::jsonb) ? 'daily_cap'
   and not ((value::jsonb) ? 'digest_daily_cap');


-- ─── 3. claim_connection_digests ────────────────────────────────────
-- Dropped rather than replaced: the return type changes (claim_id added,
-- email removed), which create-or-replace cannot do, and a second
-- signature would leave a dead overload behind.
--
-- The email column is gone on purpose. complete reads the address live
-- from auth.users, so it never travels through the route at all.
drop function if exists public.claim_connection_digests(int);

create function public.claim_connection_digests(p_limit int default 50)
returns table (
  claim_id      uuid,
  member_id     uuid,
  first_name    text,
  pending_count int,
  sender_names  text[]
)
language plpgsql
security definer
set search_path = public, auth
as $$
#variable_conflict use_column
declare
  v_claim  constant uuid     := gen_random_uuid();
  v_lease  constant interval := interval '10 minutes';
  v_quiet  constant interval := make_interval(hours => public.connection_limit('digest_min_hours'));
  v_budget int;
  v_take   int;
begin
  -- One claimer at a time. Without this two overlapping runs would each
  -- read the same remaining budget and together overspend it.
  perform pg_advisory_xact_lock(hashtext('public.claim_connection_digests'));

  -- Budget left = cap minus recipients mailed in the last 24h, minus
  -- recipients held by a live lease (a claim still being completed).
  select public.connection_limit('digest_daily_cap') - count(distinct c.addressee_id)
    into v_budget
    from public.connections c
   where c.digested_at > now() - interval '24 hours'
      or (c.status = 'pending'
          and c.digested_at is null
          and c.digest_claimed_at > now() - v_lease);

  v_take := least(greatest(1, least(coalesce(p_limit, 50), 200)), v_budget);
  if v_take <= 0 then
    return;
  end if;

  return query
  with eligible as materialized (
    select c.id, c.addressee_id, c.created_at
      from public.connections c
      join public.profiles rp on rp.id = c.requester_id
      join public.profiles ap on ap.id = c.addressee_id
      join auth.users      u  on u.id  = c.addressee_id
     where c.status = 'pending'
       and c.digested_at is null
       and (c.digest_claimed_at is null or c.digest_claimed_at <= now() - v_lease)
       -- Both ends re-checked: a banned sender's request is not worth an
       -- email, and a banned recipient is not getting one.
       and rp.status = 'approved'
       and ap.status = 'approved'
       -- The opt-out. Rows are left UNCLAIMED, so turning digests back
       -- on yields one summary of what is waiting.
       and ap.connection_emails_enabled
       -- An address outbound_email's CHECK would reject must never be
       -- claimed: it would fail complete's transaction and take every
       -- other recipient in the batch down with it, on every run.
       and u.email is not null
       and length(u.email) between 3 and 320
       -- Spacing: one digest per recipient per digest_min_hours. A
       -- request arriving after this morning's mail waits for tomorrow's.
       and not exists (
         select 1 from public.connections d
          where d.addressee_id = c.addressee_id
            and d.digested_at > now() - v_quiet
       )
  ),
  recipients as (
    -- Oldest waiting request first, so a backlog drains FIFO and nobody
    -- is starved by newer arrivals.
    select e.addressee_id
      from eligible e
     group by e.addressee_id
     order by min(e.created_at), e.addressee_id
     limit v_take
  ),
  locked as (
    -- `of c`: lock the request rows only, never the profiles. The
    -- status/digested predicates are repeated so a row changed by a
    -- member between the scan and the lock is re-checked, not claimed.
    select c.id
      from public.connections c
     where c.id in (select e.id from eligible e join recipients r using (addressee_id))
       and c.status = 'pending'
       and c.digested_at is null
       for update of c skip locked
  ),
  claimed as (
    update public.connections c
       set digest_claim_id   = v_claim,
           digest_claimed_at = now()
      from locked l
     where c.id = l.id
    returning c.addressee_id, c.requester_id
  )
  select
    v_claim,
    ap.id,
    ap.first_name,
    count(*)::int,
    array_agg(
      trim(coalesce(rp.preferred_name, rp.first_name, '') || ' ' || coalesce(rp.surname, ''))
      order by rp.first_name, rp.surname
    )
  from claimed cl
  join public.profiles ap on ap.id = cl.addressee_id
  join public.profiles rp on rp.id = cl.requester_id
  group by ap.id, ap.first_name;
end;
$$;

revoke execute on function public.claim_connection_digests(int) from public, anon, authenticated;
grant  execute on function public.claim_connection_digests(int) to service_role;


-- ─── 4. complete_connection_digests ─────────────────────────────────
-- p_emails: [{ "member_id": uuid, "subject": text, "text": text,
--              "html": text }, ...] — rendered by the route.
--
-- The recipient address is NEVER taken from the payload. It is read live
-- from auth.users, so this cannot be used as a relay even by a caller
-- holding the service key, and a member who changed their login address
-- since the claim is mailed at the new one.
--
-- Per recipient, everything is re-checked at the moment of stamping:
--   * still approved and still opted in — an opt-out mid-flight leaves
--     the rows unstamped, exactly as if it had happened before the claim;
--   * each row still pending, still undigested, still under THIS claim;
--   * its sender still approved, so a sender banned in the last few
--     seconds is not named in somebody's inbox.
-- No row stamped → no mail. A payload entry that would fail a CHECK is
-- skipped rather than raised, for the same poison-pill reason as above.
create or replace function public.complete_connection_digests(
  p_claim_id uuid,
  p_emails   jsonb
)
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r        jsonb;
  v_member uuid;
  v_email  text;
  v_n      int;
  v_sent   int := 0;
begin
  if p_claim_id is null or jsonb_typeof(p_emails) is distinct from 'array' then
    raise exception 'complete_connection_digests: p_claim_id and a JSON array are required'
      using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_emails) loop
    v_member := (r->>'member_id')::uuid;

    if length(coalesce(r->>'subject', '')) not between 1 and 998
       or r->>'text' is null
       or r->>'html' is null then
      continue;
    end if;

    v_email := null;
    select u.email into v_email
      from auth.users u
      join public.profiles ap on ap.id = u.id
     where u.id = v_member
       and ap.status = 'approved'
       and ap.connection_emails_enabled;

    if v_email is null or length(v_email) not between 3 and 320 then
      continue;
    end if;

    update public.connections c
       set digested_at = now()
      from public.profiles rp
     where rp.id = c.requester_id
       and rp.status = 'approved'
       and c.addressee_id    = v_member
       and c.digest_claim_id = p_claim_id
       and c.status          = 'pending'
       and c.digested_at is null;
    get diagnostics v_n = row_count;

    if v_n = 0 then
      continue;
    end if;

    insert into public.outbound_email (to_address, subject, text_body, html_body)
    values (v_email, r->>'subject', r->>'text', r->>'html');
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.complete_connection_digests(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.complete_connection_digests(uuid, jsonb) to service_role;


-- ─── 5. Schedule: a morning window instead of one shot ──────────────
-- Every 15 minutes, 08:00–11:45 UTC (16 runs). At 50 recipients a run
-- that is up to 800/day, always bounded by digest_daily_cap. The drain
-- sends 60 per 15 minutes, so each run's mail clears before the next and
-- other queued mail waits at most ~15 minutes behind it. The repeats are
-- also the crash retry: a lapsed lease is picked up by a later run.
--
-- Same job name, so every check that looks for it still finds it.
-- cron_connection_digest() itself is unchanged.
do $$
begin
  begin perform cron.unschedule('connections-digest-daily'); exception when others then null; end;
end;
$$;

select cron.schedule(
  'connections-digest-daily',
  '*/15 8-11 * * *',
  $$select public.cron_connection_digest();$$
);
