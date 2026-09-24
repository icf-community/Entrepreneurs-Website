-- ════════════════════════════════════════════════════════════════════
-- Foundry · Connections — admin surface, lifecycle jobs, digest cron
--
-- Three groups, and the boundary between them matters:
--
--   §1-3  LIFECYCLE. Owned by pg_cron, revoked from every client role.
--         Expiry, the deferred hard-delete of removed rows, and the
--         12-month purge of the audit tables.
--
--   §4-5  THE DIGEST. A pg_cron job that POSTs to a Next.js route, which
--         claims a batch and enqueues mail. MAIL IS NEVER SENT FROM SQL
--         — enqueue_outbound_email is revoked from every client role
--         because it was an open phishing relay (20260531000004).
--
--   §6-12 ADMIN. Granted to `authenticated` like every other admin_* RPC
--         in this codebase and guarded by is_admin() INSIDE the body,
--         which is what rls_smoke §21 asserts.
--
-- ─── ON `service_role` AND THE REVOKES BELOW ────────────────────────
-- `revoke ... from public, anon, authenticated` does NOT take EXECUTE
-- away from service_role, which holds its own grant. That is what lets
-- the digest route call claim_connection_digests with the service client
-- while no browser session can reach it — the same arrangement
-- due_github_showcase_nudges already relies on. Verified with
-- has_function_privilege rather than assumed, per the CLI-2116
-- workaround note.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. expire_connection_requests ──────────────────────────────────
-- A pending request that nobody ever answered stops being a request and
-- becomes clutter. At expiry_months it is retired.
--
-- EXPIRY CARRIES NO COOLDOWN, and that is the one thing separating it
-- from decline and withdraw. Nobody decided anything here — the request
-- was ignored, possibly because the recipient never logged in — so the
-- sender may try again immediately. Setting a cooldown would punish the
-- sender for the recipient's inactivity.
--
-- Bounded batch, same safety valve as the purge jobs in
-- 20260829000003: at today's membership this limit never engages, but it
-- stops a long-paused cron from rewriting an enormous backlog in one
-- statement while holding locks.
create or replace function public.expire_connection_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r       record;
begin
  -- The UPDATE is wrapped in a CTE rather than driving the FOR loop
  -- directly: plpgsql's `FOR rec IN <query>` takes a query, and a bare
  -- data-modifying statement is not one. `select * from upd` is.
  for r in
    with upd as (
      update public.connections c
         set status     = 'expired',
             decided_at = now()
       where c.id in (
         select id from public.connections
          where status = 'pending'
            and created_at < now() - make_interval(months => public.connection_limit('expiry_months'))
          order by created_at
          limit 500
       )
         and c.status = 'pending'
      returning c.id, c.requester_id
    )
    select * from upd
  loop
    -- actor is null: nobody did this, a clock did.
    perform public.connection_log_event(r.id, null, r.requester_id, 'expired');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.expire_connection_requests() from public, anon, authenticated;


-- ─── 2. purge_removed_connections ───────────────────────────────────
-- THE DEFERRED HARD DELETE. remove_connection sets status 'removed' and
-- a 21-day cooldown rather than deleting immediately, because removal is
-- not a decline and would otherwise carry no cooldown at all — letting
-- someone remove, instantly re-request, and repeat. This is where the
-- deletion the member asked for actually happens.
--
-- connection_events survives it (no FK, deliberately), which is the
-- whole reason the history table exists.
create or replace function public.purge_removed_connections()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with doomed as (
    select id from public.connections
     where status = 'removed'
       and cooldown_until is not null
       and cooldown_until <= now()
     order by cooldown_until
     limit 500
  ),
  gone as (
    delete from public.connections c using doomed d where c.id = d.id returning 1
  )
  select count(*) into v_count from gone;

  return v_count;
end;
$$;

revoke execute on function public.purge_removed_connections() from public, anon, authenticated;


