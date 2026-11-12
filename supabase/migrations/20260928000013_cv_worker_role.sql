-- ════════════════════════════════════════════════════════════════════
-- Foundry · A least-privilege login for the CV / GitHub worker (F25)
--
-- The worker connected as `postgres` through the session pooler: every
-- table, auth.users included, and RLS bypassed. Its real footprint is
-- seven tables, one RPC and pgcrypto's decrypt. `cv_worker` gets exactly
-- that — column by column, from the statements in server/app/worker.py and
-- cv_pipeline.py — and nothing else. supabase/tests/cv_worker_role.sql
-- runs every one of those statement shapes as this role, so a new query
-- without a grant fails there rather than in production; it also proves
-- the role cannot reach profiles, auth.users or app_config.
--
-- NOINHERIT / NOBYPASSRLS: no inherited privileges, and RLS applies, so
-- each table gets a `to cv_worker` policy below. No password here — the
-- owner sets it on the production database (and locally per
-- server/README.md), then switches /etc/foundry/worker.env.
--
-- F26 (projection / JD jobs) will extend these grants explicitly.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cv_worker') then
    create role cv_worker login noinherit nobypassrls nocreatedb nocreaterole noreplication;
  end if;
end $$;

-- pgcrypto (and, on a dashboard-enabled project, vector) live in
-- `extensions`; the worker calls pgp_sym_decrypt unqualified.
alter role cv_worker set search_path = public, extensions;

grant usage on schema public, extensions to cv_worker;

-- ─── jobs: claim, settle, enqueue a summary refresh ──────────────────
grant select (id, kind, payload, status, attempts, max_attempts, next_attempt_at, created_at),
      update (status, attempts, last_error, next_attempt_at),
      insert (kind, payload)
   on public.jobs to cv_worker;

-- ─── cvs: read the upload, record text and status ────────────────────
grant select (id, member_id, blob_key, status, raw_text_hash, is_current, created_at),
      update (status, failure_reason, mime_type, raw_text, raw_text_hash)
   on public.cvs to cv_worker;

-- ─── github_connections: decrypt the token, record the scan ──────────
grant select (member_id, github_username, access_token_encrypted, scan_status, github_signal,
              showcase_repos, scan_fingerprint),
      update (scan_status, scan_failure_reason, scan_failure_transient, last_scanned_at,
              github_signal, available_repos, scan_fingerprint, showcase_repos)
   on public.github_connections to cv_worker;

-- ─── member_skills: replace one source's rows ────────────────────────
grant select (member_id, source),
      insert (member_id, skill_id, raw_text, confidence, source),
      delete
   on public.member_skills to cv_worker;

-- ─── cv_profiles / cv_chunks: the extracted profile and its vectors ──
grant select (cv_id, profile, summary_source),
      insert (cv_id, profile, summary, model_name, prompt_version),
      update (summary, summary_source, summary_regenerated_at)
   on public.cv_profiles to cv_worker;

grant select (cv_id, chunk_type),
      insert (cv_id, member_id, chunk_type, content, embedding, embedding_model),
      update (content, embedding, embedding_model)
   on public.cv_chunks to cv_worker;

-- ─── cv_skills: nearest-neighbour skill match (read only) ────────────
grant select (id, canonical_name, embedding) on public.cv_skills to cv_worker;

-- ─── functions ───────────────────────────────────────────────────────
grant execute on function public.update_cv_currency(uuid) to cv_worker;
grant execute on function extensions.pgp_sym_decrypt(bytea, text) to cv_worker;

-- ─── RLS: the grants above are the limit; these let the role see rows ─
create policy cv_worker_jobs on public.jobs
  for all to cv_worker using (true) with check (true);
create policy cv_worker_cvs on public.cvs
  for all to cv_worker using (true) with check (true);
create policy cv_worker_github_connections on public.github_connections
  for all to cv_worker using (true) with check (true);
create policy cv_worker_member_skills on public.member_skills
  for all to cv_worker using (true) with check (true);
create policy cv_worker_cv_profiles on public.cv_profiles
  for all to cv_worker using (true) with check (true);
create policy cv_worker_cv_chunks on public.cv_chunks
  for all to cv_worker using (true) with check (true);
create policy cv_worker_cv_skills on public.cv_skills
  for select to cv_worker using (true);
