-- ════════════════════════════════════════════════════════════════════
-- Foundry · Don't enqueue a second job when one is already waiting
--
-- Found by the pre-launch production audit, 2026-09-08.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHAT WAS WRONG
-- ──────────────────────────────────────────────────────────────────────
-- Two RPCs pushed a row onto `jobs` unconditionally:
--
--   set_my_github_showcase   → 'refresh_github_summary'  (20260907000004:193)
--   confirm_github_connected → 'scan_github'             (20260907000004:349)
--
-- Both are member-triggered, and neither had any guard. Every call was a
-- new job; every job is real money and real queue time:
--
--   * refresh_github_summary = one LLM completion + one embedding. A
--     member holding down Save — or, far more likely, a client that
--     retries a failed request — spends that per click, unbounded.
--   * scan_github is worse. The worker processes ONE job at a time
--     (worker.py's module docstring: a concurrency cap of one is
--     deliberate, so a pathological CV cannot stall a request path). A
--     member who re-runs the OAuth round trip repeatedly therefore does
--     not just burn their own quota, they push every other member's CV
--     ingest behind their own backlog. That is a denial of service on
--     the whole ingest pipeline from an ordinary approved account.
--
-- This was an oversight rather than a decision: `enqueue_github_rescans`
-- (20260907000003:50) already guards its own insert with exactly the
-- `not exists` pattern restored below. The two hand-written enqueues
-- simply never got it.
--
-- ──────────────────────────────────────────────────────────────────────
-- THE FIX, AND WHY IT DEDUPES ON 'pending' ONLY
-- ──────────────────────────────────────────────────────────────────────
-- Skip the insert when this member already has a job of the same kind
-- sitting in 'pending'. A pending job has not been claimed yet, so when
-- it eventually runs it reads current state and does the work the second
-- call wanted anyway — collapsing the two is not just safe, it is
-- exactly right.
--
-- A 'running' job is deliberately NOT counted, which is a narrower guard
-- than enqueue_github_rescans uses ('pending' OR 'running'), and the
-- difference is intentional. That function schedules a periodic refresh
-- where being a few hours late costs nothing. These two are reacting to
-- something a member just did. If a refresh is already mid-flight it has
-- ALREADY read the old picks, so suppressing the follow-up would silently
-- lose the member's edit — a classic lost update, and the member would be
-- looking at a summary citing repos they just deselected with no way to
-- force a rebuild. Enqueue-on-running is the correct call for both.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHY NOT A UNIQUE INDEX
-- ──────────────────────────────────────────────────────────────────────
-- A partial unique index on (kind, payload->>'member_id') where status =
-- 'pending' looks like the airtight version of this, and it was written
-- and then rejected: it breaks retries. `_fail_job` moves a failed job
-- from 'running' back to 'pending', and the reaper (reap_stalled_jobs)
-- does the same for a stranded one. Either transition would hit the index
-- against a job enqueued while the first was running, raise a unique
-- violation inside the worker's failure handler, and strand the very row
-- the retry existed to rescue. Trading a bounded, harmless duplicate for
-- a broken retry path is a bad trade.
--
-- What survives is a small race: two genuinely concurrent calls can both
-- see no pending row and both insert. That is bounded at the number of
-- concurrent requests — it is the double-click and the retry storm that
-- matter, and those are serial, so the guard catches them. Deliberate
-- abuse is the rate limiter's job, added alongside this in
-- frontend/src/lib/ratelimit.ts; a database guard and a request-rate
-- guard defend different things and neither replaces the other.
--
-- ──────────────────────────────────────────────────────────────────────
-- AND A REGRESSION FOUND WHILE TESTING THE ABOVE (the worst of the four)
-- ──────────────────────────────────────────────────────────────────────
-- `confirm_github_connected` had lost its pgcrypto schema qualification.
--
-- 20260907000001 wrote `pgp_sym_encrypt(...)` unqualified. That cannot
-- resolve: pgcrypto is installed in `extensions` on Supabase, and this
-- function pins `search_path = public` per the SECURITY DEFINER
-- convention. 20260907000002 was written for no other purpose than to
-- fix it, deliberately by schema-qualifying the call rather than
-- widening the pin, so the injection-hardening property survived.
--
-- 20260907000004 then recreated the whole function to add the
-- profiles.github_url backfill — starting from the 20260907000001 body,
-- not the 20260907000002 one — and silently put the unqualified call
-- back. Nothing failed at apply time, because the body of a plpgsql
-- function is not resolved until it runs.
--
-- The effect: **GitHub connect fails for every member, every time**, with
-- "function pgp_sym_encrypt(text, text) does not exist", on any database
-- where pgcrypto is in `extensions` — which is Supabase's default and so
-- is production. It survived undetected because the local database
-- happens to resolve it and because no automated test calls this RPC; it
-- surfaced only when a hand-written functional test for the dedupe guard
-- below invoked it for real.
--
-- This is [[recreate-function-from-latest]] biting for the second time in
-- the same file, and it is worth stating the sharper version of the rule:
-- "copy the latest definition" is not "copy the definition from the
-- migration that most recently *rewrote* the function" — it is "copy the
-- one that most recently *changed the line you are about to keep*". The
-- fix here is a one-line hotfix file; a rewrite chose the wrong ancestor.
--
-- Both functions are recreated whole from their latest definitions in
-- 20260907000004, signatures byte-identical
-- ([[recreate-function-from-latest]] — a changed argument list leaves the
-- old body behind as a live overload and PostgREST goes on resolving to
-- it, so the bug would still be in production while this file claimed to
-- have fixed it). The ONLY change in each is the final insert.
-- ════════════════════════════════════════════════════════════════════

