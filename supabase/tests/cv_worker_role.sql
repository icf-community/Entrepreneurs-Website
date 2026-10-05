-- ════════════════════════════════════════════════════════════════════
-- Foundry · cv_worker can run every statement the worker runs — and no more
-- (F25, migration 20260928000013)
--
-- Each block below is a statement shape copied from server/app/worker.py or
-- cv_pipeline.py, executed AS cv_worker against real fixture rows. The
-- worker's pytest suite mocks psycopg, so this file is where a query added
-- without a matching grant fails. Keep it in step with worker.py: a new
-- query there gets a block here.
--
-- Then the other side: the role must not reach member data it has no use
-- for. Checked with has_*_privilege (authoritative, and immune to the CLI
-- 2.116 segfault on permission-denied calls) plus one real refused read.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 -f - < supabase/tests/cv_worker_role.sql
-- ════════════════════════════════════════════════════════════════════

begin;

-- postgres is not a superuser on Supabase: it may SET ROLE only to a role it
-- is a member of. Granted here, inside the rolled-back transaction, so the
-- migration itself grants nothing extra.
grant cv_worker to postgres;

create temp table f (member uuid, cv uuid, job uuid, skill uuid) on commit drop;
grant select on f to cv_worker;

do $$
declare
  v_member uuid := gen_random_uuid();
  v_cv     uuid := gen_random_uuid();
  v_job    uuid := gen_random_uuid();
  v_skill  uuid := gen_random_uuid();
  v_vec    text := '[' || array_to_string(array_fill(0.01::float8, array[1536]), ',') || ']';
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_member, 'cvw@imperial.ac.uk', '{"first_name":"Cy","surname":"Worker","role":"student"}'::jsonb,
          '{"provider":"email"}'::jsonb);
  insert into public.cvs (id, member_id, blob_key, status) values (v_cv, v_member, 'k.pdf', 'extracting');
  insert into public.jobs (id, kind, payload) values (v_job, 'ingest_cv', jsonb_build_object('cv_id', v_cv));
  insert into public.cv_skills (id, canonical_name, embedding) values (v_skill, 'Rust', v_vec::vector);
  insert into public.github_connections (member_id, github_user_id, github_username, access_token_encrypted, scan_status)
  values (v_member, 1, 'cy', extensions.pgp_sym_encrypt('gho_token', 'k'), 'scanning');
  insert into f values (v_member, v_cv, v_job, v_skill);
end $$;

set local role cv_worker;

do $$
declare
  x   record;
  v   record;
  vec text := '[' || array_to_string(array_fill(0.02::float8, array[1536]), ',') || ']';
