-- ════════════════════════════════════════════════════════════════════
-- Foundry · Block must not be a cooldown launderette
--
-- Four findings from the security audit of the connections RPCs, all in
-- `20260917000002_connections_rpcs_write.sql`, all reachable by a member
-- with a valid session making direct PostgREST calls. Fixed together
-- because three of the four are the same two functions.
--
-- ─── 1 · HIGH — the 21-day cooldown could be erased in two calls ────
--
-- `block_member` set `cooldown_until = null` unconditionally, and
-- `unblock_member` then hard-DELETED the row. `send_connection_request`
-- only enforces a cooldown when a row survives to be read. So:
--
--   B declines A   → status 'declined', cooldown_until = now() + 21d
--   A blocks B     → same row, status 'blocked', cooldown_until NULL
--   A unblocks B   → row deleted; A is the blocker, so this is allowed
--   A re-requests  → no row, no cooldown, request goes through
--
-- B never participated in steps 2-4 and is never told. That is exactly
-- the loop the design set out to forbid: "letting someone remove,
-- instantly re-request, and repeat: a harassment loop bounded only by
-- the daily cap" (20260917000001_connections.sql:84-88).
--
-- The fix keeps the cooldown ACROSS the block and restores the row on
-- unblock instead of deleting it, whenever there is still a cooldown
-- left to enforce. A block with nothing behind it still deletes, so
-- blocking and unblocking a stranger leaves no trace, as before.
--
-- `unblock_restore_status` records what the row must go back to. It is
-- not simply the pre-block status: blocking an 'accepted' or 'pending'
-- row DESTROYS that relationship, and restoring it on unblock would
-- silently resurrect a connection or a request the blocker had killed.
-- Those two collapse to 'removed' — the settled, cooldown-bearing state
-- `remove_connection` already produces — and blocking a live
-- relationship now starts a cooldown of its own for the same reason
-- removal does.
--
-- ─── 2 · MEDIUM — the caps were a count-then-insert race ────────────
--
-- `connection_assert_can_send` counts, then the caller inserts, with
-- nothing serialising the two. N concurrent PostgREST calls from one
-- session all read the same count and all pass. A per-caller advisory
-- transaction lock costs one hash and is released at commit. It is
-- taken per CALLER, so it never serialises unrelated members, and two
-- people requesting each other take different keys — no deadlock.
--
-- The function becomes `volatile`: it now has a side effect, and
-- labelling a lock acquisition `stable` invites the planner to assume
-- something that is no longer true.
--
-- ─── 3 · MEDIUM — block had no database-side cap at all ─────────────
--
-- The comment in `frontend/src/lib/ratelimit.ts` justifying that was
-- wrong: block is not a response to an existing row, it takes an
-- arbitrary member id and CREATES a row from nothing, so it is a write
-- amplifier in the same shape as send. `block_daily_cap` gives it the
-- same authoritative floor send has. It is deliberately loose — 20/day
-- — because blocking is self-defence and a cap that bites a real victim
-- is worse than the write volume it saves.
--
-- ─── 4 · LOW — block distinguished a ghost from a real member ───────
--
-- The insert caught only `unique_violation`, so blocking a random uuid
-- raised a raw `23503` while blocking a real member returned quietly —
-- an oracle for "does this account exist", which
-- `adversarial_edges.sql` F3 requires to be unanswerable. A foreign-key
-- violation now returns silently, which is what blocking a member you
-- cannot see looks like from outside.
-- ════════════════════════════════════════════════════════════════════


-- ─── Schema ─────────────────────────────────────────────────────────

alter table public.connections
  add column if not exists unblock_restore_status text;

alter table public.connections
  drop constraint if exists connections_unblock_restore_status_check;

alter table public.connections
  add constraint connections_unblock_restore_status_check
  check (unblock_restore_status is null
         or unblock_restore_status in ('declined', 'withdrawn', 'removed'));

comment on column public.connections.unblock_restore_status is
  'Settled status this row returns to when a block is lifted while a cooldown is still running. Null means the block has nothing behind it and unblock deletes the row.';


-- ─── The new limit key ──────────────────────────────────────────────
-- `connection_limit()` raises on a key absent from the defaults, so the
-- default is the registration. The stored app_config row gets it too,
-- purely so an admin reading that row sees every knob that exists —
-- `connection_limits()` merges defaults under stored, so a missing key
-- was already safe.

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
    'digest_min_hours',          20
  );
$$;

revoke execute on function public.connection_limit_defaults() from public, anon, authenticated;

update public.app_config
   set value = (value::jsonb || jsonb_build_object('block_daily_cap', 20))::text
 where key = 'connection_limits'
   and value is not null
   and btrim(value) <> ''
   and (value::jsonb) ? 'daily_cap'          -- i.e. it parses and is the object we think
   and not ((value::jsonb) ? 'block_daily_cap');