-- ─── 0. A hard, server-side ceiling on LLM spend per member ──────────
--
-- The `not exists` guards below collapse duplicate work, and the Upstash
-- buckets in frontend/src/lib/ratelimit.ts throttle request rate. Neither
-- is a spend cap, and neither is trustworthy as one:
--
--   * The dedupe only merges jobs that are still pending. Save, wait for
--     the worker to claim it, save again — every cycle is a fresh LLM
--     call, and the guard is working as designed the whole time.
--   * The rate limiter lives in the app, keyed on Upstash, and is env-
--     gated: `rateLimitEnabled` is false whenever UPSTASH_REDIS_REST_* is
--     unset. An unconfigured or misconfigured deploy therefore has NO
--     limit at all, silently, and the first symptom is the OpenAI bill.
--     It also cannot see anything that reaches the RPC by another route.
--
-- So the real ceiling belongs here, next to the table the jobs land in,
-- where it applies to every caller regardless of client, env, or
-- transport. Postgres is the last line and the only one that cannot be
-- skipped.
--
-- 30 per rolling 24 hours, counted across both LLM-bearing GitHub kinds
-- together. Calibration: a member re-picking their showcase attentively
-- might save five or six times in a sitting and reconnect once; 30 is
-- several times that, so no real person meets it, while a runaway client
-- or a deliberate script stops at 30 calls a day instead of thousands.
-- Per member and rolling, not global and daily, so one bad actor cannot
-- exhaust a shared allowance and lock every other member out — the
-- failure mode that makes global budgets worse than none.
--
-- Deliberately NOT applied to `ingest_cv` (enqueued by 20260906000001)
-- or to the rescan cron's own inserts: CV uploads are already capped by
-- the cvUpload bucket AND by issue_upload_ticket's outstanding-ticket
-- limit, and the cron is system-initiated at roughly one job per member
-- per week. Charging system-scheduled work against a member's personal
-- budget would let a quiet week of cron activity refuse a member's own
-- next edit, which is backwards.
--
-- NOTE for Phase 2: the conversational agent is a per-TURN cost with a
-- member-supplied prompt, which is a different and much sharper exposure
-- than this. It needs its own budget — tokens, not job rows — and must
-- not be bolted onto this function.