-- ─── 3. purge_connection_records ────────────────────────────────────
-- The 12-month retention bound on the two audit tables, matching
-- post_reports and post_moderation_log exactly.
--
-- Lawful basis for holding either past an erasure request: UK GDPR
-- Art. 17(3)(e), retention for the establishment, exercise or defence of
-- legal claims. That basis is time-bounded by definition, so the bound
-- has to be enforced by something that actually runs — this.
--
-- OPEN REPORTS ARE NEVER PURGED. A complaint nobody adjudicated in a
-- year is a process failure, and silently deleting it would hide the
-- failure rather than fix it. It stays in the queue until a human closes
-- it, and only then does its clock start mattering.
create or replace function public.purge_connection_records()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events  integer;
  v_reports integer;
begin
  with doomed as (
    select id from public.connection_events
     where purge_after <= now()
     order by purge_after
     limit 2000
  ),
  gone as (
    delete from public.connection_events e using doomed d where e.id = d.id returning 1
  )
  select count(*) into v_events from gone;

  with doomed as (
    select id from public.connection_reports
     where purge_after <= now()
       and status <> 'open'
     order by purge_after
     limit 500
  ),
  gone as (
    delete from public.connection_reports r using doomed d where r.id = d.id returning 1
  )
  select count(*) into v_reports from gone;

  return v_events + v_reports;
end;
$$;

revoke execute on function public.purge_connection_records() from public, anon, authenticated;


-- ─── 4. claim_connection_digests ────────────────────────────────────
-- ONE DAILY DIGEST PER RECIPIENT, however many requests are waiting.
--
-- Count-based digests ("every 5 requests") were rejected outright: a
-- member with two pending requests would never be emailed at all,
-- stranding those two senders permanently.
--
-- CLAIM-THEN-SEND. This function stamps digested_at in the same
-- statement that selects the rows, so two overlapping cron runs cannot
-- both claim the same request — the loser matches zero rows. Exactly
-- once, with no time-window arithmetic, and a request ignored last week
-- never nags again.
--
-- The tradeoff, stated plainly: if the route dies between this claim and
-- the enqueue, those rows are stamped and never mailed. That is
-- at-most-once, chosen deliberately over at-least-once, because the
-- failure mode of the alternative is mailing somebody twice about the
-- same request — and digest mail shares a sending domain with sign-in
-- mail, where a spam complaint costs far more than a missed nudge.
--
-- ─── THE PAYLOAD CARRIES NAMES AND COUNTS. NEVER NOTE TEXT. ─────────
-- Two reasons, either one sufficient:
--   1. The note is attacker-controlled text and the digest builds HTML.
--      Not carrying it removes the injection surface entirely rather
--      than relying on an escape being correct forever.
--   2. It stops an abusive note reaching somebody's inbox when they
--      would never have opened the app. The note is readable in Foundry,
--      where it sits next to a Block control and a Report control.
create or replace function public.claim_connection_digests(p_limit int default 200)
returns table (
  member_id     uuid,
  email         text,
  first_name    text,
  pending_count int,
  sender_names  text[]
)
language sql
security definer
set search_path = public, auth
as $$
  with claimed as (
    update public.connections c
       set digested_at = now()
     where c.id in (
       select c2.id
         from public.connections c2
         join public.profiles rp on rp.id = c2.requester_id
         join public.profiles ap on ap.id = c2.addressee_id
        where c2.status = 'pending'
          and c2.digested_at is null
          -- Both ends re-checked: a banned sender's request is not worth
          -- an email, and a banned recipient is not getting one.
          and rp.status = 'approved'
          and ap.status = 'approved'
          -- The opt-out. Rows belonging to an opted-out member are left
          -- UNCLAIMED rather than claimed-and-discarded, so if they turn
          -- digests back on they get one summary of what is waiting
          -- instead of a permanently empty inbox tab they were never
          -- told about.
          and ap.connection_emails_enabled
        order by c2.created_at
        limit greatest(1, least(coalesce(p_limit, 200), 1000))
     )
       and c.status = 'pending'
       and c.digested_at is null
    returning c.addressee_id, c.requester_id
  )
  select
    ap.id,
    u.email::text,
    ap.first_name,
    count(*)::int,
    array_agg(
      trim(coalesce(rp.preferred_name, rp.first_name, '') || ' ' || coalesce(rp.surname, ''))
      order by rp.first_name, rp.surname
    )
  from claimed cl
  join public.profiles ap on ap.id = cl.addressee_id
  join auth.users     u  on u.id  = ap.id
  join public.profiles rp on rp.id = cl.requester_id
  group by ap.id, u.email, ap.first_name;
