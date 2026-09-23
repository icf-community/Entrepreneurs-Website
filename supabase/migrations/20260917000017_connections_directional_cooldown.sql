-- ════════════════════════════════════════════════════════════════════
-- Foundry · Connections: the cooldown binds the SENDER, not the pair;
-- limits are readable before a member hits them
--
-- Owner decisions, 2026-09-23 (LinkedIn parity):
--
--   * WITHDRAW → the withdrawer may not re-request that member for three
--     weeks; the other member may send them a request at any time.
--   * DECLINE  → the declined sender is held for three weeks; the
--     decliner may change their mind and send one.
--   * REMOVE   → nobody is held.
--
-- Before this, every settled row held BOTH members for 21 days: a
-- member who withdrew locked the other person out of contacting them.
--
-- WHY NO NEW COLUMN. In a declined or withdrawn row the member to hold is
-- always requester_id — the withdrawer, or the sender who was declined —
-- and block_member never rewrites the orientation. So the direction is
-- already in the row; the rule is just read the right way round:
--
--   refuse the caller only when status in ('declined','withdrawn')
--   and requester_id = caller and cooldown_until > now()
--
-- respond / withdraw / remove are unchanged: they still write
-- cooldown_until, which is what the lock and the purge read.
--
-- THE HOLE THIS WOULD HAVE OPENED, closed below in block_member: a blocked
-- PENDING row used to come back as 'removed' on unblock. With 'removed'
-- now holding nobody, a sender could withdraw by block-then-unblock and
-- skip their own three weeks. It now comes back as 'withdrawn' (sender
-- blocked) or 'declined' (recipient blocked) — the sender is held either
-- way.
--
-- RETENTION FOLLOWS. A removed row no longer enforces anything, so the
-- nightly purge deletes it on its next run instead of after 21 days
-- (privacy notice §6 and the ROPA updated to match).
--
-- my_connection_quota() lets the Connect button grey out BEFORE a send
-- fails. Its counts are copied verbatim from connection_assert_can_send
-- (20260917000012), which stays the enforcement; rls_smoke asserts the
-- two agree at every cap boundary.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. send_connection_request (latest: 20260917000002) ────────────
create or replace function public.send_connection_request(
  p_addressee       uuid,
  p_consent_version text,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller    uuid := auth.uid();
  v_note      text;
  v_row       public.connections%rowtype;
  v_id        uuid;
  v_status    text;
  v_version   smallint;
  v_open      boolean;
  v_retry     boolean;
  v_attempt   int;
  -- FOUND is clobbered by every subsequent SELECT INTO in this body, and
  -- there are two of them between reading the connection row and the
  -- point where "did a row exist?" is asked again. Latch it.
  v_has_row   boolean;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can send connection requests' using errcode = '42501';
  end if;

  -- The kill switch gates NEW REQUESTS ONLY. Accept, decline, withdraw,
  -- block, report and remove all keep working while it is off, and the
  -- digest keeps running — a kill switch should stop the inflow, not
  -- trap the people already mid-handshake with an inbox they cannot
  -- clear.
  if not public.connections_enabled() then
    raise exception 'Connection requests are temporarily unavailable.' using errcode = '42501';
  end if;

  if p_consent_version is distinct from public.connection_consent_version() then
    raise exception 'This page is out of date — please refresh and try again.' using errcode = '22023';
  end if;

  if p_addressee is null or p_addressee = v_caller then
    raise exception 'You can''t send a connection request to yourself.' using errcode = '22023';
  end if;

  v_note := public.connection_clean_note(p_note);

  -- Facts about the CALLER, so a specific message is correct here and
  -- leaks nothing. An empty profile card gives the recipient nothing to
  -- decide on, which is why completed intake is required to send but not
  -- to receive.
  select p.status, p.profile_version into v_status, v_version
    from public.profiles p where p.id = v_caller;

  if v_status is distinct from 'approved' then
    raise exception 'Your membership must be approved before you can send connection requests.'
      using errcode = '42501';
  end if;
  if coalesce(v_version, 1) < 2 then
    raise exception 'Finish setting up your profile before sending connection requests.'
      using errcode = '42501';
  end if;

  -- Bounded, because the only thing being retried is losing a race on
  -- the pair unique index. Two contenders resolve on the second pass;
  -- three attempts is slack, not a spin.
  for v_attempt in 1..3 loop
    v_retry := false;

    -- Matches connections_pair_uniq's expression exactly, so this is an
    -- index scan on the unordered pair rather than a two-branch OR.
    select * into v_row
      from public.connections
     where least(requester_id, addressee_id)    = least(v_caller, p_addressee)
       and greatest(requester_id, addressee_id) = greatest(v_caller, p_addressee);

    v_has_row := found;

    -- ── (a) Outcomes the caller already knows about ────────────────
    if v_has_row then
      if v_row.status = 'accepted' then
        raise exception 'You''re already connected with this member.' using errcode = '22023';
      end if;

      if v_row.status = 'pending' and v_row.requester_id = v_caller then
        -- Double-click, or a retry after a dropped response. The request
        -- exists, which is what was wanted.
        return v_row.id;
      end if;

      if v_row.status = 'pending' and v_row.addressee_id = v_caller then
        -- MUTUAL ACCEPT. Both addresses are about to be released, so the
        -- other party's approval is re-checked here and not taken from
        -- whenever they sent. Generic refusal if they are no longer
        -- approved: a member banned between request and accept must not
        -- have their address released.
        select p.status into v_status from public.profiles p where p.id = v_row.requester_id;
        if v_status is distinct from 'approved' then
          raise exception '%', public.connection_refusal_message() using errcode = '42501';
        end if;

        update public.connections c
           set status          = 'accepted',
               decided_at      = now(),
               consent_version = p_consent_version,
               cooldown_until  = null
         where c.id = v_row.id
           and c.status = 'pending'
        returning c.id into v_id;

        if v_id is null then
          -- Lost to a withdraw or a block that committed first. Re-read
          -- on the next pass rather than guessing what happened.
          continue;
        end if;

        perform public.connection_log_event(v_id, v_caller, v_row.requester_id, 'accepted');
        return v_id;
      end if;
    end if;

    -- ── (b) A genuinely new or revived request: caps first ─────────
    perform public.connection_assert_can_send(v_caller);

    -- ── (c) Everything about the target, all one message ───────────
    select p.status, p.open_to_connections into v_status, v_open
      from public.profiles p where p.id = p_addressee;

    if v_status is distinct from 'approved' or coalesce(v_open, false) = false then
      raise exception '%', public.connection_refusal_message() using errcode = '42501';
    end if;

    -- DIRECTIONAL (20260917000017). A cooldown binds only the member who
    -- SENT the settled request: whoever withdrew it, or whose request was
    -- declined — which is requester_id in both cases. The other member
    -- may send at any time, and a removed connection binds nobody. Same
    -- generic refusal as before, so a decline is still never revealed.
    if v_has_row and (
         v_row.status = 'blocked'
      or (v_row.status in ('declined', 'withdrawn')
          and v_row.requester_id = v_caller
          and v_row.cooldown_until is not null
          and v_row.cooldown_until > now())
    ) then
      raise exception '%', public.connection_refusal_message() using errcode = '42501';
    end if;

    -- ── The write ──────────────────────────────────────────────────
    if v_has_row then
      -- REUSE, and rewrite BOTH id columns. The row is keyed on the
      -- unordered pair, so when A's declined request is later re-sent by
      -- B the same row is reused with the orientation SWAPPED. Assuming
      -- the existing orientation here is the single most likely source
      -- of a wrong-way-round bug in this feature.
      update public.connections c
         set requester_id    = v_caller,
             addressee_id    = p_addressee,
             status          = 'pending',
             note            = v_note,
             consent_version = p_consent_version,
             blocked_by      = null,
             created_at      = now(),
             decided_at      = null,
             digested_at     = null,
             -- The S1 digest lease belongs to the request this row used
             -- to hold, not to the new one.
             digest_claim_id   = null,
             digest_claimed_at = null,
             cooldown_until  = null
       where c.id = v_row.id
         and c.status in ('declined', 'withdrawn', 'expired', 'removed')
         and not (c.status in ('declined', 'withdrawn')
                  and c.requester_id = v_caller
                  and c.cooldown_until is not null
                  and c.cooldown_until > now())
      returning c.id into v_id;

      if v_id is null then
        continue;
      end if;
    else
      begin
        insert into public.connections (requester_id, addressee_id, status, note, consent_version)
        values (v_caller, p_addressee, 'pending', v_note, p_consent_version)
        returning id into v_id;
      exception when unique_violation then
        -- The other member inserted the pair row between our select and
        -- our insert. Almost always the mutual-request case, which the
        -- next pass resolves as an accept.
        v_retry := true;
      end;

      if v_retry then
        continue;
      end if;
    end if;

    perform public.connection_log_event(v_id, v_caller, p_addressee, 'requested');
    return v_id;
  end loop;

  -- Three passes without resolving means the row is being rewritten
  -- faster than we can read it, which in practice means something is
  -- wrong rather than contended.
  raise exception '%', public.connection_refusal_message() using errcode = '40001';
end;
$$;

revoke execute on function public.send_connection_request(uuid, text, text) from public, anon;
grant  execute on function public.send_connection_request(uuid, text, text) to authenticated;


-- ─── 2. connection_state_with (latest: 20260917000003) ──────────────
-- Dropped, not replaced: the return type gains `available_at`, which
-- create-or-replace cannot do. New state `withdrawn_by_me`.
drop function if exists public.connection_state_with(uuid);

create function public.connection_state_with(p_member uuid)
returns table (state text, connection_id uuid, available_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
  v_status text;
  v_open   boolean;
begin
  if v_caller is null or not (public.is_approved() or public.is_admin()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if p_member is null then
    return query select 'unavailable'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if p_member = v_caller then
    return query select 'self'::text, null::uuid, null::timestamptz;
    return;
  end if;

  select * into v_row
    from public.connections
   where least(requester_id, addressee_id)    = least(v_caller, p_member)
     and greatest(requester_id, addressee_id) = greatest(v_caller, p_member);

  if found then
    if v_row.status = 'accepted' then
      -- A connection to a banned member is not shown as a connection,
      -- for the same reason their address stops being returned.
      select p.status into v_status from public.profiles p where p.id = p_member;
      if v_status is distinct from 'approved' then
        return query select 'unavailable'::text, null::uuid, null::timestamptz;
      else
        return query select 'connected'::text, v_row.id, null::timestamptz;
      end if;
      return;
    end if;

    if v_row.status = 'pending' then
      if v_row.requester_id = v_caller then
        return query select 'pending_outgoing'::text, v_row.id, null::timestamptz;
      else
        return query select 'pending_incoming'::text, v_row.id, null::timestamptz;
      end if;
      return;
    end if;

    if v_row.status = 'blocked' then
      if v_row.blocked_by = v_caller then
        return query select 'blocked_by_me'::text, v_row.id, null::timestamptz;
      else
        return query select 'unavailable'::text, null::uuid, null::timestamptz;
      end if;
      return;
    end if;

    -- DIRECTIONAL (20260917000017): only the member who sent a settled
    -- request is held back. The withdrawer is told when they may send
    -- again — they withdrew, so that reveals nothing. A declined sender
    -- gets the same generic `unavailable` as a block or a pause. The
    -- decliner, and both sides of a removed connection, fall through.
    if v_row.status in ('declined', 'withdrawn')
       and v_row.requester_id = v_caller
       and v_row.cooldown_until is not null
       and v_row.cooldown_until > now() then
      if v_row.status = 'withdrawn' then
        return query select 'withdrawn_by_me'::text, null::uuid, v_row.cooldown_until;
      else
        return query select 'unavailable'::text, null::uuid, null::timestamptz;
      end if;
      return;
    end if;
  end if;

  select p.status, p.open_to_connections into v_status, v_open
    from public.profiles p where p.id = p_member;

  if v_status is distinct from 'approved' or coalesce(v_open, false) = false then
    return query select 'unavailable'::text, null::uuid, null::timestamptz;
    return;
  end if;

  return query select 'none'::text, null::uuid, null::timestamptz;
end;
$$;

revoke execute on function public.connection_state_with(uuid) from public, anon;
grant  execute on function public.connection_state_with(uuid) to authenticated;


-- ─── 3. block_member (latest: 20260917000012) ───────────────────────
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
           -- A blocked PENDING request comes back as the settlement that
           -- keeps its SENDER locked (20260917000017): withdrawn if the
           -- sender blocked, declined if the recipient did. Restoring it
           -- as 'removed' — which now locks nobody — would let a sender
           -- dodge their withdraw cooldown with block-then-unblock.
           unblock_restore_status = case c.status
             when 'pending'   then case when c.requester_id = v_caller then 'withdrawn' else 'declined' end
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


-- ─── 4. purge_removed_connections (latest: 20260917000014) ──────────
-- Still matches connections_settled_purge_idx's predicate verbatim.
create or replace function public.purge_removed_connections()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_batch integer;
begin
  -- Batches of 500 until nothing is left, not one batch a night. The
  -- privacy notice promises a removed connection is gone within a day,
  -- and removed rows sort LAST here (their cooldown_until is three weeks
  -- out), so a single 500-row batch let a busy night's older declined,
  -- withdrawn and expired rows push removals back by days. Each batch is
  -- the same bounded, index-driven statement as before; the loop stops
  -- after 100 batches (50,000 rows; a 27,280-row backlog took 0.6s at
  -- 5k members / 248k connections) so one run can never hold the table
  -- indefinitely — the next night resumes.
  for i in 1..100 loop
    with doomed as (
      select id from public.connections
       -- Matches connections_settled_purge_idx's predicate verbatim, so
       -- the planner can prove the partial index is applicable. Do not
       -- fold this back into the OR below.
       where status in ('removed', 'declined', 'withdrawn', 'expired')
         and (
               -- Nothing left to enforce. Expiry never set a cooldown, and a
               -- removed connection no longer holds anyone back
               -- (20260917000017) — keeping it three weeks would be
               -- retention with no purpose.
               status in ('expired', 'removed')
               -- Declined / withdrawn: the row IS the sender's lock, so it
               -- stays until that lock has run out. Deleting one EARLIER would destroy
               -- the cooldown itself, since the cooldown is enforced by
               -- reading this row.
               or (cooldown_until is not null and cooldown_until <= now())
             )
       order by coalesce(cooldown_until, decided_at)
       limit 500
    ),
    gone as (
      delete from public.connections c using doomed d where c.id = d.id returning 1
    )
    select count(*) into v_batch from gone;

    v_count := v_count + v_batch;
    exit when v_batch < 500;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.purge_removed_connections() from public, anon, authenticated;


-- ─── 5. my_connection_quota ─────────────────────────────────────────
-- The caller's own usage against their own caps — facts about the
-- caller only, so nothing here can probe anyone else.
--
-- limit_reason precedence is weekly, daily, outstanding: the weekly
-- message is the one that explains the longest wait. available_at is when
-- a slot frees: with the window's events oldest-first and
-- n = used - cap + 1, it is the n-th event's time plus the window. When
-- both time limits bind it is the later of the two; an outstanding limit
-- has no date — it frees when somebody answers or the member withdraws.
create or replace function public.my_connection_quota()
returns table (
  daily_used      int,
  daily_cap       int,
  weekly_used     int,
  weekly_cap      int,
  outstanding     int,
  outstanding_cap int,
  limit_reason    text,
  available_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_daily_at  timestamptz;
  v_weekly_at timestamptz;
begin
  if v_caller is null or not (public.is_approved() or public.is_admin()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- Caps: the same expressions connection_assert_can_send uses.
  if public.connection_sender_throttled(v_caller) then
    daily_cap := least(
      public.connection_limit('daily_cap'),
      public.connection_limit('throttle_daily_cap')
    );
  else
    daily_cap := public.connection_limit('daily_cap');
  end if;
  weekly_cap      := public.connection_limit('weekly_cap');
  outstanding_cap := public.connection_limit('outstanding_cap');

  -- Counts: verbatim from connection_assert_can_send.
  select count(*) into daily_used
    from public.connection_events
   where actor_id = v_caller
     and event = 'requested'
     and created_at > now() - interval '24 hours';

  select count(*) into weekly_used
    from public.connection_events
   where actor_id = v_caller
     and event = 'requested'
     and created_at > now() - interval '7 days';

  select count(*) into outstanding
    from public.connections
   where requester_id = v_caller
     and status = 'pending';

  if daily_used >= daily_cap then
    select e.created_at + interval '24 hours' into v_daily_at
      from public.connection_events e
     where e.actor_id = v_caller
       and e.event = 'requested'
       and e.created_at > now() - interval '24 hours'
     order by e.created_at
    offset daily_used - daily_cap
     limit 1;
  end if;

  if weekly_used >= weekly_cap then
    select e.created_at + interval '7 days' into v_weekly_at
      from public.connection_events e
     where e.actor_id = v_caller
       and e.event = 'requested'
       and e.created_at > now() - interval '7 days'
     order by e.created_at
    offset weekly_used - weekly_cap
     limit 1;
  end if;

  if weekly_used >= weekly_cap then
    limit_reason := 'weekly';
  elsif daily_used >= daily_cap then
    limit_reason := 'daily';
  elsif outstanding >= outstanding_cap then
    limit_reason := 'outstanding';
  end if;

  if limit_reason in ('weekly', 'daily') then
    available_at := greatest(v_daily_at, v_weekly_at);
  end if;

  return next;
end;
$$;

revoke execute on function public.my_connection_quota() from public, anon;
grant  execute on function public.my_connection_quota() to authenticated;
