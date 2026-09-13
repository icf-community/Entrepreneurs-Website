-- ════════════════════════════════════════════════════════════════════
-- Foundry · CV-matchmaker summary lifecycle — three stale-state fixes
--
-- Audited 2026-09-11 while testing the combined CV+GitHub summary
-- against a real profile. All three are the same shape: an action a
-- member takes (remove CV, disconnect GitHub, hit a transient GitHub
-- failure) correctly updates the OLD state it's responsible for, but
-- the cv-matchmaker pipeline (20260906000001/20260907000001) is a
-- separate set of tables/rows nothing was cleaning up or nudging
-- afterwards — so a recruiter-facing summary could keep describing a
-- CV or GitHub connection the member explicitly removed, or a GitHub
-- connection could sit "failed" forever after a transient hiccup that
-- nothing would ever retry.
-- ════════════════════════════════════════════════════════════════════

-- ─── remove_my_cv: also retire the cv-matchmaker rows ─────────────────
-- Latest previous version: 20260901000012. That version only ever
-- touched profiles.cv_path and friends (the older, pre-matchmaker
-- columns) — get_my_cv_profile()/get_my_cv_status() (20260906000001)
-- key off cvs.is_current, never off profiles.cv_path, so a member who
-- removed their CV kept a fully-served, is_current=true recruiter
-- summary indefinitely. Flip currency off rather than deleting the
-- rows — cvs is documented elsewhere (update_cv_currency's own
-- comment) as an append-only ingest log, and there's no reason to
-- break that invariant here.
create or replace function public.remove_my_cv()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform set_config('foundry.media_write', 'true', true);
  update public.profiles
     set cv_path                 = null,
         cv_uploaded_at          = null,
         cv_original_filename    = null,
         cv_parse_consent        = false,
         cv_parse_consent_at     = null,
         cv_suggested_skill_ids  = null
   where id = v_caller;
  perform set_config('foundry.media_write', 'false', true);

  update public.cvs set is_current = false where member_id = v_caller and is_current;
  update public.cv_profiles cp
     set is_current = false
    from public.cvs c
   where c.id = cp.cv_id and c.member_id = v_caller and cp.is_current;
  update public.cv_chunks set is_current = false where member_id = v_caller and is_current;
  delete from public.member_skills where member_id = v_caller and source = 'cv';
end;
$$;

revoke execute on function public.remove_my_cv() from public, anon;
grant  execute on function public.remove_my_cv() to authenticated;

-- ─── disconnect_github: revert a combined summary back to CV-only ─────
-- Latest previous version: 20260907000001. That version's own comment
-- documented the gap as an accepted limitation ("left as-is until the
-- next CV re-upload naturally regenerates a CV-only summary") — but
-- that claim doesn't hold: process_ingest_cv's hash-match short circuit
-- (_reactivate_hash_match, server/app/worker.py) reactivates an
-- existing ready row's summary completely unchanged rather than
-- regenerating it, so a byte-identical re-upload (the common case —
-- someone re-confirming, not editing) would never actually fix it.
--
-- Enqueues the same 'refresh_github_summary' job kind
-- set_my_github_showcase already uses. server/app/worker.py's
-- process_refresh_github_summary now falls back to the original
-- CV-only text (still sitting untouched in cv_profiles.profile, never
-- overwritten by the combined-summary path) when it finds no active
-- connection row, and is a no-op if there was nothing to revert — see
-- that function and the new _revert_to_cv_only_summary helper.
create or replace function public.disconnect_github()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from public.member_skills where member_id = v_caller and source = 'github';
  delete from public.github_connections where member_id = v_caller;

  insert into public.jobs (kind, payload)
  values ('refresh_github_summary', jsonb_build_object('member_id', v_caller));
end;
$$;

revoke execute on function public.disconnect_github() from public, anon;
grant  execute on function public.disconnect_github() to authenticated;

-- ─── scan_failure_transient + enqueue_github_rescans retry ────────────
-- GithubScanError has always covered several distinct causes (revoked
-- token, GitHub's primary/hourly rate limit, an oversized account) but
-- the worker treated all of them identically — 'failed', no retry path
-- anywhere. That's correct for a revoked token (the member has to
-- reconnect) but wrong for the primary rate limit: its hourly reset
-- window is far longer than the job queue's own backoff could ever
-- wait out (which is exactly why server/app/github_pipeline.py's
-- GithubScanError docstring already called job-level retry out as the
-- wrong tool for it) — but nothing else was retrying it either, since
-- this cron has always excluded every 'failed' row on the assumption
-- that 'failed' only ever meant a dead token.
--
-- server/app/worker.py now records which failures are rescan-retryable
-- on github_connections.scan_failure_transient (true only for the
-- primary-rate-limit case — see GithubScanError.retryable_by_rescan).
-- This cron, which already runs hourly (20260907000004), is the
-- correctly-timescaled place to pick those back up. A dead token or an
-- oversized account (scan_failure_transient left false) still requires
-- the member to reconnect — unchanged from every previous version's
-- reasoning.
alter table public.github_connections
  add column if not exists scan_failure_transient boolean not null default false;

-- Latest previous version: 20260907000004 (function body unchanged
-- from 20260907000003; only that migration's schedule changed). Body
-- repeated in full per this codebase's recreate-from-latest convention
-- — only the WHERE clause's due-connections CTE changes below.
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
-- No re-schedule needed: the existing 'enqueue-github-rescans-hourly'
-- cron.job row (20260907000004) already just calls
-- "select public.enqueue_github_rescans();" by name — the function body
-- above is picked up on its very next run with no schedule change.