$$;

revoke execute on function public.claim_connection_digests(int) from public, anon, authenticated;


-- ─── 5. cron_connection_digest ──────────────────────────────────────
-- Same shape as cron_drain_outbound_email (20260530000003) and
-- cron_github_showcase_nudge: check there is anything to do, read the
-- URL and shared secret out of app_config, and no-op with a warning if
-- they have not been seeded — so this migration applies cleanly to a
-- fresh database and to a preview stack that has no cron secret.
--
-- The exists() gate is deliberately cheap and deliberately approximate:
-- it does not repeat the approval and opt-out predicates from §4. A
-- false positive costs one HTTP round trip that claims nothing; teaching
-- two places the same rules costs a correctness bug the first time only
-- one of them is updated.
create or replace function public.cron_connection_digest()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_url    text;
  v_secret text;
begin
  if not exists (
    select 1 from public.connections
     where status = 'pending' and digested_at is null
  ) then
    return;
  end if;

  select value into v_url    from public.app_config where key = 'connections_digest_url';
  select value into v_secret from public.app_config where key = 'cron_secret';

  if v_url is null or v_secret is null then
    raise warning 'cron_connection_digest: connections_digest_url or cron_secret not configured in app_config';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function public.cron_connection_digest() from public, anon, authenticated;


