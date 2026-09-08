-- ════════════════════════════════════════════════════════════════════
-- Foundry · GitHub signal — member-chosen showcase repos
--
-- 20260907000001 let an LLM pick up to 5 "most impressive" repos into
-- github_signal.top_repos. That was the wrong actor for the job: the LLM
-- is reliable at a TECHNICAL judgment ("does this repo contain real
-- engineering?") but the question that actually matters is a TASTE one
-- ("which of my projects best represents me?"), and nothing in a README
-- encodes that a member is proud of one project and embarrassed by
-- another. Six rounds of prompt tuning produced six defensible answers
-- the member still disagreed with.
--
-- So the pipeline splits by owner:
--   * The DERIVED signal (languages, skills, themes, summary prose) stays
--     fully automatic and keeps refreshing on the weekly re-scan cron.
--   * The SHOWCASE repos become member-owned and sticky — up to 3, each
--     with an optional one-line blurb the member writes. Once picked, no
--     scan ever overwrites them (see worker.py's process_scan_github).
--     The LLM's selection is demoted from authority to suggestion.
--
-- The security control worth reading twice is in set_my_github_showcase:
-- the client sends repo NAMES and BLURBS only, never objects. Every
-- stored field is looked up server-side out of available_repos, which
-- only the worker writes. Accepting a client-supplied object here would
-- let anyone put an arbitrary URL into a recruiter-facing link list.
--
-- Also in this migration, because they are the same worker's problems:
--   * reap_stalled_jobs — nothing has ever moved a row out of 'running',
--     so any worker death stranded that job forever.
--   * enqueue_github_rescans re-scheduled hourly — at 50 rows/day the
--     "weekly" re-scan was really ~20-daily at 1000 connections.
-- ════════════════════════════════════════════════════════════════════

-- ─── Showcase columns ────────────────────────────────────────────────
alter table public.github_connections
  -- Every public non-fork repo, metadata only (no README excerpts — that
  -- is the large field and it belongs nowhere near a column read on every
  -- picker render). Written by the worker; the picker renders straight
  -- out of this, so opening the dialog costs no live GitHub call.
  add column available_repos         jsonb,
  -- null = the member has never picked. Distinct from '[]'::jsonb, which
  -- means "picked deliberately, chose none" — the two get different UI.
  add column showcase_repos          jsonb,
  add column showcase_selected_at    timestamptz,
  -- Repo names present the last time the member reviewed their picks.
  -- Deliberately a NAME SET rather than a timestamp: a timestamp compared
  -- against GitHub's created_at would miss an old repo that was private
  -- and has just been made public, which is exactly the case worth
  -- nudging about. The set diff catches it.
  add column showcase_seen_repos     text[],
  add column showcase_nudged_at      timestamptz,
  add column showcase_nudges_enabled boolean not null default true,
  -- Sorted repo-name set + newest pushed_at, hashed. When a re-scan finds
  -- this unchanged it stops before the README fetches and both LLM calls
  -- (github_pipeline.fetch_github_signal) — a no-change scan then costs
  -- only the 1-3 repo-listing calls. This is what makes an hourly
  -- re-scan cadence nearly free, and it is the one saving in the whole
  -- scalability audit that moving to Azure does NOT hand you: the OpenAI
  -- bill is identical on either platform.
  --
  -- It is a NAME set, not just a timestamp, so a deleted or renamed repo
  -- also busts it — which is exactly when showcase_repos needs pruning.
  add column scan_fingerprint        text;

alter table public.github_connections
  add constraint github_connections_showcase_repos_len
  check (showcase_repos is null or jsonb_array_length(showcase_repos) <= 3);

-- ─── get_my_github_showcase ──────────────────────────────────────────
-- Backs the picker. Its own RPC rather than folded into
-- get_my_github_status(), which the processing dialog polls every 2s and
-- must stay small — available_repos can be 300 rows.
create or replace function public.get_my_github_showcase()
returns table (
  available_repos jsonb,
  showcase_repos  jsonb,
  suggested_repos jsonb,
  seen_repos      text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(gc.available_repos, '[]'::jsonb),
    gc.showcase_repos,
    coalesce(gc.github_signal->'top_repos', '[]'::jsonb),
    coalesce(gc.showcase_seen_repos, '{}'::text[])
  from public.github_connections gc
 where gc.member_id = auth.uid();
$$;

revoke execute on function public.get_my_github_showcase() from public, anon;
grant  execute on function public.get_my_github_showcase() to authenticated;

-- ─── set_my_github_showcase ──────────────────────────────────────────
-- p_picks is [{"name": "...", "blurb": "..."}], at most 3, IN THE
-- MEMBER'S CHOSEN ORDER — that order is what renders, so it is preserved
-- rather than sorted.
--
-- Every stored field except the blurb is copied from available_repos by
-- name lookup. An unknown name raises rather than being skipped: silently
-- dropping a pick would leave the member looking at a showcase they
-- didn't choose with no explanation.
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
  insert into public.jobs (kind, payload)
  values ('refresh_github_summary', jsonb_build_object('member_id', v_caller));
end;
$$;

revoke execute on function public.set_my_github_showcase(jsonb) from public, anon;
grant  execute on function public.set_my_github_showcase(jsonb) to authenticated;

-- ─── dismiss_my_github_showcase_prompt ───────────────────────────────
-- "Not now." Marks everything currently visible as seen WITHOUT touching
-- picks, so the banner returns only when something genuinely newer shows
-- up rather than on the next page load.
create or replace function public.dismiss_my_github_showcase_prompt()
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

  update public.github_connections gc
     set showcase_seen_repos = (
       select coalesce(array_agg(elem->>'name'), '{}'::text[])
         from jsonb_array_elements(coalesce(gc.available_repos, '[]'::jsonb)) as elem
     )
   where gc.member_id = v_caller;
end;
$$;

revoke execute on function public.dismiss_my_github_showcase_prompt() from public, anon;
grant  execute on function public.dismiss_my_github_showcase_prompt() to authenticated;

-- ─── set_my_github_nudges ────────────────────────────────────────────
create or replace function public.set_my_github_nudges(p_enabled boolean)
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

  update public.github_connections
     set showcase_nudges_enabled = coalesce(p_enabled, true)
   where member_id = v_caller;
end;
$$;

revoke execute on function public.set_my_github_nudges(boolean) from public, anon;
grant  execute on function public.set_my_github_nudges(boolean) to authenticated;

-- ─── get_my_github_status (recreated) ────────────────────────────────
-- Same argument signature as 20260907000001's, so this replaces that
-- function rather than creating a second overload — but `returns table`
-- means adding columns changes the return type, which CREATE OR REPLACE
-- cannot do, hence the explicit DROP. All callers use .maybeSingle(), so
-- the extra columns are additive.
drop function if exists public.get_my_github_status();

create function public.get_my_github_status()
returns table (
  github_username       text,
  scan_status           text,
  scan_failure_reason   text,
  has_signal            boolean,
  has_showcase          boolean,
  needs_showcase_review boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gc.github_username,
    gc.scan_status,
    gc.scan_failure_reason,
    (gc.github_signal is not null),
    (gc.showcase_repos is not null and jsonb_array_length(gc.showcase_repos) > 0),
    -- True when the scan is done and at least one currently-visible repo
    -- has never been put in front of this member.
    (
      gc.scan_status = 'ready'
      and exists (
        select 1
          from jsonb_array_elements(coalesce(gc.available_repos, '[]'::jsonb)) as elem
         where not (elem->>'name' = any(coalesce(gc.showcase_seen_repos, '{}'::text[])))
      )
    )
  from public.github_connections gc
 where gc.member_id = auth.uid();
$$;

revoke execute on function public.get_my_github_status() from public, anon;
grant  execute on function public.get_my_github_status() to authenticated;

-- ─── confirm_github_connected (recreated) ────────────────────────────
-- Unchanged except for the profiles.github_url backfill at the end.
-- /onboarding's LinksStep already collects an optional GitHub URL before
-- verification, so for most members the handle is already on file and the
-- intake screen can name it. When it is NOT on file, connecting is the
-- moment we learn it — so fill it in, formatted to satisfy the existing
-- profiles_github_url_format CHECK (20260528000010).
--
-- Only when it is currently null. A member who typed a different handle
-- gets an explicit offer to update it in the UI; silently overwriting a
-- value someone entered by hand is not ours to do.
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
    pgp_sym_encrypt(p_access_token, p_encryption_key),
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

  insert into public.jobs (kind, payload)
  values ('scan_github', jsonb_build_object('member_id', v_caller));
end;
$$;

revoke execute on function public.confirm_github_connected(bigint, text, text, text) from public, anon;
grant  execute on function public.confirm_github_connected(bigint, text, text, text) to authenticated;

-- ─── Nudge queries (service-role only) ───────────────────────────────
-- Backs api/cron/github-showcase-nudge. Same email+name lookup shape as
-- admin_get_signup_emails (20260528000018), but admin-gated by grant
-- rather than by is_admin(), since the caller is the cron route holding
-- the service key, not a person.
--
-- Event-driven, never a fixed timer: a member only hears from us when a
-- scan has actually turned up a repo they have never been shown. The
-- 30-day floor is the real throttle; the weekly cron tick just bounds how
-- long a genuine change waits.
create or replace function public.due_github_showcase_nudges(p_limit int default 50)
returns table (member_id uuid, email text, first_name text, new_repos text[])
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    gc.member_id,
    au.email::text,
    p.first_name,
    (
      select array_agg(elem->>'name')
        from jsonb_array_elements(gc.available_repos) as elem
       where not (elem->>'name' = any(coalesce(gc.showcase_seen_repos, '{}'::text[])))
    )
  from public.github_connections gc
  join public.profiles p on p.id = gc.member_id
  join auth.users     au on au.id = gc.member_id
 where gc.scan_status = 'ready'
   and gc.showcase_nudges_enabled
   and gc.available_repos is not null
   -- Only members who can actually act on it.
   and p.status = 'approved'
   and au.email is not null
   and (gc.showcase_nudged_at is null or gc.showcase_nudged_at < now() - interval '30 days')
   and exists (
     select 1
       from jsonb_array_elements(gc.available_repos) as elem
      where not (elem->>'name' = any(coalesce(gc.showcase_seen_repos, '{}'::text[])))
   )
 order by gc.last_scanned_at
 limit greatest(coalesce(p_limit, 50), 0);
$$;

revoke execute on function public.due_github_showcase_nudges(int) from public, anon, authenticated;

create or replace function public.mark_github_showcase_nudged(p_member_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.github_connections
     set showcase_nudged_at = now()
   where member_id = any(coalesce(p_member_ids, '{}'::uuid[]));
$$;

revoke execute on function public.mark_github_showcase_nudged(uuid[]) from public, anon, authenticated;

-- ─── reap_stalled_jobs ───────────────────────────────────────────────
-- _claim_job sets status = 'running', and until now NOTHING ever moved a
-- row back out of it — the worker's poll query only selects 'pending'. So
-- any worker death mid-job (SIGKILL, a dropped Postgres connection, or
-- simply a deploy) stranded that job forever, leaving the member's CV at
-- 'processing' or GitHub at 'scanning' with their dialog polling into the
-- void. Survivable while the worker was started by hand; not survivable
-- with several instances and rolling restarts.
--
-- attempts is INCREMENTED on requeue, deliberately: a job that kills the
-- worker every time it runs must eventually dead-letter rather than
-- crash-loop the whole fleet.
--
-- The 15-minute threshold must stay above the slowest legitimate job — a
-- 300-repo GitHub scan is the worst case. worker.py's SIGTERM handler
-- means an orderly deploy finishes its job and never reaches this; this
-- is the backstop for the disorderly ones.
create or replace function public.reap_stalled_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with stalled as (
    select id, attempts, max_attempts
      from public.jobs
     where status = 'running'
       and updated_at < now() - interval '15 minutes'
     for update skip locked
  ),
  reaped as (
    -- Explicit enum casts: jobs.status is public.job_status, and an
    -- unqualified CASE here yields text, which Postgres will not coerce
    -- implicitly on assignment.
    update public.jobs j
       set status     = case
                          when s.attempts + 1 >= s.max_attempts then 'dead'::public.job_status
                          else 'pending'::public.job_status
                        end,
           attempts   = s.attempts + 1,
           last_error = 'Reclaimed after worker stall (job left running with no heartbeat)',
           next_attempt_at = now()
      from stalled s
     where j.id = s.id
    returning 1
  )
  select count(*) into v_count from reaped;

  return v_count;
end;
$$;

revoke execute on function public.reap_stalled_jobs() from public, anon, authenticated;

do $$
begin
  begin
    perform cron.unschedule('reap-stalled-jobs');
  exception when others then
    null;
  end;
end;
$$;

select cron.schedule(
  'reap-stalled-jobs',
  '*/5 * * * *',
  $$select public.reap_stalled_jobs();$$
);

-- ─── enqueue_github_rescans: hourly, not daily ───────────────────────
-- 20260907000003 scheduled this at 03:00 with `limit 50` — 350 rows a
-- week, against a header that promises every connected member is
-- re-scanned weekly. At 1000 connections the real cadence was ~20 days;
-- at 2000 it would be ~40. Silent, and it broke that file's own promise.
--
-- The fix is cadence, not batch size: hourly × 50 = 1,200/day ≈ 8,400/week,
-- roughly 4× headroom at 2000 connections, while keeping the
-- per-invocation safety valve small so a long-paused cron still cannot
-- dump an enormous backlog into `jobs` in one shot. A single large daily
-- batch would do the opposite — ~300 jobs at 03:00 and an idle worker for
-- the other 23 hours.
--
-- The function body is unchanged from 20260907000003; only the schedule
-- moves. It is repeated here in full per this codebase's
-- recreate-from-latest convention.
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

do $$
begin
  begin
    perform cron.unschedule('enqueue-github-rescans-daily');
  exception when others then
    null;
  end;
  begin
    perform cron.unschedule('enqueue-github-rescans-hourly');
  exception when others then
    null;
  end;
end;
$$;

select cron.schedule(
  'enqueue-github-rescans-hourly',
  '7 * * * *',  -- :07, clear of the on-the-hour crowd
  $$select public.enqueue_github_rescans();$$
);

-- ─── Nudge cron driver ───────────────────────────────────────────────
-- Same shape as cron_drain_outbound_email (20260530000003): check there
-- is anything to do, read the URL and shared secret out of app_config,
-- and no-op with a warning if they haven't been seeded yet, so this
-- migration applies cleanly to a fresh database.
create or replace function public.cron_github_showcase_nudge()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_url    text;
  v_secret text;
  v_due    int;
begin
  select count(*) into v_due from public.due_github_showcase_nudges(1);
  if v_due = 0 then
    return;
  end if;

  select value into v_url    from public.app_config where key = 'github_showcase_nudge_url';
  select value into v_secret from public.app_config where key = 'cron_secret';

  if v_url is null or v_secret is null then
    raise warning 'cron_github_showcase_nudge: github_showcase_nudge_url or cron_secret not configured in app_config';
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

revoke execute on function public.cron_github_showcase_nudge() from public, anon, authenticated;

do $$
begin
  begin
    perform cron.unschedule('github-showcase-nudge');
  exception when others then
    null;
  end;
end;
$$;

-- Monday 09:30, clear of the 02:00-03:00 cron block. The 30-day floor
-- inside due_github_showcase_nudges does the throttling; this tick only
-- bounds how long a real change waits to be mentioned.
select cron.schedule(
  'github-showcase-nudge',
  '30 9 * * 1',
  $$select public.cron_github_showcase_nudge();$$
);
