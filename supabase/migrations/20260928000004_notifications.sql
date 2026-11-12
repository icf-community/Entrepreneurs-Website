-- ════════════════════════════════════════════════════════════════════
-- Foundry · In-app notifications (launch programme F-x3)
--
-- A bell in the app shell with an unread count, a list, and mark-read.
-- Email stays the off-site channel; this is the on-site record of the same
-- moments members are already emailed about.
--
-- Written by TRIGGERS on the tables whose state change is the event,
-- rather than by editing the RPCs that change them. The RPCs have been
-- recreated many times (the dead-overload trap this project has hit
-- twice); a trigger sees every path that changes the row, including admin
-- bulk actions, and leaves the RPCs untouched.
--
-- What notifies whom:
--   connection request (new, or a re-request reusing the row) → addressee
--   connection accepted                                        → requester
--   request withdrawn / expired / declined / blocked           → the
--       addressee's unread request notification is removed (declines stay
--       silent for the requester, as everywhere else in Connections)
--   listing approved / rejected (was pending)                  → poster
--   listing edit applied / rejected                            → proposer
--   post report actioned / dismissed                           → reporter
--   membership approved after manual review                    → member
--
-- Privacy: a notification only ever names someone the recipient could
-- already see in that context (the requester on a request they received,
-- the person who accepted theirs). Deletion: user_id cascades from
-- auth.users, so account deletion takes them (F30). Retention: 90 days,
-- purged daily by pg_cron (F31).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in (
                'connection_request', 'connection_accepted',
                'listing_approved', 'listing_rejected',
                'listing_edit_applied', 'listing_edit_rejected',
                'report_outcome', 'membership_approved')),
  title       text not null check (char_length(title) between 1 and 160),
  body        text check (body is null or char_length(body) <= 300),
  -- In-app path only; never an external URL.
  link        text check (link is null or (link ~ '^/[A-Za-z0-9/_?=&%.-]*$' and char_length(link) <= 200)),
  -- The row this is about (a connection, listing, edit or report), so a
  -- withdrawn request can remove its own notification.
  ref_id      uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx  on public.notifications (user_id) where read_at is null;
create index if not exists notifications_ref_idx          on public.notifications (ref_id) where ref_id is not null;

alter table public.notifications enable row level security;
-- No direct access: reads and mark-read go through the RPCs below.
revoke all on public.notifications from anon, authenticated;

-- ─── Writer ────────────────────────────────────────────────────────
create or replace function public.notify(
  p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_ref uuid
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, kind, title, body, link, ref_id)
  select p_user, p_kind, left(p_title, 160), left(p_body, 300), p_link, p_ref
   where p_user is not null
     and exists (select 1 from auth.users u where u.id = p_user);
$$;

revoke execute on function public.notify(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- A display name for someone the recipient is allowed to see in context.
create or replace function public.notification_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(concat_ws(' ', coalesce(nullif(btrim(p.preferred_name), ''), p.first_name), p.surname)), '')
       from public.profiles p where p.id = p_user),
    'A member');
$$;

revoke execute on function public.notification_name(uuid) from public, anon, authenticated;