-- ─── connection_assert_can_send — now serialised per caller ─────────

create or replace function public.connection_assert_can_send(p_caller uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_daily_cap  int;
  v_weekly_cap int;
  v_outstanding_cap int := public.connection_limit('outstanding_cap');
  v_count      int;
begin
  -- THE COUNTS BELOW ARE A READ FOLLOWED BY A WRITE IN THE CALLER, so
  -- without this every concurrent request from one session reads the
  -- same pre-insert count and every one of them passes. Held to commit,
  -- keyed on the caller alone: two members never contend, and A and B
  -- requesting each other simultaneously take different keys, so the
  -- mutual-accept path cannot deadlock against itself.
  perform pg_advisory_xact_lock(hashtextextended('connection_send:' || p_caller::text, 0));

  -- The throttle lowers the daily cap and nothing else. A throttled
  -- member can still answer everything already in their inbox, and can
  -- still send a few requests a day — this is a speed limit, not a
  -- suspension. That distinction is what keeps it defensible under
  -- Art. 22: temporary, reversible, human-overridable, and triggered
  -- only by other members' explicit acts.
  if public.connection_sender_throttled(p_caller) then
    v_daily_cap := least(
      public.connection_limit('daily_cap'),
      public.connection_limit('throttle_daily_cap')
    );
  else
    v_daily_cap := public.connection_limit('daily_cap');
  end if;

  select count(*) into v_count
    from public.connection_events
   where actor_id = p_caller
     and event = 'requested'
     and created_at > now() - interval '24 hours';

  if v_count >= v_daily_cap then
    raise exception 'You''ve reached your daily limit of % connection requests. Try again tomorrow.',
      v_daily_cap using errcode = '42501';
  end if;

  v_weekly_cap := public.connection_limit('weekly_cap');

  select count(*) into v_count
    from public.connection_events
   where actor_id = p_caller
     and event = 'requested'
     and created_at > now() - interval '7 days';

  if v_count >= v_weekly_cap then
    raise exception 'You''ve reached your weekly limit of % connection requests.',
      v_weekly_cap using errcode = '42501';
  end if;

  -- The outstanding cap is a STOCK, not a rate, and it is the one that
  -- actually stops harvesting. Rate caps alone let someone fire 25 a
  -- week into the void forever; requiring that people answer you before
  -- you send more means a member nobody responds to grinds to a halt on
  -- their own, without anyone having to report them.
  select count(*) into v_count
    from public.connections
   where requester_id = p_caller
     and status = 'pending';

  if v_count >= v_outstanding_cap then
    raise exception 'You have % connection requests still waiting for a reply. Wait for some to be answered before sending more.',
      v_count using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.connection_assert_can_send(uuid) from public, anon, authenticated;


-- ─── connection_assert_can_block ────────────────────────────────────
-- Same shape, same reason, its own lock key so a block never waits on a
-- send. Counted from `connection_events` rather than from rows for the
-- reason the send caps are: a row can be reused, an append-only log
-- cannot be reset.
--
-- The message is SPECIFIC, and that is correct here. Caps are facts
-- about the CALLER; only refusals that describe the TARGET have to be
-- byte-identical.

create or replace function public.connection_assert_can_block(p_caller uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cap   int := public.connection_limit('block_daily_cap');
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended('connection_block:' || p_caller::text, 0));

  select count(*) into v_count
    from public.connection_events
   where actor_id = p_caller
     and event = 'blocked'
     and created_at > now() - interval '24 hours';

  if v_count >= v_cap then
    raise exception 'You''ve blocked % members today, which is the daily limit. If someone is harassing you, please report them so the committee can act.',
      v_count using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.connection_assert_can_block(uuid) from public, anon, authenticated;


-- ─── block_member ───────────────────────────────────────────────────
-- Permanent, silent, and a DISTINCT UI CONTROL from decline. Buried
-- inside a decline flow, people decline when they mean to block and the
-- signal goes quiet — and this signal is the one the reputation throttle
-- is built on.
--
-- Blocking an existing connection removes it for both sides: there is
-- one row, and it leaves 'accepted'.
--
-- blocked_by records WHICH SIDE blocked, because the orientation of
-- requester/addressee cannot answer that — a block can be placed by
-- either party, and only the blocker may lift it.

create or replace function public.block_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller   uuid := auth.uid();
  v_id       uuid;
  v_retry    boolean;
  v_attempt  int;
  v_cooldown interval := make_interval(days => public.connection_limit('cooldown_days'));
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can block' using errcode = '42501';
  end if;
  if p_member is null or p_member = v_caller then
    raise exception 'You can''t block yourself.' using errcode = '22023';
  end if;

  perform public.connection_assert_can_block(v_caller);

  for v_attempt in 1..3 loop
    v_retry := false;
    v_id    := null;

    -- Unconditional on the existing status: blocking wins from every
    -- state, including 'blocked' by the OTHER party, in which case
    -- blocked_by moves to whoever blocked most recently. Both of them
    -- want the same thing.
    --
    -- The note is left intact. It is moderation evidence, and the person
    -- most likely to block is the person most likely to report next.
    --
    -- WHAT SURVIVES THE BLOCK. A block used to wipe `cooldown_until`,
    -- and unblock then deleted the row, so block+unblock laundered any
    -- running cooldown. The cooldown is now carried through untouched,
    -- and `unblock_restore_status` says what the row goes back to if the
    -- block is ever lifted while that cooldown is still live.
    --
    -- Blocking a 'pending' or 'accepted' row destroys a live
    -- relationship, which is a removal; it therefore STARTS a cooldown,
    -- exactly as remove_connection does, and restores to 'removed'
    -- rather than resurrecting the request or the connection.
    --
    -- 'expired' is the one state that keeps nothing: nobody decided
    -- anything, the pair was already re-sendable, and there is no
    -- cooldown to preserve.
    update public.connections c
       set status         = 'blocked',
           blocked_by     = v_caller,
           decided_at     = now(),
           unblock_restore_status = case c.status
             when 'pending'   then 'removed'
             when 'accepted'  then 'removed'
             when 'declined'  then 'declined'
             when 'withdrawn' then 'withdrawn'
             when 'removed'   then 'removed'
             when 'blocked'   then c.unblock_restore_status
             else null
           end,
           cooldown_until = case
             when c.status in ('pending', 'accepted') then now() + v_cooldown
             when c.status = 'expired'                then null
             else c.cooldown_until
           end
     where least(c.requester_id, c.addressee_id)    = least(v_caller, p_member)
       and greatest(c.requester_id, c.addressee_id) = greatest(v_caller, p_member)
    returning c.id into v_id;

    if v_id is null then
      begin
        insert into public.connections
          (requester_id, addressee_id, status, blocked_by, decided_at)
        values (v_caller, p_member, 'blocked', v_caller, now())
        returning id into v_id;
      exception
        when unique_violation then
          v_retry := true;
        when foreign_key_violation then
          -- No such profile. Returning quietly is the only answer that
          -- does not turn this into an account-existence oracle: a real
          -- member blocks silently, so a ghost must too.
          return;
      end;

      if v_retry then
        continue;
      end if;
    end if;

    perform public.connection_log_event(v_id, v_caller, p_member, 'blocked');
    return;
  end loop;

  raise exception '%', public.connection_refusal_message() using errcode = '40001';
end;
$$;

revoke execute on function public.block_member(uuid) from public, anon;
grant  execute on function public.block_member(uuid) to authenticated;


-- ─── unblock_member ─────────────────────────────────────────────────
-- Returns the pair to no-relationship — UNLESS the block is sitting on
-- top of a cooldown that has not run out, in which case the row settles
-- back into that cooldown instead of vanishing. Deleting it would hand
-- the blocker a two-call reset of a wait the other party imposed.
--
-- A SILENT NO-OP when the caller is not the blocker. Raising "you didn't
-- block them" would turn this into a probe — call unblock on everyone,
-- and the error message tells you exactly who has blocked you. The
-- blocked party gets the same silence as someone unblocking a stranger.

create or replace function public.unblock_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_id     uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can unblock' using errcode = '42501';
  end if;
  if p_member is null or p_member = v_caller then
    return;
  end if;

  -- Nothing left to enforce: the block was the whole row.
  delete from public.connections c
   where least(c.requester_id, c.addressee_id)    = least(v_caller, p_member)
     and greatest(c.requester_id, c.addressee_id) = greatest(v_caller, p_member)
     and c.status = 'blocked'
     and c.blocked_by = v_caller
     and (c.cooldown_until is null or c.cooldown_until <= now())
  returning c.id into v_id;

  if v_id is null then
    -- A cooldown is still running underneath. Settle back into it. The
    -- purge cron deletes the row once it lapses, so this is a deferred
    -- version of the delete above, not a permanent record.
    update public.connections c
       set status                 = coalesce(c.unblock_restore_status, 'removed'),
           blocked_by             = null,
           unblock_restore_status = null
     where least(c.requester_id, c.addressee_id)    = least(v_caller, p_member)
       and greatest(c.requester_id, c.addressee_id) = greatest(v_caller, p_member)
       and c.status = 'blocked'
       and c.blocked_by = v_caller
       and c.cooldown_until is not null
       and c.cooldown_until > now()
    returning c.id into v_id;
  end if;

  -- Not the blocker, or no block to lift. Same silence either way.
  if v_id is null then
    return;
  end if;

  perform public.connection_log_event(v_id, v_caller, p_member, 'unblocked');
end;
$$;

revoke execute on function public.unblock_member(uuid) from public, anon;
grant  execute on function public.unblock_member(uuid) to authenticated;
