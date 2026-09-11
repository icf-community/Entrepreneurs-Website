-- ════════════════════════════════════════════════════════════════════
-- Foundry · Self-heal a GitHub connection stranded by the kill switch
--
-- Found while reviewing 20260911000003 (the ingestion kill switch):
-- confirm_github_connected still inserts the github_connections row
-- (scan_status='pending') even while the switch is off — only the
-- scan_github job insert is suppressed, by design (see that migration's
-- header). But nothing was watching for a 'pending' connection with no
-- job ever created for it, and ProfileForm.tsx's statusLabel treats
-- anything that isn't 'ready' or 'failed' as "Scanning your
-- repositories…" — so a member who connects while the switch is off
-- sees a permanently spinning, never-erroring status with no way to
-- recover short of disconnecting and reconnecting, which is not
-- signposted anywhere.
--
-- This is a materially worse UX than an explicit error would have been,
-- and it doesn't heal on its own once the switch is flipped back on —
-- confirm_github_connected only re-fires the insert on a fresh connect
-- attempt, not retroactively.
--
-- Fix: extend enqueue_github_rescans() (already hourly, already the
-- place 20260911000001 added transient-failure retry) to also pick up
-- connections stuck in 'pending' with no job at all. A legitimately
-- in-flight connection always has a matching pending/running job (the
-- insert is synchronous with confirm_github_connected's own insert), so
-- 'pending' + no job is never a normal state — it can only mean the job
-- was suppressed (this case) or lost some other way, and either way a
-- retry is correct. The 15-minute floor matches reap_stalled_jobs's own
-- stalled-state threshold, for the same reason: give a connection that
-- was inserted moments ago room to have its job show up before treating
-- it as stranded, even though the insert is synchronous today and
-- shouldn't need it.
--
-- Latest previous version: 20260911000001. Body repeated in full per
-- this codebase's recreate-from-latest convention — only the `due` CTE's
-- WHERE clause changes, adding the third OR branch below.
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
             -- enqueuing its scan.
             or (gc.scan_status = 'pending' and gc.connected_at < now() - interval '15 minutes')
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
