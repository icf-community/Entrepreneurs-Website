-- ════════════════════════════════════════════════════════════════════
-- Foundry · Connections — write-path RPCs
--
-- Every state change in this feature lives here. The three tables have
-- RLS enabled with no policies, so these SECURITY DEFINER functions are
-- the only way anything is ever written.
--
-- Every guard is `is_approved() or is_admin()`, never `auth.uid() is not
-- null`. A ban here is `status = 'rejected'` and GoTrue's banned_until
-- takes up to an hour to invalidate an already-issued JWT, so a
-- just-banned member still presents a perfectly valid auth.uid(). That
-- was the bug 20260827000003 was written to fix.
--
-- ─── THE TWO RULES THIS FILE IS ORGANISED AROUND ────────────────────
--
-- 1. EVERY STATE CHANGE IS A SINGLE `UPDATE ... WHERE <expected state>
--    RETURNING`, never SELECT-then-UPDATE. Postgres row locks serialise
--    the contenders; the loser matches zero rows and is told the real
--    outcome. No advisory locks, no application-level retries except the
--    one bounded loop in send_connection_request, which exists for the
--    unique index rather than for a lock.
--
-- 2. REFUSALS THAT COULD LEAK STATE ARE BYTE-IDENTICAL. Blocked,
--    on-cooldown, paused (open_to_connections = false), not approved and
--    does-not-exist all raise connection_refusal_message() — one
--    function, one string, so they cannot drift apart in a later edit.
--    Distinct wording would let anyone probe whether they have been
--    blocked, or enumerate who is on the platform.
--
--    Cap and throttle refusals ARE specific, because they are facts
--    about the caller rather than about the other member. The ordering
--    inside send_connection_request is built so that this specificity
--    cannot itself become a probe — see the long comment there.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. connection_refusal_message ──────────────────────────────────
-- ONE definition of the generic refusal, deliberately not a literal
-- repeated at six call sites. rls_smoke asserts these messages are
-- byte-identical to each other; a single function is what makes that
-- assertion true by construction instead of by vigilance.
--
-- Internal: revoked from every client role. It is reached only through
-- the definer functions below, which run as the owner.
create or replace function public.connection_refusal_message()
returns text
language sql
immutable
as $$
  select 'You can''t send a request to this member right now.';
$$;

revoke execute on function public.connection_refusal_message() from public, anon, authenticated;


