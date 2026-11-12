-- ════════════════════════════════════════════════════════════════════
-- Foundry · admin_list_flagged_senders: count sends only for candidates
--           (D1 scalability audit)
--
-- The `sends` CTE counted every 'requested' event in the 90-day window
-- for every member (75k rows at the 5k-member corpus, 82 ms), only for
-- nearly all of them to be filtered out by the final WHERE.
--
-- A member appears only with a signal, or with k_sent >= 5 AND
-- k_declined / k_sent >= 0.7, which needs k_declined >= 3.5, i.e. >= 4.
-- So the candidates are "has a signal" or "has >= 4 declines", and sends
-- are counted for those members only (connection_events_actor_idx
-- serves that lookup). The rows returned are identical; the cost now
-- follows declines and signals rather than all requests. If the 5 / 0.7
-- thresholds below change, the 4 must be re-derived with them.
--
-- The signal and decline scans filter on event + window and had no index
-- to use (the existing ones lead with actor_id / subject_id), so each
-- read the whole table. (event, created_at) serves both; with it the
-- call is 105 → 12 ms on the corpus. The table is append-only apart from
-- the yearly purge, so the extra index costs little.
--
-- Recreated from the latest definition (20260917000004): same
-- signature, return table, security and search_path. Grants re-stated.
-- ════════════════════════════════════════════════════════════════════

create index if not exists connection_events_event_created_idx
  on public.connection_events (event, created_at);

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
  -- A union of the candidate key sets, then three LEFT JOINs. A chain of
  -- FULL JOINs would work too, but the join key becomes a coalesce of
  -- the keys already joined and is wrong the moment a fourth source is
  -- added — this shape does not have that failure mode.
  -- Only these members can pass the final WHERE (see the header).
  members as (
    select k_member from signals
    union
    select k_member from declined_against where k_declined >= 4
  ),
  sends as (
    select e.actor_id as k_member, count(*) as k_sent
      from public.connection_events e, window_start w
     where e.event = 'requested'
       and e.actor_id in (select mb.k_member from members mb)
       and e.created_at > w.at
     group by e.actor_id
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

revoke execute on function public.admin_list_flagged_senders(int) from public, anon, authenticated;
grant  execute on function public.admin_list_flagged_senders(int) to authenticated;
