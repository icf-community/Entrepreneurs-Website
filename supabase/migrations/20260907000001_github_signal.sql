-- ════════════════════════════════════════════════════════════════════
-- Foundry · CV matchmaker — GitHub signal
--
-- Optional second signal alongside the CV ingest pipeline
-- (20260906000001): a member can connect their GitHub account (real
-- OAuth "Authorize this app" consent, never a personal-access-token
-- instruction to the member), a worker scans their public, non-fork
-- repos for language stats, and that signal both (a) adds
-- source='github' rows to member_skills alongside the existing
-- source='cv' rows, and (b) causes the CV's generated summary to be
-- regenerated with GitHub evidence folded in (server/app/worker.py's
-- _refresh_combined_summary, run whichever of the two signals becomes
-- ready last).
--
-- This is the first place this codebase stores a third-party credential
-- at rest. No existing Vault/pgsodium convention to build on, so the
-- access token is encrypted with pgcrypto's pgp_sym_encrypt/decrypt
-- using a symmetric key that is never itself persisted in the database —
-- it's a shared secret between exactly two processes (the Next.js OAuth
-- callback and the Python worker), the same shape as the existing
-- SERVICE_TOKEN/GATEWAY_SERVICE_TOKEN cross-process secret. pgcrypto is
-- already enabled (20260527000001), just unused for column encryption
-- until now.
--
-- RLS: deny-all, same shape as every table in 20260906000001 — reached
-- only through the SECURITY DEFINER RPCs at the bottom. The worker's
-- direct Postgres connection is unaffected.
-- ════════════════════════════════════════════════════════════════════

-- ─── github_connections ────────────────────────────────────────────
create table public.github_connections (
  member_id              uuid        primary key references public.profiles(id) on delete cascade,
  github_user_id         bigint      not null,
  github_username        text        not null,
  access_token_encrypted bytea       not null,
  scan_status            text        not null default 'pending',
  scan_failure_reason    text,
  -- {languages: [...], repo_count: n, top_repos: [{name, description, language, stargazers_count}]}
  -- — see server/app/github_pipeline.py's GithubSignal.
  github_signal          jsonb,
  connected_at           timestamptz not null default now(),
  last_scanned_at        timestamptz
);

alter table public.github_connections
  add constraint github_connections_scan_status_check
  check (scan_status in ('pending', 'scanning', 'ready', 'failed'));

-- One GitHub account can't be linked to two different members.
create unique index github_connections_github_user_id_idx on public.github_connections (github_user_id);

alter table public.github_connections enable row level security;
revoke all on public.github_connections from public, anon, authenticated;

-- ─── member_skills gains a source, so a GitHub scan doesn't wipe CV skills ──
-- _replace_member_skills (worker.py) used to do an unconditional
-- `delete from member_skills where member_id = %s` before reinserting —
-- fine when there was only ever one source, but a GitHub scan calling
-- that unchanged would silently delete the member's CV-derived skills.
-- Existing rows are all CV-derived, hence the default.
alter table public.member_skills add column source text not null default 'cv';
alter table public.member_skills
  add constraint member_skills_source_check
  check (source in ('cv', 'github'));

-- ─── cv_profiles gains summary provenance ───────────────────────────
-- summary can now be regenerated after the fact (once both a CV and a
-- GitHub scan are ready for the same member), so it's no longer a
-- write-once artifact tied 1:1 to the original extraction — these two
-- columns record when/why it changed.
alter table public.cv_profiles add column summary_source text not null default 'cv';
alter table public.cv_profiles
  add constraint cv_profiles_summary_source_check
  check (summary_source in ('cv', 'cv_github'));
alter table public.cv_profiles add column summary_regenerated_at timestamptz;

-- ─── confirm_github_connected ────────────────────────────────────────
-- Called by the Next.js OAuth callback route once GitHub's code has been
-- exchanged for an access token server-side. p_encryption_key is a
-- process secret passed in by the caller (GITHUB_TOKEN_ENCRYPTION_KEY) —
-- never persisted, used only in-flight to encrypt the token before it's
-- written. One row per member (upsert on reconnect); enqueues the same
-- scan_github job either way, so reconnecting re-scans.
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

  insert into public.jobs (kind, payload)
  values ('scan_github', jsonb_build_object('member_id', v_caller));
end;
$$;

revoke execute on function public.confirm_github_connected(bigint, text, text, text) from public, anon;
grant  execute on function public.confirm_github_connected(bigint, text, text, text) to authenticated;

-- ─── get_my_github_status ────────────────────────────────────────────
-- Backs the profile page's GitHub section. Null row = not connected.
create or replace function public.get_my_github_status()
returns table (github_username text, scan_status text, scan_failure_reason text, has_signal boolean)
language sql
stable
security definer
set search_path = public
as $$
  select github_username, scan_status, scan_failure_reason, (github_signal is not null)
    from public.github_connections
   where member_id = auth.uid();
$$;

revoke execute on function public.get_my_github_status() from public, anon;
grant  execute on function public.get_my_github_status() to authenticated;

-- ─── disconnect_github ───────────────────────────────────────────────
-- Removes the connection and the member's github-sourced skill rows.
-- Does not revert a summary already regenerated with GitHub evidence
-- back to CV-only — left as-is until the next CV re-upload naturally
-- regenerates a CV-only summary (documented limitation, not a bug).
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
end;
$$;

revoke execute on function public.disconnect_github() from public, anon;
grant  execute on function public.disconnect_github() to authenticated;