-- ─── Connections ───────────────────────────────────────────────────
create or replace function public.tg_notify_connections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A new request, or a re-request that reuses a closed row.
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    perform public.notify(new.addressee_id, 'connection_request',
      public.notification_name(new.requester_id) || ' wants to connect',
      null, '/connections?tab=pending', new.id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform public.notify(new.requester_id, 'connection_accepted',
      public.notification_name(new.addressee_id) || ' accepted your connection request',
      null, '/connections', new.id);
    delete from public.notifications
     where ref_id = new.id and kind = 'connection_request' and read_at is null;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status <> 'pending' then
    -- Withdrawn, expired, declined or blocked: the request is gone, so its
    -- unread notification goes too. Nothing is sent to the requester.
    delete from public.notifications
     where ref_id = new.id and kind = 'connection_request' and read_at is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.tg_notify_connections() from public, anon, authenticated;

drop trigger if exists notify_connections on public.connections;
create trigger notify_connections
  after insert or update of status on public.connections
  for each row execute function public.tg_notify_connections();

-- ─── Listings (opportunities, events, vcs_grants) ──────────────────
create or replace function public.tg_notify_listing_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_path  text;
  v_noun  text;
begin
  if old.status is distinct from 'pending' or new.status not in ('approved', 'rejected') then
    return null;
  end if;

  if tg_table_name = 'opportunities' then
    v_title := new.position_name; v_path := '/opportunities/' || new.id; v_noun := 'opportunity';
  elsif tg_table_name = 'events' then
    v_title := new.title;         v_path := '/events/' || new.id;        v_noun := 'event';
  else
    v_title := new.name;          v_path := '/vcs/' || new.id;           v_noun := 'listing';
  end if;

  if new.status = 'approved' then
    perform public.notify(new.posted_by, 'listing_approved',
      'Your ' || v_noun || ' "' || left(v_title, 80) || '" is live', null, v_path, new.id);
  else
    perform public.notify(new.posted_by, 'listing_rejected',
      'Your ' || v_noun || ' "' || left(v_title, 80) || '" wasn''t approved',
      new.rejected_reason, '/my-submissions', new.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.tg_notify_listing_review() from public, anon, authenticated;

drop trigger if exists notify_listing_review on public.opportunities;
create trigger notify_listing_review after update of status on public.opportunities
  for each row execute function public.tg_notify_listing_review();
drop trigger if exists notify_listing_review on public.events;
create trigger notify_listing_review after update of status on public.events
  for each row execute function public.tg_notify_listing_review();
drop trigger if exists notify_listing_review on public.vcs_grants;
create trigger notify_listing_review after update of status on public.vcs_grants
  for each row execute function public.tg_notify_listing_review();

-- ─── Listing edits ─────────────────────────────────────────────────
create or replace function public.tg_notify_listing_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if old.status is distinct from 'pending' or new.status not in ('applied', 'rejected') then
    return null;
  end if;
  v_path := case new.listing_kind
              when 'opportunity' then '/opportunities/' || new.listing_id
              when 'event'       then '/events/' || new.listing_id
              else '/vcs/' || new.listing_id
            end;
  if new.status = 'applied' then
    perform public.notify(new.proposed_by, 'listing_edit_applied',
      'Your changes to a listing are live', null, v_path, new.id);
  else
    perform public.notify(new.proposed_by, 'listing_edit_rejected',
      'Your changes to a listing weren''t approved', new.reject_reason, '/my-submissions', new.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.tg_notify_listing_edit() from public, anon, authenticated;

drop trigger if exists notify_listing_edit on public.listing_edits;
create trigger notify_listing_edit after update of status on public.listing_edits
  for each row execute function public.tg_notify_listing_edit();

-- ─── Report outcomes ───────────────────────────────────────────────
create or replace function public.tg_notify_report_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'open' and new.status in ('actioned', 'dismissed') then
    perform public.notify(new.reporter_id, 'report_outcome',
      case when new.status = 'actioned'
           then 'We acted on a post you reported'
           else 'We reviewed a post you reported' end,
      null, '/community', new.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.tg_notify_report_outcome() from public, anon, authenticated;

drop trigger if exists notify_report_outcome on public.post_reports;
create trigger notify_report_outcome after update of status on public.post_reports
  for each row execute function public.tg_notify_report_outcome();

-- ─── Membership approval ───────────────────────────────────────────
create or replace function public.tg_notify_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending_review' and new.status = 'approved' then
    perform public.notify(new.id, 'membership_approved',
      'Welcome to Foundry: your membership is approved', null, '/home', new.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.tg_notify_membership() from public, anon, authenticated;

drop trigger if exists notify_membership on public.profiles;
create trigger notify_membership after update of status on public.profiles
  for each row execute function public.tg_notify_membership();

-- ─── Member reads ──────────────────────────────────────────────────
create or replace function public.list_my_notifications(
  p_limit  int default 20,
  p_before timestamptz default null
)
returns table (id uuid, kind text, title text, body text, link text, read_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.kind, n.title, n.body, n.link, n.read_at, n.created_at
    from public.notifications n
   where n.user_id = auth.uid()
     and (p_before is null or n.created_at < p_before)
   order by n.created_at desc, n.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.list_my_notifications(int, timestamptz) from public, anon;
grant  execute on function public.list_my_notifications(int, timestamptz) to authenticated;

-- The bell's badge. Index-only on the partial unread index; capped so a
-- neglected inbox doesn't turn into a big count on every page.
create or replace function public.my_unread_notification_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from (
    select 1 from public.notifications
     where user_id = auth.uid() and read_at is null
     limit 100
  ) x;
$$;

revoke execute on function public.my_unread_notification_count() from public, anon;
grant  execute on function public.my_unread_notification_count() to authenticated;

-- Mark some (p_ids) or all (null) of the caller's own notifications read.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_ids is not null and cardinality(p_ids) > 100 then
    raise exception 'Too many notifications at once.' using errcode = '22023';
  end if;
  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant  execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ─── Retention: 90 days (F31) ──────────────────────────────────────
create or replace function public.purge_old_notifications()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.notifications
   where id in (
     select id from public.notifications
      where created_at < now() - interval '90 days'
      limit 5000
   );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.purge_old_notifications() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purge-old-notifications-daily');
exception when others then
  null;  -- not scheduled yet
end;
$$;

-- 02:40, after purge-moderation-records-daily at 02:35.
select cron.schedule(
  'purge-old-notifications-daily',
  '40 2 * * *',
  $$select public.purge_old_notifications();$$
);