-- ─── 6. admin_list_connection_reports ───────────────────────────────
-- The moderation queue. Mirrors admin_list_post_reports.
--
-- NOTE THE ABSENT COLUMN: note_snapshot is not returned here. Reading
-- the private text a member sent another member is a separate,
-- individually audited act — admin_reveal_connection_note below — for
-- the same reason admin_get_cv_info is separate from the member list.
-- A queue that renders the content is a queue where every glance is an
-- unlogged read.
create or replace function public.admin_list_connection_reports(
  p_status text default 'open',
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id                  uuid,
  connection_id       uuid,
  category            text,
  reason              text,
  status              text,
  created_at          timestamptz,
  resolved_at         timestamptz,
  resolution_note     text,
  has_note            boolean,
  reporter_id         uuid,
  reporter_name       text,
  reported_member_id  uuid,
  reported_name       text,
  reported_signals    bigint,
  admin_is_party      boolean,
  total_count         bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  return query
  with matched as (
    select r.* from public.connection_reports r
     where p_status is null or r.status = p_status
  ),
  counted as (
    select m.*, count(*) over () as k_total from matched m
  ),
  page as (
    select * from counted cn
     order by cn.created_at desc, cn.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    pg.id, pg.connection_id, pg.category, pg.reason, pg.status,
    pg.created_at, pg.resolved_at, pg.resolution_note,
    pg.note_snapshot is not null,
    pg.reporter_id,
    trim(coalesce(rep.preferred_name, rep.first_name, '') || ' ' || coalesce(rep.surname, '')),
    pg.reported_member_id,
    trim(coalesce(sub.preferred_name, sub.first_name, '') || ' ' || coalesce(sub.surname, '')),
    -- How many DISTINCT members have raised a signal about this person.
    -- The number that actually decides whether this is a pattern or a
    -- one-off, shown next to the report rather than left for the admin
    -- to go and count.
    (select count(distinct e.actor_id)
       from public.connection_events e
      where e.subject_id = pg.reported_member_id
        and e.event in ('blocked', 'report_upheld')
        and e.actor_id is not null
        and e.created_at > now() - make_interval(days => public.connection_limit('throttle_lookback_days'))),
    -- CONFLICT OF INTEREST. An admin is a member too, and can be one of
    -- the two people in a reported connection. The action is still
    -- permitted and still logged either way — this exists so the UI can
    -- say so out loud rather than leaving the admin to notice.
    (exists (
      select 1 from public.connections c
       where c.id = pg.connection_id
         and (c.requester_id = v_caller or c.addressee_id = v_caller)
    ) or pg.reporter_id = v_caller or pg.reported_member_id = v_caller),
    pg.k_total
  from page pg
  left join public.profiles rep on rep.id = pg.reporter_id
  left join public.profiles sub on sub.id = pg.reported_member_id;
end;
$$;

revoke execute on function public.admin_list_connection_reports(text, int, int) from public, anon;
grant  execute on function public.admin_list_connection_reports(text, int, int) to authenticated;


-- ─── 7. admin_reveal_connection_note ────────────────────────────────
-- THE AUDIT ROW IS WRITTEN BEFORE THE TEXT IS RETURNED, not after. Same
-- discipline as admin_log_cv_access. If the response is lost — a dropped
-- connection, a crashed request — the record that someone looked still
-- exists. An audit trail written after the fact is one that goes missing
-- in exactly the cases where it matters.
create or replace function public.admin_reveal_connection_note(p_report_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_note   text;
  v_found  boolean;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  select note_snapshot, true into v_note, v_found
    from public.connection_reports where id = p_report_id;

  if not coalesce(v_found, false) then
    raise exception 'That report no longer exists.' using errcode = '22023';
  end if;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'reveal_connection_note', 'connection_reports', p_report_id,
          'Revealed the reported connection note');

  return v_note;
end;
$$;

revoke execute on function public.admin_reveal_connection_note(uuid) from public, anon;
grant  execute on function public.admin_reveal_connection_note(uuid) to authenticated;


-- ─── 8. admin_resolve_connection_report ─────────────────────────────
-- `where status = 'open'` is the whole concurrency story: two admins
-- resolving the same report, one wins, the loser is told it was already
-- handled rather than silently overwriting the first verdict.
--
-- Returns the reporter's identity so the action can close the loop by
-- email. Telling a complainant what happened is the half of a complaints
-- process that is easiest to skip and the half that makes it real.
--
-- ─── THE 'report_upheld' EVENT AND ITS DELIBERATELY ODD actor_id ────
-- Upholding a report writes a reputation signal, and that signal's
-- actor_id is the ORIGINAL REPORTER, not the admin who upheld it. The
-- throttle asks "how many distinct members raised a signal about this
-- person". Recording the admin would make five upheld reports from one
-- reporter look like five independent signals — or one admin clearing a
-- queue of five look like a single one. The admin's identity belongs in
-- admin_actions, and it is written there.
create or replace function public.admin_resolve_connection_report(
  p_report_id uuid,
  p_status    text,
  p_note      text default null
)
returns table (email text, first_name text, reported_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_report public.connection_reports%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'Resolution must be actioned or dismissed' using errcode = '22023';
  end if;

  update public.connection_reports r
     set status          = p_status,
         resolved_by     = v_caller,
         resolved_at     = now(),
         resolution_note = nullif(btrim(p_note), '')
   where r.id = p_report_id
     and r.status = 'open'
  returning r.* into v_report;

  if not found then
    raise exception 'That report has already been resolved.' using errcode = '22023';
  end if;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller,
          case when p_status = 'actioned' then 'uphold_connection_report'
                                          else 'dismiss_connection_report' end,
          'connection_reports', p_report_id, nullif(btrim(p_note), ''));

  if p_status = 'actioned' and v_report.reporter_id is not null
     and v_report.reported_member_id is not null then
    perform public.connection_log_event(
      v_report.connection_id,
      v_report.reporter_id,          -- see the header comment. Not the admin.
      v_report.reported_member_id,
      'report_upheld'
    );
  end if;

  return query
    select u.email::text,
           rep.first_name,
           trim(coalesce(sub.preferred_name, sub.first_name, '') || ' ' || coalesce(sub.surname, ''))
      from public.profiles rep
      join auth.users u on u.id = rep.id
      left join public.profiles sub on sub.id = v_report.reported_member_id
     where rep.id = v_report.reporter_id;
end;
$$;

revoke execute on function public.admin_resolve_connection_report(uuid, text, text) from public, anon;
grant  execute on function public.admin_resolve_connection_report(uuid, text, text) to authenticated;


-- ─── 9. admin_list_flagged_senders ──────────────────────────────────
-- Two independent columns, and conflating them would be the mistake.
--
-- `throttled` is the automatic one: distinct members blocked or
-- successfully reported this sender, and the daily cap has already
-- dropped. It happened without an admin.
--
-- `decline_rate` DRIVES NOTHING AUTOMATICALLY and never will. This
-- community has a status gradient — students requesting alumni, alumni
-- requesting angels — and a junior member's requests going unanswered is
-- not misbehaviour. Throttling on it would penalise exactly who the
-- platform exists to help. It is here so a human can look, which is a
-- completely different thing from a system that acts.
create or replace function public.admin_list_flagged_senders(p_limit int default 50)
returns table (
  member_id        uuid,
  member_name      text,
  distinct_signals bigint,
  throttled        boolean,
  requests_sent    bigint,
  declines         bigint,
  decline_rate     numeric
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  return query
  with window_start as (
    select now() - make_interval(days => public.connection_limit('throttle_lookback_days')) as at
  ),
  signals as (
    select e.subject_id as k_member, count(distinct e.actor_id) as k_signals
      from public.connection_events e, window_start w
     where e.event in ('blocked', 'report_upheld')
       and e.actor_id is not null
       and e.created_at > w.at
     group by e.subject_id
  ),
  sends as (
    select e.actor_id as k_member, count(*) as k_sent
      from public.connection_events e, window_start w
     where e.event = 'requested'
       and e.actor_id is not null
       and e.created_at > w.at
     group by e.actor_id
  ),
  -- 'declined' events are logged with the DECLINER as actor and the
  -- SENDER as subject, so a sender's declines are counted through
  -- subject_id. Reading them off actor_id would report the member who
  -- declines the most as the member who is declined the most — close to
  -- the exact opposite of the truth, and it would look plausible.
  declined_against as (
    select e.subject_id as k_member, count(*) as k_declined
      from public.connection_events e, window_start w
     where e.event = 'declined' and e.created_at > w.at
     group by e.subject_id
  ),
  -- A union of the three key sets, then three LEFT JOINs. A chain of
  -- FULL JOINs would work too, but the join key becomes a coalesce of
  -- the keys already joined and is wrong the moment a fourth source is
  -- added — this shape does not have that failure mode.
  members as (
    select k_member from signals
    union
    select k_member from sends
    union
    select k_member from declined_against
  ),
  merged as (
    select mb.k_member,
           coalesce(sg.k_signals, 0)  as k_signals,
           coalesce(sd.k_sent, 0)     as k_sent,
           coalesce(da.k_declined, 0) as k_declined
      from members mb
      left join signals          sg on sg.k_member = mb.k_member
      left join sends            sd on sd.k_member = mb.k_member
      left join declined_against da on da.k_member = mb.k_member
  )
  select
    m.k_member,
    trim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.surname, '')),
    m.k_signals,
    public.connection_sender_throttled(m.k_member),
    m.k_sent,
    m.k_declined,
    case when m.k_sent = 0 then 0::numeric
         else round(m.k_declined::numeric / m.k_sent::numeric, 3) end
  from merged m
  left join public.profiles p on p.id = m.k_member
  -- Either signal is enough to appear. The floor of 5 sends on the
  -- decline branch stops a member whose single request was declined from
  -- showing a 100% decline rate.
  where m.k_signals > 0
     or (m.k_sent >= 5 and m.k_declined::numeric / m.k_sent::numeric >= 0.7)
  order by m.k_signals desc, m.k_declined desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.admin_list_flagged_senders(int) from public, anon;
grant  execute on function public.admin_list_flagged_senders(int) to authenticated;


-- ─── 10. admin_clear_sender_throttle ────────────────────────────────
-- The override, and it is APPEND-ONLY rather than a flag being unset.
-- connection_sender_throttled counts only signals newer than the most
-- recent 'throttle_cleared' event, so clearing leaves the original
-- signals intact and visible — the admin queue still shows what happened
-- — while stopping them from counting. An admin who clears in error can
-- see exactly what they cleared.
create or replace function public.admin_clear_sender_throttle(
  p_member uuid,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_member is null then
    raise exception 'A member is required' using errcode = '22023';
  end if;

  -- connection_id is not nullable and there is no connection this is
  -- about, so it carries the member's own id. The event is about a
  -- person, not a pair.
  perform public.connection_log_event(p_member, v_caller, p_member, 'throttle_cleared');

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'clear_connection_throttle', 'profiles', p_member, nullif(btrim(p_note), ''));
end;
$$;

revoke execute on function public.admin_clear_sender_throttle(uuid, text) from public, anon;
grant  execute on function public.admin_clear_sender_throttle(uuid, text) to authenticated;


-- ─── 11. admin_set_connections_enabled / admin_get_connections_status
-- The 2am lever: a spam wave, or a complaint about the feature itself.
-- One RPC, no deploy. Copied from admin_set_ingestion_enabled
-- (20260914000002) including its documented one-off use of a nil
-- target_id, since app_config rows are keyed by text and have no uuid to
-- point at.
--
-- Remember what this switch does and does not do: it gates NEW REQUESTS
-- ONLY. Accept, decline, withdraw, block, report and remove keep
-- working, and the digest keeps running.
create or replace function public.admin_set_connections_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  update public.app_config
     set value      = case when p_enabled then 'true' else 'false' end,
         updated_at = now()
   where key = 'connections_enabled';

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller,
          case when p_enabled then 'resume_connections' else 'pause_connections' end,
          'app_config', '00000000-0000-0000-0000-000000000000'::uuid, 'connections_enabled');