-- ─── 2. connection_log_event ────────────────────────────────────────
-- The append-only history write. See 20260917000001 §2 for the
-- actor/subject convention — actor DID it, subject had it DONE TO them —
-- and for why 'report_upheld' stores the original reporter as actor.
--
-- Internal. connection_events has no client-facing read path at all, so
-- it has no client-facing write path either.
create or replace function public.connection_log_event(
  p_connection_id uuid,
  p_actor         uuid,
  p_subject       uuid,
  p_event         text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.connection_events (connection_id, actor_id, subject_id, event)
  values (p_connection_id, p_actor, p_subject, p_event);
$$;

revoke execute on function public.connection_log_event(uuid, uuid, uuid, text)
  from public, anon, authenticated;


-- ─── 3. connection_sender_throttled ─────────────────────────────────
-- THE THROTTLE IS COMPUTED, NEVER STORED. There is no is_throttled
-- column, no un-throttle cron and no state to go stale: the window
-- simply stops matching and the throttle lifts itself.
--
-- It counts DISTINCT ACTORS who raised a signal against this member, so
-- one determined person cannot throttle someone by blocking and
-- reporting them repeatedly — that is one actor however many rows it
-- writes.
--
-- Keyed on blocks and upheld reports ONLY, never on decline rate. This
-- community has a status gradient (students → alumni → angels) and a
-- junior member's requests going unanswered is not misbehaviour;
-- throttling on it would penalise exactly who the platform exists to
-- help. Decline rate raises a flag for a human in the admin queue and
-- drives nothing automatically. LinkedIn draws the same line: its
-- restriction signal is the explicit "I don't know this person"
-- assertion, not a plain ignore.
--
-- An admin override is a single 'throttle_cleared' event row rather than
-- a mutable flag — only signals NEWER than the latest clear are counted,
-- so clearing is itself append-only and auditable.
create or replace function public.connection_sender_throttled(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with cleared as (
    select coalesce(max(created_at), '-infinity'::timestamptz) as at
      from public.connection_events
     where subject_id = p_member
       and event = 'throttle_cleared'
  ),
  signals as (
    select e.actor_id, e.created_at
      from public.connection_events e, cleared c
     where e.subject_id = p_member
       and e.event in ('blocked', 'report_upheld')
       -- Cron events have no actor and can never be a reputation signal.
       and e.actor_id is not null
       and e.created_at > c.at
       and e.created_at > now() - make_interval(days => public.connection_limit('throttle_lookback_days'))
  )
  -- Two conditions, and the second is what makes this decay: enough
  -- distinct people complained within the lookback window, AND the most
  -- recent of those complaints is still inside the throttle duration.
  -- An empty `signals` gives count 0, so the first test is false and the
  -- null max is never reached.
  select count(distinct actor_id) >= public.connection_limit('throttle_distinct_signals')
     and max(created_at) > now() - make_interval(days => public.connection_limit('throttle_duration_days'))
    from signals;
$$;

revoke execute on function public.connection_sender_throttled(uuid) from public, anon, authenticated;


-- ─── 4. connection_assert_can_send ──────────────────────────────────
-- The hard floor, checked in the SAME TRANSACTION as the write so a
-- direct PostgREST call cannot bypass it. The Upstash bucket in
-- ratelimit.ts is a coarse outer guard set deliberately ABOVE these
-- numbers; these are the authoritative ones. rls_smoke asserts the caps
-- hold with the Upstash layer entirely absent — the §31k report_post
-- precedent.
--
-- COUNTED FROM 'requested' EVENTS, NOT FROM connections.created_at. A
-- re-request after a lapsed cooldown REUSES and resets the connection
-- row, so counting rows silently under-counts how many requests a member
-- has actually fired: send, get declined, wait three weeks, send again,
-- forever, at zero apparent cost. An append-only log cannot be reset by
-- row reuse.
--
-- Internal, and it raises rather than returning a boolean so no caller
-- can forget to check the result.
create or replace function public.connection_assert_can_send(p_caller uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daily_cap  int;
  v_weekly_cap int;
  v_outstanding_cap int := public.connection_limit('outstanding_cap');
  v_count      int;
begin
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


-- ─── 5. connection_clean_note ───────────────────────────────────────
-- Control characters out, whitespace collapsed, trimmed, empty → null.
--
-- length() is character-based in Postgres, so the bound is unicode-safe
-- and a 300-emoji note is 300 characters rather than 1,200 bytes. The
-- CHECK constraint on the column pins the same bound from below; this
-- function exists so the member gets a sentence rather than a constraint
-- violation.
create or replace function public.connection_clean_note(p_note text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_note text;
  v_max  int := public.connection_limit('note_max_chars');
begin
  if p_note is null then
    return null;
  end if;

  v_note := regexp_replace(p_note, '[[:cntrl:]]', ' ', 'g');
  v_note := regexp_replace(v_note, '\s+', ' ', 'g');
  v_note := nullif(btrim(v_note), '');

  if v_note is not null and length(v_note) > v_max then
    raise exception 'Your note must be % characters or fewer.', v_max using errcode = '22001';
  end if;

  return v_note;
end;
$$;

revoke execute on function public.connection_clean_note(text) from public, anon, authenticated;


-- ─── 6. send_connection_request ─────────────────────────────────────
-- Returns the connection id. Idempotent: sending twice returns the same
-- id rather than erroring, because the request existing is what the
-- member wanted either way.
--
-- p_consent_version IS REQUIRED, and it is required even though the
-- ordinary send does not disclose anything. Two reasons:
--
--   1. MUTUAL SIMULTANEOUS REQUEST IS AN ACCEPT, NOT A CONFLICT. If the
--      other member already has a pending request to the caller, that is
--      two people agreeing — this function accepts it rather than
--      inserting. That branch discloses both addresses, so it needs the
--      caller's consent evidence in hand. The UI cannot pre-empt this by
--      showing an Accept button instead: the other member's request can
--      land while the caller has the Connect dialog open.
--   2. A client running superseded consent copy must be refused and
--      asked to refresh. Silently stamping the current version against
--      wording the member never saw would make the Art. 7(1) evidence a
--      lie, which is worse than an error message.
--
-- The version is also stamped on the PENDING row, not only on accepted
-- rows. The accepter's version overwrites it at accept, because that is
-- the act that releases the addresses and therefore the consent that
-- governs — but until then the row carries evidence of what the
-- requester saw, which beats a null.
--
-- ─── GATE ORDER, AND WHY IT IS THIS ORDER ───────────────────────────
-- The obvious order — validate the target, then check the caller's caps
-- — leaks. At cap, a valid target would give "you've reached your daily
-- limit" while a blocked or non-existent one gave the generic refusal,
-- and that difference is an enumeration oracle: it answers "is this
-- person real / have they blocked me" for anyone willing to burn their
-- daily quota.
--
-- So the order below is:
--
--   a. Resolve the existing row FIRST, and return early for the three
--      outcomes the caller already knows about (already connected /
--      already sent / mutual accept). These charge no cap — in
--      particular the mutual accept does not, because answering someone
--      is not sending.
--   b. Only then, for a genuinely new or revived request, check caps and
--      the throttle.
--   c. Only after the caps pass, check everything about the target.
--
-- The result: at cap, every target — valid, paused, blocked,
-- on-cooldown, banned, non-existent — returns the identical cap message.
-- Below cap, all five non-valid cases return the identical generic
-- message. There is no pair of inputs that can be distinguished by their
-- response.
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

    if v_has_row and (
         v_row.status = 'blocked'
      or (v_row.cooldown_until is not null and v_row.cooldown_until > now())
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
             cooldown_until  = null
       where c.id = v_row.id
         and c.status in ('declined', 'withdrawn', 'expired', 'removed')
         and (c.cooldown_until is null or c.cooldown_until <= now())
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


-- ─── 7. respond_to_connection_request ───────────────────────────────
-- Addressee only. Returns one row always, so the server action can
-- branch on `accepted` rather than on an empty result set.
--
-- ON ACCEPT it returns the requester's identity and address, because
-- MAIL IS NEVER SENT FROM SQL: enqueue_outbound_email is revoked from
-- every client role (it was an open phishing relay — 20260531000004), so
-- the RPC returns what is needed and the TypeScript action builds the
-- template and enqueues with the service role.
--
-- ON DECLINE it returns nothing but `accepted = false`. Decline is
-- SILENT — it notifies nobody and the request vanishes from the sender's
-- view entirely. Telling someone they were declined is how a decline
-- becomes a conversation.
--
-- The email is read LIVE from auth.users and never snapshotted. A member
-- who changes their login address (email_change_log exists) must not
-- leave a stale address in someone else's connection list, and a copied
-- address would be a retention problem of its own.
create or replace function public.respond_to_connection_request(
  p_id              uuid,
  p_accept          boolean,
  p_consent_version text default null
)
returns table (
  accepted             boolean,
  requester_id         uuid,
  requester_email      text,
  requester_first_name text,
  accepter_first_name  text,
  accepter_surname     text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
  v_status text;
  v_id     uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can respond to connection requests' using errcode = '42501';
  end if;

  -- Deliberately NOT gated on connections_enabled(). See §6.
  select * into v_row
    from public.connections
   where id = p_id and addressee_id = v_caller and status = 'pending';

  if not found then
    -- One message for "not yours", "not pending" and "does not exist".
    raise exception 'That request is no longer pending.' using errcode = '22023';
  end if;

  if p_accept then
    if p_consent_version is distinct from public.connection_consent_version() then
      raise exception 'This page is out of date — please refresh and try again.' using errcode = '22023';
    end if;

    -- Re-checked at ACCEPT, not taken from when the request was sent.
    -- This is the moment the addresses are released, and a member banned
    -- in between must not have theirs released.
    select p.status into v_status from public.profiles p where p.id = v_row.requester_id;
    if v_status is distinct from 'approved' then
      raise exception 'That request is no longer pending.' using errcode = '22023';
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
      -- Lost to a withdraw or a block. The loser of the race is told the
      -- real outcome rather than shown a success it did not achieve.
      raise exception 'That request is no longer pending.' using errcode = '22023';
    end if;

    perform public.connection_log_event(v_id, v_caller, v_row.requester_id, 'accepted');

    return query
      select true,
             v_row.requester_id,
             u.email::text,
             rp.first_name,
             ap.first_name,
             ap.surname
        from public.profiles rp
        join auth.users     u  on u.id  = rp.id
        join public.profiles ap on ap.id = v_caller
       where rp.id = v_row.requester_id;
    return;
  end if;

  update public.connections c
     set status         = 'declined',
         decided_at     = now(),
         cooldown_until = now() + make_interval(days => public.connection_limit('cooldown_days'))
   where c.id = v_row.id
     and c.status = 'pending'
  returning c.id into v_id;

  if v_id is null then
    raise exception 'That request is no longer pending.' using errcode = '22023';
  end if;

  -- The note is NOT cleared on decline. Someone declines an unpleasant
  -- message and only then thinks "actually, I should report that";
  -- clearing it here would hand them an empty report form at exactly the
  -- moment the text matters.
  perform public.connection_log_event(v_id, v_caller, v_row.requester_id, 'declined');

  return query select false, null::uuid, null::text, null::text, null::text, null::text;
end;
$$;

revoke execute on function public.respond_to_connection_request(uuid, boolean, text) from public, anon;
grant  execute on function public.respond_to_connection_request(uuid, boolean, text) to authenticated;


-- ─── 8. withdraw_connection_request ─────────────────────────────────
-- Requester only. Carries the same 21-day cooldown as a decline, and for
-- the same reason: without it, send-withdraw-send is an unbounded
-- notification loop that costs the sender nothing.
create or replace function public.withdraw_connection_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can withdraw connection requests' using errcode = '42501';
  end if;

  update public.connections c
     set status         = 'withdrawn',
         decided_at     = now(),
         cooldown_until = now() + make_interval(days => public.connection_limit('cooldown_days'))
   where c.id = p_id
     and c.requester_id = v_caller
     and c.status = 'pending'
  returning c.* into v_row;

  if not found then
    raise exception 'That request is no longer pending.' using errcode = '22023';
  end if;

  perform public.connection_log_event(v_row.id, v_caller, v_row.addressee_id, 'withdrawn');
end;
$$;

revoke execute on function public.withdraw_connection_request(uuid) from public, anon;
grant  execute on function public.withdraw_connection_request(uuid) to authenticated;


-- ─── 9. remove_connection ───────────────────────────────────────────
-- Either party. Mutual by construction — there is one row, so removing
-- it removes it for both sides at once, and "A thinks they're connected,
-- B doesn't" is unrepresentable.
--
-- REMOVAL IS A COOLDOWN STATE, NOT AN IMMEDIATE DELETE. Removal is not a
-- decline, so it would otherwise carry no cooldown at all — letting
-- someone remove, instantly re-request, and repeat: a harassment loop
-- bounded only by the daily cap. The row therefore carries the standard
-- 21-day cooldown and the lifecycle cron hard-deletes it once that
-- lapses. Hard deletion is preserved, just deferred three weeks.
--
-- Both sides removing at once is not an error: the loser matches zero
-- rows, finds the row already 'removed', and is told it succeeded,
-- because it did.
create or replace function public.remove_connection(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
  v_other  uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can remove connections' using errcode = '42501';
  end if;

  update public.connections c
     set status         = 'removed',
         decided_at     = now(),
         cooldown_until = now() + make_interval(days => public.connection_limit('cooldown_days'))
   where c.id = p_id
     and c.status = 'accepted'
     and (c.requester_id = v_caller or c.addressee_id = v_caller)
  returning c.* into v_row;

  if not found then
    -- Already removed — by the other party, or by this caller's own
    -- double-click. Either way the connection is gone, which is the
    -- outcome that was asked for.
    if exists (
      select 1 from public.connections
       where id = p_id
         and status = 'removed'
         and (requester_id = v_caller or addressee_id = v_caller)
    ) then
      return;
    end if;
    raise exception 'That connection no longer exists.' using errcode = '22023';
  end if;

  v_other := case when v_row.requester_id = v_caller then v_row.addressee_id else v_row.requester_id end;
  perform public.connection_log_event(v_row.id, v_caller, v_other, 'removed');
end;
$$;

revoke execute on function public.remove_connection(uuid) from public, anon;
grant  execute on function public.remove_connection(uuid) to authenticated;


-- ─── 10. block_member ───────────────────────────────────────────────
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
  v_caller  uuid := auth.uid();
  v_id      uuid;
  v_retry   boolean;
  v_attempt int;
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
    update public.connections c
       set status         = 'blocked',
           blocked_by     = v_caller,
           decided_at     = now(),
           cooldown_until = null
     where least(c.requester_id, c.addressee_id)    = least(v_caller, p_member)
       and greatest(c.requester_id, c.addressee_id) = greatest(v_caller, p_member)
    returning c.id into v_id;

    if v_id is null then
      begin
        insert into public.connections
          (requester_id, addressee_id, status, blocked_by, decided_at)
        values (v_caller, p_member, 'blocked', v_caller, now())
        returning id into v_id;
      exception when unique_violation then
        v_retry := true;
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


-- ─── 11. unblock_member ─────────────────────────────────────────────
-- Deletes the row outright, returning the pair to no-relationship. A
-- 'blocked' row that has been lifted has nothing left to record: there
-- was never a connection, and connection_events keeps the history
-- regardless.
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

  delete from public.connections c
   where least(c.requester_id, c.addressee_id)    = least(v_caller, p_member)
     and greatest(c.requester_id, c.addressee_id) = greatest(v_caller, p_member)
     and c.status = 'blocked'
     and c.blocked_by = v_caller
  returning c.id into v_id;

  if v_id is null then
    return;
  end if;

  perform public.connection_log_event(v_id, v_caller, p_member, 'unblocked');
end;
$$;

revoke execute on function public.unblock_member(uuid) from public, anon;
grant  execute on function public.unblock_member(uuid) to authenticated;


-- ─── 12. report_connection ──────────────────────────────────────────
-- The optional 300-character note makes this feature user-to-user
-- content, which brings the Online Safety Act's illegal-content duties
-- with it: a UK service has to run a complaints mechanism and act once
-- it knows.
--
-- note_snapshot is the reason this is not a straight copy of
-- report_post. remove_connection and the lifecycle cron both hard-delete
-- the connection row, so a report pointing at a deleted connection would
-- otherwise be unadjudicable — the admin would be reading a complaint
-- about a message that no longer exists anywhere.
--
-- Idempotent by way of the unique index: reporting twice succeeds
-- silently. Telling someone "you already reported this" is a small leak
-- and no help to them.
create or replace function public.report_connection(
  p_id       uuid,
  p_category text,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
  v_other  uuid;
  v_count  int;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can report' using errcode = '42501';
  end if;

  select * into v_row
    from public.connections
   where id = p_id
     and (requester_id = v_caller or addressee_id = v_caller);

  if not found then
    raise exception 'That request no longer exists.' using errcode = '22023';
  end if;

  v_other := case when v_row.requester_id = v_caller then v_row.addressee_id else v_row.requester_id end;

  -- Backstop against report-bombing aimed straight at the RPC. The
  -- unique index already stops repeat reports of the SAME connection;
  -- this is what stops one member working through everyone who has ever
  -- written to them. Mirrors the hardened report_post
  -- (20260830000001).
  select count(*) into v_count
    from public.connection_reports
   where reporter_id = v_caller
     and created_at > now() - interval '24 hours';

  if v_count >= 10 then
    raise exception 'You''ve filed several reports recently. Please give us time to review them.'
      using errcode = '42501';
  end if;

  insert into public.connection_reports
    (connection_id, reporter_id, reported_member_id, category, reason, note_snapshot)
  values (p_id, v_caller, v_other, p_category, btrim(p_reason), v_row.note)
  on conflict do nothing;

  -- Logged whether or not the insert was a duplicate, so the silent
  -- idempotency above does not also silently swallow the audit trail.
  -- Note the event is 'reported', NOT 'report_upheld' — filing a report
  -- is not itself a reputation signal, or reporting would be a weapon.
  -- Only an admin upholding it writes the signal row.
  perform public.connection_log_event(p_id, v_caller, v_other, 'reported');
end;
$$;

revoke execute on function public.report_connection(uuid, text, text) from public, anon;
grant  execute on function public.report_connection(uuid, text, text) to authenticated;
