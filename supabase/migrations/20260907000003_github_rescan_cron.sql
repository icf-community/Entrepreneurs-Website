-- ════════════════════════════════════════════════════════════════════
-- Foundry · GitHub signal — periodic re-scan
--
-- 20260907000001 only ever scans a member's GitHub account once, at
-- connect time. This adds a weekly re-scan so github_signal (and the
-- combined CV+GitHub summary it feeds, via worker.py's
-- _refresh_combined_summary) stays current as members ship new work —
-- no code change needed in the worker, since it already knows how to
-- process a 'scan_github' job; this just periodically enqueues one for
-- each connection that's due.
--
-- Weekly, not daily: a member's public repos don't meaningfully change
-- day to day, and each scan costs a handful of GitHub API calls plus
-- 2-3 LLM calls (exclusion classification, depth judgment, summary
-- regeneration) — no reason to spend that more often than the signal
-- can actually change. Tune by editing the interval literal below and
-- re-applying (same "recreate from latest" convention as every other
-- function in this codebase).
--
-- Only scan_status = 'ready' connections are eligible — 'failed' means
-- the token is dead (revoked, or GitHub's opt-in 8h token-expiration
-- setting, which should be OFF for this OAuth App) and no amount of
-- retrying fixes that; the member has to reconnect. 'pending'/'scanning'
-- means a scan is already in flight.
-- ════════════════════════════════════════════════════════════════════

-- ─── enqueue_github_rescans ─────────────────────────────────────────
-- Bounded batch (50), same safety-valve reasoning as the other purge
-- functions in 20260829000003: at today's member count this limit never
-- engages, but it stops a long-paused cron from dumping an enormous
-- backlog into the jobs table in one shot. Oldest-scanned-first, so a
-- backlog drains fairly rather than favouring whoever connected last.
-- Skips a connection that already has a pending/running scan_github job
-- so re-running this before the last batch has drained doesn't
-- double-enqueue.
create or replace function public.enqueue_github_rescans()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with due as (
    select gc.member_id
      from public.github_connections gc
     where gc.scan_status = 'ready'
       and gc.last_scanned_at < now() - interval '7 days'
       and not exists (
         select 1 from public.jobs j
          where j.kind = 'scan_github'
            and j.status in ('pending', 'running')
            and (j.payload->>'member_id')::uuid = gc.member_id
       )
     order by gc.last_scanned_at
     limit 50
  ),
  queued as (
    insert into public.jobs (kind, payload)
    select 'scan_github', jsonb_build_object('member_id', member_id)
      from due
    returning 1
  )
  select count(*) into v_count from queued;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_github_rescans() from public, anon, authenticated;

-- ─── Schedule ────────────────────────────────────────────────────────
-- Idempotent unschedule-then-schedule, same convention as
-- 20260829000003, so re-applying this migration doesn't pile up
-- duplicate cron rows. 03:00, clear of the other daily crons (02:00s
-- listing expiries, 02:30 purge_rejected_listings, 02:35 moderation
-- purge).
do $$
begin
  begin
    perform cron.unschedule('enqueue-github-rescans-daily');
  exception when others then
    null;  -- no-op if the job doesn't exist yet
  end;
end;
$$;

select cron.schedule(
  'enqueue-github-rescans-daily',
  '0 3 * * *',
  $$select public.enqueue_github_rescans();$$
);