begin
  select * into x from f;

  -- worker.py: claim, run, settle, retry, dead
  perform 1 from public.jobs
   where status = 'pending' and next_attempt_at <= now()
   order by created_at limit 1 for update skip locked;
  perform id, kind, payload, attempts, max_attempts from public.jobs where id = x.job;
  update public.jobs set status = 'running' where id = x.job;
  update public.jobs set status = 'done' where id = x.job;
  update public.jobs set status = 'pending', attempts = 1, last_error = 'e',
         next_attempt_at = now() + make_interval(secs => 5) where id = x.job;
  update public.jobs set status = 'dead', attempts = 2, last_error = 'e' where id = x.job;
  insert into public.jobs (kind, payload)
  select 'refresh_github_summary', jsonb_build_object('member_id', x.member)
   where not exists (select 1 from public.jobs j where j.kind = 'refresh_github_summary'
                        and j.status in ('pending', 'running') and (j.payload->>'member_id')::uuid = x.member);

  -- worker.py: the CV
  perform member_id, blob_key from public.cvs where id = x.cv;
  update public.cvs set mime_type = 'application/pdf' where id = x.cv;
  update public.cvs set raw_text = 'text', raw_text_hash = 'h' where id = x.cv;
  perform c.id from public.cvs c
   where c.member_id = x.member and c.raw_text_hash = 'h' and c.status = 'ready' and c.id <> x.cv
     and exists (select 1 from public.cv_profiles cp where cp.cv_id = c.id)
   order by c.created_at desc limit 1;
  update public.cvs set status = 'failed', failure_reason = 'r'
   where id = x.cv and status not in ('ready', 'flagged', 'failed');
  update public.cvs set status = 'extracting', failure_reason = null where id = x.cv;

  -- cv_pipeline.py: skill match, then member_skills replace
  select id, canonical_name, 1 - (embedding <=> vec::vector) as similarity into v
    from public.cv_skills order by embedding <=> vec::vector limit 1;
  delete from public.member_skills where member_id = x.member and source = 'cv';
  insert into public.member_skills (member_id, skill_id, raw_text, confidence, source)
  values (x.member, x.skill, 'rust', 0.9, 'cv');

  -- worker.py: profile, chunks, currency, ready
  insert into public.cv_profiles (cv_id, profile, summary, model_name, prompt_version)
  values (x.cv, '{}'::jsonb, 's', 'm', 'v1');
  perform profile from public.cv_profiles where cv_id = x.cv;
  perform profile, summary_source from public.cv_profiles where cv_id = x.cv;
  insert into public.cv_chunks (cv_id, member_id, chunk_type, content, embedding, embedding_model)
  values (x.cv, x.member, 'summary', 'c', vec::vector, 'm');
  update public.cv_profiles set summary = 's2', summary_source = 'cv_github', summary_regenerated_at = now()
   where cv_id = x.cv;
  update public.cv_chunks set content = 'c2', embedding = vec::vector, embedding_model = 'm'
   where cv_id = x.cv and chunk_type = 'summary';
  update public.cvs set status = 'ready' where id = x.cv;
  perform public.update_cv_currency(x.cv);
  perform id from public.cvs where member_id = x.member and status = 'ready' and is_current = true
   order by created_at desc limit 1;

  -- worker.py: GitHub
  perform pgp_sym_decrypt(access_token_encrypted, 'k'), github_username, scan_fingerprint, showcase_repos
     from public.github_connections where member_id = x.member;
  perform pgp_sym_decrypt(decode(encode(extensions.pgp_sym_encrypt('t', 'k'), 'hex'), 'hex'), 'k');
  update public.github_connections
     set github_signal = '{}'::jsonb, available_repos = '[]'::jsonb, scan_fingerprint = 'f',
         showcase_repos = '[]'::jsonb, scan_status = 'ready', scan_failure_reason = null, last_scanned_at = now()
   where member_id = x.member;
  perform github_signal from public.github_connections where member_id = x.member and scan_status = 'ready';
  perform showcase_repos from public.github_connections where member_id = x.member;
  update public.github_connections set scan_status = 'failed', scan_failure_reason = 'r', scan_failure_transient = true
   where member_id = x.member;
  update public.github_connections set scan_status = 'failed', scan_failure_reason = 'r', scan_failure_transient = false
   where member_id = x.member and scan_status not in ('ready', 'failed');
  update public.github_connections set scan_status = 'ready', scan_failure_reason = null, last_scanned_at = now()
   where member_id = x.member;
end $$;

reset role;

-- ─── and nothing else ────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['public.profiles', 'public.admins', 'public.app_config', 'public.connections',
                           'public.posts', 'public.notifications', 'public.outbound_email', 'auth.users']
  loop
    if has_table_privilege('cv_worker', t, 'select') or has_table_privilege('cv_worker', t, 'update') then
      raise exception 'FAIL: cv_worker can read or write %', t;
    end if;
  end loop;
  if has_column_privilege('cv_worker', 'public.cvs', 'original_filename', 'select') then
    raise exception 'FAIL: cv_worker can read cvs.original_filename, which it never uses';
  end if;
  if has_table_privilege('cv_worker', 'public.cvs', 'delete') or has_table_privilege('cv_worker', 'public.jobs', 'delete') then
    raise exception 'FAIL: cv_worker can delete CVs or jobs';
  end if;
  if (select rolbypassrls or rolsuper or rolinherit from pg_roles where rolname = 'cv_worker') then
    raise exception 'FAIL: cv_worker bypasses RLS, is a superuser, or inherits';
  end if;
end $$;

-- One real refused read, so the check above is not the only evidence.
set local role cv_worker;
do $$
begin
  perform 1 from public.profiles limit 1;
  raise exception 'FAIL: cv_worker read public.profiles';
exception when insufficient_privilege then
  null;
end $$;
reset role;

select 'cv_worker_role: all checks passed' as result;
rollback;
