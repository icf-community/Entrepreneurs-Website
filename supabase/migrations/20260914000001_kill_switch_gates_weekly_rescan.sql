-- ════════════════════════════════════════════════════════════════════
-- Foundry · Kill switch now also pauses the weekly staleness rescan
--
-- REVERSAL of a deliberate call made in 20260911000003 and reaffirmed in
-- 20260913000001: those two migrations explicitly left the 'ready'/
-- 'failed' branches of enqueue_github_rescans() ungated, on the
-- reasoning that "pausing new member intake fast" and "pausing all
-- pipeline activity" were different tools — the weekly rescan was
-- treated as routine maintenance on an already-scanned connection, not
-- new ingestion work.
--
-- Explicit product decision (2026-09-14): while a member's *existing*
-- showcase/picks/skills must stay visible and untouched (unchanged —
-- see set_my_github_showcase, which still has no switch check and
-- still works on already-available_repos while the switch is off), the
-- switch should now suppress ALL new scan_github work, including the
-- routine weekly rescan of an already-connected member. If a real
-- incident needs the kill switch, "some members keep getting rescanned
-- anyway" is not an acceptable exception to that.
--
-- Implementation: the per-branch check added to the 'pending' branch in
-- 20260913000001 is replaced by one top-level check ahead of all three
-- OR branches, so all of them are now gated identically — simpler than
-- three separate checks, and there is no longer a branch this function
-- means to leave ungated.
--
-- Latest previous version: 20260913000001. Body repeated in full per
-- this codebase's recreate-from-latest convention.
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
  if not public.github_cv_ingestion_enabled() then
    return 0;
  end if;

  with due as (
    select gc.member_id
      from public.github_connections gc
     where (
             (gc.scan_status = 'ready' and gc.last_scanned_at < now() - interval '7 days')
             or (gc.scan_status = 'failed' and gc.scan_failure_transient)
             or (
                  gc.scan_status = 'pending'
                  and gc.connected_at < now() - interval '15 minutes'
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
