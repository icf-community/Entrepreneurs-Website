-- ════════════════════════════════════════════════════════════════════
-- I-1b: send_connection_request leaked a foreign-key message when the sender
-- (or the addressee) deleted their account between the checks and the write.
--
-- e2e/adversarial/concurrency.spec.ts raced a send against the sender's own
-- delete_my_account and saw `connections_requester_id_fkey` (23503) in the
-- reply. Only the member racing themselves saw it, and no row survived, so it
-- was accepted as informational. The addressee half is a different matter: a
-- send to someone who deletes their account at that instant returned a
-- constraint name, which tells the sender the other account is gone. Both now
-- get the same generic refusal as every other "no" in this feature
-- (connection_refusal_message(), 42501).
--
-- Body is the LATEST definition (20260917000017) with the write section
-- (reuse-update or insert, plus the event log) wrapped in a block whose only
-- handler is `foreign_key_violation`. The block is a sub-transaction, so a
-- failed write leaves nothing behind. Signature, security definer,
-- search_path and grants are unchanged.
--
-- Prod pre-check: none, no data is touched.
-- Rollback: re-apply the function from 20260917000017_connections_directional_cooldown.sql.
-- ════════════════════════════════════════════════════════════════════

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
    begin
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
  exception when foreign_key_violation then
    -- The sender or the addressee was deleted between our checks and the write
    -- (delete_my_account racing this call). Say what every other refusal says,
    -- not the constraint name, which also tells the caller the other account is gone.
    raise exception '%', public.connection_refusal_message() using errcode = '42501';
    end;
  end loop;

  -- Three passes without resolving means the row is being rewritten
  -- faster than we can read it, which in practice means something is
  -- wrong rather than contended.
  raise exception '%', public.connection_refusal_message() using errcode = '40001';
end;
$$;

revoke execute on function public.send_connection_request(uuid, text, text) from public, anon;
grant  execute on function public.send_connection_request(uuid, text, text) to authenticated;
