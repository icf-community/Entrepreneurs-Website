-- ════════════════════════════════════════════════════════════════════
-- Foundry · Kill switch — GitHub connect / CV upload ingestion
--
-- Same shape as posting_enabled() (20260829000002): an app_config flag
-- read through a SECURITY DEFINER function, default OPEN here (unlike
-- posting_enabled's default-closed) because this must not change today's
-- behaviour — only add a fast way to turn it off. The row is inserted
-- with value='true' below specifically so a missing-row fallback is never
-- exercised in the common case; the function still defaults to false if
-- the row is ever deleted, matching posting_enabled's "fail closed" rule.
--
-- Deliberately narrow: this gates ONLY the LLM/worker-job-enqueuing part
-- of each flow, not the underlying file storage / OAuth-connection
-- recording, which predate the ingest pipeline and are not what needs a
-- fast off switch:
--   * confirm_cv_upload — the profiles.cv_path write (the older,
--     pre-ingest-pipeline CV storage feature) still happens; only the
--     `cvs` row + `ingest_cv` job are suppressed.
--   * confirm_github_connected — the github_connections upsert (and the
--     profiles.github_url backfill) still happens; only the `scan_github`
--     job is suppressed.
-- This mirrors the existing llm_job_budget_available predicate pattern in
-- 20260908000002 (guard the job insert, not the whole RPC) rather than
-- create_post's raise-an-exception pattern — raising here would also roll
-- back the harmless, unrelated storage write in the same transaction,
-- which is more blast radius than a kill switch should have.
--
-- The frontend gate (intake/profile pages, hides the entry points
-- entirely) means a member on the normal UI never reaches a disabled
-- RPC in the first place; this is the defense-in-depth layer for a
-- direct call.
-- ════════════════════════════════════════════════════════════════════

insert into public.app_config (key, value)
values ('github_cv_ingestion_enabled', 'true')
on conflict (key) do nothing;

create or replace function public.github_cv_ingestion_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value = 'true' from public.app_config where key = 'github_cv_ingestion_enabled'),
    false
  );
$$;

revoke execute on function public.github_cv_ingestion_enabled() from public, anon;
grant  execute on function public.github_cv_ingestion_enabled() to authenticated;

-- ─── confirm_cv_upload (recreated from 20260906000001, the latest and
-- only other definition) — every line unchanged except the ingest block
-- now also requires the kill switch to be on. ──────────────────────────
create or replace function public.confirm_cv_upload(
  p_blob_key text,
  p_filename text,
  p_consent  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_name   text;
  v_cv_id  uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.upload_tickets
     where blob_key = p_blob_key
       and user_id = v_caller
       and purpose = 'cv'
       and consumed_at is null
  ) then
    raise exception 'That upload ticket is invalid, expired, or already used'
      using errcode = '42501';
  end if;

  update public.upload_tickets
     set consumed_at = now()
   where blob_key = p_blob_key;

  v_name := nullif(trim(coalesce(p_filename, '')), '');
  if v_name is not null and length(v_name) > 255 then
    v_name := left(v_name, 255);
  end if;

  -- The previous cv_path (if any) is enqueued for deletion by
  -- profiles_enqueue_media_deletion (20260901000002), not here.
  perform set_config('foundry.media_write', 'true', true);
  update public.profiles
     set cv_path                 = p_blob_key,
         cv_uploaded_at          = now(),
         cv_original_filename    = v_name,
         cv_parse_consent        = coalesce(p_consent, false),
         cv_parse_consent_at     = case when p_consent then now() else null end,
         cv_suggested_skill_ids  = null
   where id = v_caller;
  perform set_config('foundry.media_write', 'false', true);

  -- Gated on the same consent tick as the older suggestion flow above —
  -- the privacy policy (section 2a) promises CV text is only read if this
  -- box is ticked, so the ingest pipeline must honour it too, not just the
  -- deterministic prefill. See cv-matchmaker-phase1-shipped's follow-up:
  -- until the policy copy is rewritten to disclose OpenAI as a
  -- sub-processor, an unconsented upload must never reach it.
  --
  -- CHANGED (20260911000003): also requires github_cv_ingestion_enabled().
  -- The file is stored either way; only the ingest job is suppressed while
  -- the kill switch is off.
  if p_consent and public.github_cv_ingestion_enabled() then
    insert into public.cvs (member_id, blob_key, original_filename)
    values (v_caller, p_blob_key, v_name)
    returning id into v_cv_id;

    insert into public.jobs (kind, payload)
    values ('ingest_cv', jsonb_build_object('cv_id', v_cv_id));
  end if;
end;
$$;

revoke execute on function public.confirm_cv_upload(text, text, boolean) from public, anon;
grant  execute on function public.confirm_cv_upload(text, text, boolean) to authenticated;

-- ─── confirm_github_connected (recreated from 20260908000002, the true
-- latest per that file's own header — NOT 20260907000004, which is
-- missing both the pgcrypto schema qualification and the dedupe/budget
-- guards) — every line unchanged except the scan_github insert now also
-- requires the kill switch to be on. ────────────────────────────────────
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
    -- SCHEMA-QUALIFIED, and it must stay that way — see 20260908000002's
    -- header for why an unqualified call here breaks every connection.
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

  -- Guarded against duplicate pending jobs and the per-member LLM budget
  -- (20260908000002) — CHANGED (20260911000003): also requires
  -- github_cv_ingestion_enabled(). The connection is recorded either way;
  -- only the scan job is suppressed while the kill switch is off.
  insert into public.jobs (kind, payload)
  select 'scan_github', jsonb_build_object('member_id', v_caller)
   where public.github_cv_ingestion_enabled()
     and public.llm_job_budget_available(v_caller)
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