end;
$$;

revoke execute on function public.admin_set_connections_enabled(boolean) from public, anon;
grant  execute on function public.admin_set_connections_enabled(boolean) to authenticated;

create or replace function public.admin_get_connections_status()
returns table (
  enabled         boolean,
  last_changed_at timestamptz,
  last_changed_by text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  return query
    select public.connections_enabled(),
           aa.created_at,
           trim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.surname, ''))
      from (
        select admin_id, created_at
          from public.admin_actions
         where target_table = 'app_config'
           and action in ('pause_connections', 'resume_connections')
         order by created_at desc
         limit 1
      ) aa
      left join public.profiles p on p.id = aa.admin_id;

  if not found then
    return query select public.connections_enabled(), null::timestamptz, null::text;
  end if;
end;
$$;

revoke execute on function public.admin_get_connections_status() from public, anon;
grant  execute on function public.admin_get_connections_status() to authenticated;


-- ─── 12. admin_connection_stats ─────────────────────────────────────
-- THREE AGGREGATES, AND DELIBERATELY NOT A NETWORK VIEW.
--
-- An admin view of the whole graph was considered and rejected. The
-- Sybil-cluster argument for one does not apply here: a connection buys
-- an email address that the other party individually agreed to share,
-- not reach or ranking or status, so a collusion ring gains nothing, and
-- closed verified membership makes building one expensive for no payoff.
-- The abuse cases that ARE real are covered by the report queue,
-- admin_list_flagged_senders, the block-triggered throttle and
-- connection_events.
--
-- A standing UI rendering everyone's relationships would be the largest
-- personal-data read in the application, permanently, needing to be
-- secured, audited and defended in the DPIA whether or not anyone ever
-- opened it. These three numbers answer the actual question — "are
-- cohorts siloed?" — with no per-member exposure at all. Anything deeper
-- is an ad-hoc query against a table that already holds the data.
create or replace function public.admin_connection_stats()
returns table (
  total_connections  bigint,
  median_per_member  numeric,
  cross_cohort_pct   numeric
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  return query
  with accepted as (
    select c.requester_id, c.addressee_id from public.connections c where c.status = 'accepted'
  ),
  degree as (
    -- LEFT JOIN, so members with zero connections are in the median.
    -- Excluding them would report the median of the connected, which is
    -- the flattering number rather than the true one.
    select p.id, coalesce(d.k_n, 0) as k_n
      from public.profiles p
      left join (
        select k_member, count(*) as k_n from (
          select requester_id as k_member from accepted
          union all
          select addressee_id             from accepted
        ) x group by k_member
      ) d on d.k_member = p.id
     where p.status = 'approved'
  ),
  cohorts as (
    -- "Cross-cohort" = the two members graduate in different years.
    -- Pairs where either side has no grad year are excluded from BOTH
    -- halves of the fraction rather than counted as same-cohort, which
    -- would quietly deflate the number that is being watched.
    select count(*) filter (where rp.grad_year is distinct from ap.grad_year) as k_cross,
           count(*)                                                          as k_total
      from accepted a
      join public.profiles rp on rp.id = a.requester_id
      join public.profiles ap on ap.id = a.addressee_id
     where rp.grad_year is not null and ap.grad_year is not null
  )
  select
    (select count(*) from accepted),
    (select round(percentile_cont(0.5) within group (order by k_n)::numeric, 2) from degree),
    (select case when k_total = 0 then 0::numeric
                 else round(100.0 * k_cross / k_total, 1) end from cohorts);
end;
$$;

revoke execute on function public.admin_connection_stats() from public, anon;
grant  execute on function public.admin_connection_stats() to authenticated;


-- ─── 13. Cron registration ──────────────────────────────────────────
-- Idempotent unschedule-then-schedule, same convention as
-- 20260829000003, so re-applying this migration does not pile up
-- duplicate cron rows.
--
-- SLOTS, and why these ones. Taken already: 02:00 / 02:05 / 02:10
-- listing expiries, 02:30 purge-rejected-listings, 02:35
-- purge-moderation-records, 03:00 and :07 the GitHub rescans, :15 / :25
-- hourly purges, */5 the email drain and blob deletions, Monday 09:30
-- the showcase nudge.
--
-- 02:40 and 02:45 for the two lifecycle jobs, immediately after the
-- existing purge pair. 08:00 for the digest, because it is the one job
-- here whose timing a human experiences: it should land before the
-- working day, not in the middle of the night where it is buried by
-- morning.
--
-- The plan flagged a risk that the digest might land just after the
-- outbound drain and be delayed a full day. It cannot: drain-outbound-email
-- runs every five minutes, so nothing queued waits more than that.
do $$
begin
  begin perform cron.unschedule('expire-connection-requests-daily'); exception when others then null; end;
  begin perform cron.unschedule('purge-connection-records-daily');   exception when others then null; end;
  begin perform cron.unschedule('connections-digest-daily');         exception when others then null; end;
end;
$$;

select cron.schedule(
  'expire-connection-requests-daily',
  '40 2 * * *',
  $$select public.expire_connection_requests();$$
);

select cron.schedule(
  'purge-connection-records-daily',
  '45 2 * * *',
  $$select public.purge_removed_connections(); select public.purge_connection_records();$$
);

select cron.schedule(
  'connections-digest-daily',
  '0 8 * * *',
  $$select public.cron_connection_digest();$$
);