-- Returns false once the member is at their ceiling. A PREDICATE, not an
-- assertion, and that choice is load-bearing: raising here would abort
-- the surrounding transaction, and both callers do real work before they
-- enqueue — set_my_github_showcase has already stored the member's picks,
-- confirm_github_connected has already stored the connection. Throwing at
-- the enqueue would roll those back too, so a member who hit a *spend*
-- limit would silently lose the choice they just made, or find GitHub
-- refusing to connect at all. Losing the work is a far worse outcome than
-- deferring the summary that describes it, so the budget suppresses the
-- job and leaves everything else committed.
--
-- The member-facing message therefore comes from the app-layer bucket
-- (githubShowcase, 10/hour), which trips long before this does. By the
-- time anyone reaches 30 in a day they are not a member reading error
-- messages, they are a script.
create or replace function public.llm_job_budget_available(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) < 30
    from public.jobs
   where kind in ('scan_github', 'refresh_github_summary')
     and (payload->>'member_id')::uuid = p_member
     and created_at > now() - interval '24 hours';
$$;

-- Internal only: both callers are SECURITY DEFINER functions in this
-- file. Exposing it would hand out a cheap way to probe another member's
-- activity level ([[function-grant-default-privileges]] — REVOKE FROM
-- public is not enough on Supabase, the roles must be named).
revoke execute on function public.llm_job_budget_available(uuid) from public, anon, authenticated;

-- The budget query filters on kind + member + created_at, none of which
-- the only existing index (jobs_poll_idx on status, next_attempt_at) can
-- serve — so without this it is a sequential scan of the whole table on
-- every save. `jobs` has no purge (nothing deletes completed rows), so
-- that table only ever grows: at 2,000 members on a weekly re-scan it
-- passes 100k rows inside a year, and the check meant to protect spend
-- would itself become the slowest thing in the request.
create index if not exists jobs_member_kind_created_idx
  on public.jobs (kind, ((payload->>'member_id')), created_at desc);

-- ─── set_my_github_showcase ──────────────────────────────────────────

create or replace function public.set_my_github_showcase(p_picks jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller    uuid := auth.uid();
  v_available jsonb;
  v_result    jsonb := '[]'::jsonb;
  v_pick      jsonb;
  v_repo      jsonb;
  v_name      text;
  v_blurb     text;
  v_names     text[] := '{}';
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_picks is null or jsonb_typeof(p_picks) <> 'array' then
    raise exception 'Picks must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_picks) > 3 then
    raise exception 'You can spotlight at most 3 projects' using errcode = '22023';
  end if;

  select gc.available_repos into v_available
    from public.github_connections gc
   where gc.member_id = v_caller;

  -- No scan has completed, so there is nothing legitimate to pick from.
  if v_available is null then
    raise exception 'No GitHub scan available yet' using errcode = '42501';
  end if;

  for v_pick in select value from jsonb_array_elements(p_picks) loop
    v_name := nullif(trim(coalesce(v_pick->>'name', '')), '');
    if v_name is null then
      raise exception 'Each pick needs a repository name' using errcode = '22023';
    end if;
    if v_name = any(v_names) then
      raise exception 'Duplicate repository: %', v_name using errcode = '22023';
    end if;
    v_names := v_names || v_name;

    select elem into v_repo
      from jsonb_array_elements(v_available) as elem
     where elem->>'name' = v_name
     limit 1;

    if v_repo is null then
      raise exception 'Unknown repository: %', v_name using errcode = '22023';
    end if;

    -- The client caps blurbs at 140 too, but that cap is UX. This one is
    -- the enforcement.
    v_blurb := nullif(trim(coalesce(v_pick->>'blurb', '')), '');
    if v_blurb is not null then
      v_blurb := left(v_blurb, 140);
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'name',             v_repo->>'name',
      'description',      v_repo->'description',
      'language',         v_repo->'language',
      'stargazers_count', coalesce(v_repo->'stargazers_count', to_jsonb(0)),
      'url',              v_repo->'url',
      'blurb',            v_blurb
    ));
  end loop;

  update public.github_connections
     set showcase_repos       = v_result,
         showcase_selected_at = now(),
         -- Reviewing the list is what marks everything currently visible
         -- as seen, whether or not it was picked.
         showcase_seen_repos  = (
           select coalesce(array_agg(elem->>'name'), '{}'::text[])
             from jsonb_array_elements(v_available) as elem
         )
   where member_id = v_caller;

  -- The summary cites the repos a recruiter will actually see, so a
  -- change of picks means the summary is now stale. Cheaper than a full
  -- re-scan: one LLM call plus one embedding.
  --
  -- CHANGED (20260908000002): only when one is not already waiting. See
  -- this file's header — an unguarded insert here billed an LLM call per
  -- button press. 'pending' only, so a save made while an earlier refresh
  -- is mid-flight still queues and the member's newest picks win.
  --
  -- The picks are already stored above, unconditionally. Only the summary
  -- rebuild is gated: a member at their daily ceiling keeps their choice
  -- and simply waits for the prose describing it.
  insert into public.jobs (kind, payload)
  select 'refresh_github_summary', jsonb_build_object('member_id', v_caller)
   where public.llm_job_budget_available(v_caller)
     and not exists (
       select 1 from public.jobs j
        where j.kind = 'refresh_github_summary'
          and j.status = 'pending'
          and (j.payload->>'member_id')::uuid = v_caller
     );
