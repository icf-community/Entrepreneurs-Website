-- ════════════════════════════════════════════════════════════════════
-- Foundry · Kill switch also gates its own stranded-connection backfill
--
-- Found by adversarial audit (2026-09-13): 20260911000004 added a third
-- OR branch to enqueue_github_rescans() that re-enqueues any
-- github_connections row stuck at scan_status='pending' for >15 minutes
-- — exactly the state confirm_github_connected leaves a connection in
-- while github_cv_ingestion_enabled() is false (20260911000003). But
-- that branch never checked the switch's current value, so within
-- 15-75 minutes the hourly cron re-enqueues the scan_github job anyway,
-- completely bypassing the switch for any member who connected while it
-- was off. The switch's whole stated purpose — a fast way to stop new
-- ingestion work — was defeated for exactly the connections it was
-- supposed to be pausing.
--
-- Fix: only the 'pending'-stranded branch gets the extra check. The
-- 'ready'/'failed' branches stay ungated on purpose, unchanged from
-- 20260911000004 — those are pre-existing, already-scanned connections
-- doing routine staleness/transient-failure rescans, not new intake,
-- and 20260911000003's header is explicit that the weekly rescan cron
-- is deliberately not what this switch controls. The 'pending' branch
-- is different: it exists only because the switch suppressed a job, so
-- it's the one case where healing it should wait for the switch itself
-- to come back on. While the switch stays off, the connection now just
-- stays 'pending' with no job — which is the switch actually working,
-- not a stuck state — and the very next hourly tick after it's flipped
-- back on heals it, same as before.
--
-- Latest previous version: 20260911000004. Body repeated in full per
-- this codebase's recreate-from-latest convention — only the third OR
-- branch changes.
-- ════════════════════════════════════════════════════════════════════

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
     where (
             (gc.scan_status = 'ready' and gc.last_scanned_at < now() - interval '7 days')
             or (gc.scan_status = 'failed' and gc.scan_failure_transient)
             -- Stranded by the ingestion kill switch (20260911000003) or
             -- any other path that recorded a connection without ever
             -- enqueuing its scan. CHANGED (20260913000001): only heal
             -- this once the switch is back on — otherwise this branch
             -- re-creates the exact job the switch is meant to suppress.
             or (
                  gc.scan_status = 'pending'
                  and gc.connected_at < now() - interval '15 minutes'
                  and public.github_cv_ingestion_enabled()
                )
           )
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
-- No re-schedule needed — see 20260911000001's identical note: the
-- existing 'enqueue-github-rescans-hourly' cron.job row calls this
-- function by name, so the new body is picked up on its next run.
