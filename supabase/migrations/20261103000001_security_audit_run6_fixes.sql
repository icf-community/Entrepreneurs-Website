-- Security audit run-6: fix confirmed boundary violations.
--
-- 1. block_member let the blocked party overwrite blocked_by, then
--    unblock_member (which requires blocked_by = caller) cleared the
--    original blocker's protection.
-- 2. report_connection wrote a connection_events row even when the
--    report insert was a duplicate, so the 10/day cap on connection_reports
--    did not bound audit-log growth.
-- 3. toggle_post_like checked the hourly like cap before taking a
--    per-member lock, so concurrent likes on different posts raced past 200.
-- 4. Listing contact_email CHECKs accepted mailto query injection
--    (e.g. addr?bcc=...) that the UI then interpolated into mailto: hrefs.

-- ─── 1. block_member: do not steal another member's block ────────────
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

  -- Serialise the pair so a concurrent block cannot race the ownership
  -- check below against an in-flight overwrite.
  perform pg_advisory_xact_lock(hashtextextended(
    'block:' || least(v_caller, p_member)::text || ':' || greatest(v_caller, p_member)::text, 0));

  -- Desired end-state is already true when the OTHER party blocked us.
  -- Taking ownership would let us call unblock_member and clear their block.
  if exists (
    select 1 from public.connections c
     where least(c.requester_id, c.addressee_id)    = least(v_caller, p_member)
       and greatest(c.requester_id, c.addressee_id) = greatest(v_caller, p_member)
       and c.status = 'blocked'
       and c.blocked_by is distinct from v_caller
  ) then
    return;
  end if;

  for v_attempt in 1..3 loop
    v_retry := false;
    v_id    := null;

    -- Blocking wins from non-blocked states. If we already own the block,
    -- the update is a no-op refresh of decided_at / restore fields.
    -- A block owned by the other party is handled by the early return
    -- above and excluded again in the WHERE for defence in depth.
    --
    -- The note is left intact (moderation evidence).
    --
    -- Cooldown is carried through untouched so block+unblock cannot
    -- launder a running cooldown; unblock_restore_status says what the
    -- row goes back to if the block is lifted while cooldown is live.
    --
    -- Blocking a pending/accepted row starts a cooldown (as remove does)
    -- and restores to withdrawn/declined/removed rather than resurrecting
    -- the request. 'expired' keeps nothing.
    update public.connections c
       set status         = 'blocked',
           blocked_by     = v_caller,
           decided_at     = now(),
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
       and not (c.status = 'blocked' and c.blocked_by is distinct from v_caller)
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
          -- Quiet return: do not oracle account existence.
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

-- ─── 2. report_connection: log only when a report row was filed ──────
create or replace function public.report_connection(p_id uuid, p_category text, p_reason text)
returns table(filed boolean, reported_name text, category text)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
  v_other  uuid;
  v_count  int;
  v_filed  boolean;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can report' using errcode = '42501';
  end if;

  if p_category is null or p_category not in
       ('harassment', 'spam', 'impersonation', 'illegal', 'hate', 'sexual', 'other') then
    raise exception 'Choose a reason from the list.' using errcode = '22023';
  end if;

  if length(v_reason) < 1 or length(v_reason) > 1000 then
    raise exception 'Tell us what happened, in 1000 characters or fewer.' using errcode = '22023';
  end if;

  select * into v_row
    from public.connections c
   where c.id = p_id
     and (c.requester_id = v_caller or c.addressee_id = v_caller);

  if v_row.id is null then
    raise exception 'That request no longer exists.' using errcode = '22023';
  end if;

  v_other := case when v_row.requester_id = v_caller then v_row.addressee_id else v_row.requester_id end;

  perform pg_advisory_xact_lock(hashtextextended('report_connection:' || v_caller::text, 0));

  select count(*) into v_count
    from public.connection_reports r
   where r.reporter_id = v_caller
     and r.created_at > now() - interval '24 hours';

  if v_count >= 10 then
    raise exception 'You''ve filed several reports recently. Please give us time to review them.'
      using errcode = '42501';
  end if;

  insert into public.connection_reports
    (connection_id, reporter_id, reported_member_id, category, reason, note_snapshot)
  values (p_id, v_caller, v_other, p_category, v_reason, v_row.note)
  on conflict do nothing;

  v_filed := found;

  -- Only a newly filed report writes the audit event. Duplicates must not
  -- grow connection_events unboundedly past the 10/day report cap.
  if v_filed then
    perform public.connection_log_event(p_id, v_caller, v_other, 'reported');
  end if;

  return query
    select v_filed,
           trim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.surname, '')),
           p_category
      from public.profiles p
     where p.id = v_other;

  if not found then
    return query select v_filed, ''::text, p_category;
  end if;
end;
$function$;

revoke execute on function public.report_connection(uuid, text, text) from public, anon;
grant  execute on function public.report_connection(uuid, text, text) to authenticated;

-- ─── 3. toggle_post_like: per-member lock before the hourly cap ──────
create or replace function public.toggle_post_like(p_post_id uuid)
returns table (liked boolean, like_count int)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_author uuid;
  v_liked  boolean;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;

  select author_id into v_author from public.posts
   where id = p_post_id and expires_at > now();
  if v_author is null then
    raise exception 'Post not found';
  end if;
  if v_author = v_caller then
    raise exception 'Cannot like your own post';
  end if;

  -- Cap lock first (per member), then the per-(member,post) toggle lock.
  -- Counting before any lock let concurrent likes on different posts all
  -- read under 200 and all insert.
  perform pg_advisory_xact_lock(hashtextextended('post_like_cap:' || v_caller::text, 0));

  if (select count(*) from public.post_likes
       where user_id = v_caller and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many like actions — try again shortly.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('post_like:' || v_caller::text || ':' || p_post_id::text, 0));

  if exists (select 1 from public.post_likes where post_id = p_post_id and user_id = v_caller) then
    delete from public.post_likes where post_id = p_post_id and user_id = v_caller;
    v_liked := false;
  else
    insert into public.post_likes (post_id, user_id) values (p_post_id, v_caller);
    v_liked := true;
  end if;

  return query select v_liked, (select count(*)::int from public.post_likes where post_id = p_post_id);
end;
$$;

revoke execute on function public.toggle_post_like(uuid) from public, anon;
grant  execute on function public.toggle_post_like(uuid) to authenticated;

-- ─── 4. contact_email: reject mailto query / header injection chars ──
-- NOT VALID: new writes are checked immediately; existing rows (if any
-- already carry a query-bearing address) are not scanned so a legacy
-- row cannot block the migration. The mailto sinks also encode the
-- address so those rows stay safe to render.
alter table public.opportunities
  drop constraint if exists opportunities_contact_email_format;
alter table public.opportunities
  add constraint opportunities_contact_email_format check (
    contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  ) not valid;

alter table public.events
  drop constraint if exists events_contact_email_format;
alter table public.events
  add constraint events_contact_email_format check (
    contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  ) not valid;