end;
$$;

revoke execute on function public.set_my_github_showcase(jsonb) from public, anon;
grant  execute on function public.set_my_github_showcase(jsonb) to authenticated;

-- ─── confirm_github_connected ────────────────────────────────────────

create or replace function public.confirm_github_connected(
  p_github_user_id  bigint,
  p_github_username text,
  p_access_token    text,
  p_encryption_key  text
)
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

  insert into public.github_connections (
    member_id, github_user_id, github_username, access_token_encrypted,
    scan_status, scan_failure_reason, connected_at
  )
  values (
    v_caller, p_github_user_id, p_github_username,
    -- SCHEMA-QUALIFIED, and it must stay that way. pgcrypto lives in
    -- `extensions` on Supabase, not `public`, so the unqualified call
    -- cannot resolve under this function's pinned `search_path = public`
    -- and fails with "function pgp_sym_encrypt(text, text) does not
    -- exist" — meaning GitHub connect fails for every member, always.
    -- 20260907000002 exists solely to fix that; 20260907000004 then
    -- recreated this function from the pre-fix body and reintroduced it.
    -- See this file's header.
    extensions.pgp_sym_encrypt(p_access_token, p_encryption_key),
    'pending', null, now()
  )
  on conflict (member_id) do update
    set github_user_id         = excluded.github_user_id,
        github_username        = excluded.github_username,
        access_token_encrypted = excluded.access_token_encrypted,
        scan_status            = 'pending',
        scan_failure_reason    = null,
        connected_at           = now();

  update public.profiles
     set github_url = 'https://github.com/' || p_github_username
   where id = v_caller
     and github_url is null;

  -- CHANGED (20260908000002): guarded. The worker is single-lane, so an
  -- unguarded insert here let one member's repeated reconnects queue
  -- ahead of everyone else's CV ingest. 'pending' only: reconnecting
  -- with a DIFFERENT GitHub account while a scan is already running must
  -- still queue a scan of the new account.
  -- Budget-gated the same way, and for the same reason: the connection
  -- row above is already stored, so a member at their ceiling stays
  -- connected and just does not get another scan today. The weekly
  -- re-scan cron inserts directly and is not gated, so their signal still
  -- refreshes on schedule regardless.
  insert into public.jobs (kind, payload)
  select 'scan_github', jsonb_build_object('member_id', v_caller)
   where public.llm_job_budget_available(v_caller)
     and not exists (
       select 1 from public.jobs j
        where j.kind = 'scan_github'
          and j.status = 'pending'
          and (j.payload->>'member_id')::uuid = v_caller
     );
end;
$$;

revoke execute on function public.confirm_github_connected(bigint, text, text, text) from public, anon;
grant  execute on function public.confirm_github_connected(bigint, text, text, text) to authenticated;
