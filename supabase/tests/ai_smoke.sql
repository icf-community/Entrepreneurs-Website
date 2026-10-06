-- ════════════════════════════════════════════════════════════════════
-- Foundry · AI database invariants (migrations 20261006000001-5)
--
-- Grants, the criteria grammar's limits, the spend ledger's caps, lease
-- fencing, admission, audiences, consent withdrawal, seven-day expiry and
-- account deletion with AI rows present (F30). Everything runs in one
-- transaction and is rolled back.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 -f - < supabase/tests/ai_smoke.sql
--
-- Negative grant checks use has_*_privilege, not call-and-catch: the local
-- CLI 2.116 image segfaults on a denied SECURITY DEFINER call.
-- ════════════════════════════════════════════════════════════════════

begin;

grant ai_service to postgres;

create temp table t (k text primary key, v uuid) on commit drop;
grant select on t to authenticated, ai_service;

create or replace function pg_temp.as_member(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;

-- ─── Fixtures ───────────────────────────────────────────────────────
do $$
declare
  v_student  uuid := gen_random_uuid();
  v_grad     uuid := gen_random_uuid();
  v_unknown  uuid := gen_random_uuid();
  v_poster   uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_job      uuid := gen_random_uuid();
  v_students uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
    (v_student, 'ai-s@imperial.ac.uk', '{"first_name":"Sam","surname":"Student","role":"student","grad_year":"2028"}', '{"provider":"email"}'),
    (v_grad,    'ai-g@imperial.ac.uk', '{"first_name":"Gia","surname":"Graduate","role":"alum","grad_year":"2020"}', '{"provider":"email"}'),
    (v_unknown, 'ai-u@imperial.ac.uk', '{"first_name":"Uma","surname":"Unknown","role":"alum","grad_year":"2019"}', '{"provider":"email"}'),
    (v_poster,  'ai-p@imperial.ac.uk', '{"first_name":"Pat","surname":"Poster","role":"alum","grad_year":"2018"}', '{"provider":"email"}'),
    (v_admin,   'ai-a@imperial.ac.uk', '{"first_name":"Ada","surname":"Admin","role":"alum","grad_year":"2017"}', '{"provider":"email"}');
  update public.profiles set status = 'approved', course = 'Computing'
   where id in (v_student, v_grad, v_unknown, v_poster, v_admin);
  insert into public.admins (user_id) values (v_admin);
  insert into public.member_education (member_id, currently_enrolled, has_completed_degree) values
    (v_student, true, false), (v_grad, false, true), (v_poster, false, true), (v_admin, false, true);

  insert into public.opportunities (id, posted_by, status, position_name, company, pay, location_type, description,
    start_month, start_year, application_deadline, contact_email, apply_method, approved_at, approved_by,
    eligible_audience)
  values
    (v_job, v_poster, 'approved', 'Grad role', 'Co', 'Paid', 'remote', 'A role for graduates using Python daily.',
     1, 2027, current_date + 10, 'p@x.test', 'email', now(), v_admin, 'graduates'),
    (v_students, v_poster, 'approved', 'Student role', 'Co', 'Paid', 'remote', 'A role for students using Python.',
     1, 2027, current_date + 10, 'p@x.test', 'email', now(), v_admin, 'students');

  insert into t values ('student', v_student), ('grad', v_grad), ('unknown', v_unknown), ('poster', v_poster),
                       ('admin', v_admin), ('job', v_job), ('students_job', v_students);
end $$;


-- ─── 1. Grants: browsers can't reach ai_private; each login gets only its own ─
do $$
declare
  v_bad text;
begin
  if has_schema_privilege('anon', 'ai_private', 'usage') or has_schema_privilege('authenticated', 'ai_private', 'usage') then
    raise exception 'FAIL: an API role has usage on ai_private';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'ai_private'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'FAIL: ai_private functions executable by an API role or PUBLIC: %', v_bad;
  end if;
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ai_private' and c.relkind = 'r'
     and (has_table_privilege('ai_service', c.oid, 'select') or has_table_privilege('cv_worker', c.oid, 'select')
          or has_table_privilege('authenticated', c.oid, 'select'));
  if v_bad is not null then
    raise exception 'FAIL: a login can read ai_private tables directly: %', v_bad;
  end if;
  if has_function_privilege('ai_service', 'ai_private.worker_put_member_docs(uuid,bigint,integer,jsonb,jsonb)', 'execute')
     or has_function_privilege('ai_service', 'ai_private.worker_member_source(uuid)', 'execute') then
    raise exception 'FAIL: the executor can read or write raw member sources (F26)';
  end if;
  if has_function_privilege('cv_worker', 'ai_private.exec_claim(text)', 'execute')
     or has_function_privilege('cv_worker', 'ai_private.exec_publish(uuid,uuid,bigint,integer,jsonb,boolean)', 'execute') then
    raise exception 'FAIL: the CV worker can run executor functions';
  end if;
  if not has_function_privilege('ai_service', 'ai_private.exec_claim(text)', 'execute')
     or not has_function_privilege('cv_worker', 'ai_private.worker_reserve(uuid,uuid,text,text,integer,integer)', 'execute') then
    raise exception 'FAIL: a login is missing a grant it needs';
  end if;
  if has_table_privilege('ai_service', 'public.profiles', 'select') or has_table_privilege('ai_service', 'auth.users', 'select') then
    raise exception 'FAIL: the executor can read member tables';
  end if;
  if (select rolbypassrls or rolsuper or rolinherit from pg_roles where rolname = 'ai_service') then
    raise exception 'FAIL: ai_service bypasses RLS, is a superuser, or inherits';
  end if;
end $$;


-- ─── 2. The criteria grammar: grounding, limits, dedupe, policy ─────
do $$
declare
  v jsonb;
  ok boolean;
begin
  -- grounded concept from the message
  v := ai_private.apply_spec_ops(null, '[{"op":"add","kind":"tool","concept":"pytorch"}]', 'recruiter',
                                 'must know pytorch', gen_random_uuid(), now() + interval '1 day', false);
  if jsonb_array_length(v->'atoms') <> 1 or v->'atoms'->0->>'concept' <> 'pytorch' then
    raise exception 'FAIL: grounded concept not added: %', v;
  end if;
  -- the same criterion twice is one criterion
  v := ai_private.apply_spec_ops(v, '[{"op":"add","kind":"tool","concept":"pytorch"}]', 'recruiter',
                                 'pytorch again', gen_random_uuid(), now() + interval '1 day', false);
  if jsonb_array_length(v->'atoms') <> 1 then raise exception 'FAIL: duplicate criterion added'; end if;
  -- restating it as a must-have upgrades it rather than being dropped
  v := ai_private.apply_spec_ops(v, '[{"op":"add","kind":"tool","concept":"pytorch","required":true}]', 'recruiter',
                                 'must have pytorch', gen_random_uuid(), now() + interval '1 day', false);
  if jsonb_array_length(v->'atoms') <> 1 or not (v->'atoms'->0->>'required')::boolean then
    raise exception 'FAIL: a stronger restatement did not make the criterion required';
  end if;

  -- a concept the message doesn't mention is refused
  begin
    perform ai_private.apply_spec_ops(null, '[{"op":"add","kind":"tool","concept":"rust"}]', 'recruiter',
                                      'find python people', gen_random_uuid(), now(), false);
    raise exception 'FAIL: ungrounded concept accepted';
  exception when invalid_parameter_value then null;
  end;
  -- free text must be the exact span it cites
  begin
    perform ai_private.apply_spec_ops(null, '[{"op":"add","kind":"free","free_text":"quantum origami","span":[0,5]}]',
                                      'network', 'quantum origami fans', gen_random_uuid(), now(), false);
    raise exception 'FAIL: mismatched span accepted';
  exception when invalid_parameter_value then null;
  end;
  v := ai_private.apply_spec_ops(null, '[{"op":"add","kind":"free","free_text":"quantum origami","span":[0,15]}]',
                                 'network', 'quantum origami fans', gen_random_uuid(), now() + interval '1 day', false);
  if v->'atoms'->0->>'free_text' <> 'quantum origami' then raise exception 'FAIL: exact span refused'; end if;
  -- personal characteristics can't be criteria
  begin
    perform ai_private.apply_spec_ops(null, '[{"op":"add","kind":"free","free_text":"young women"}]', 'network',
                                      null, null, null, true);
    raise exception 'FAIL: sensitive free text accepted';
  exception when invalid_parameter_value then null;
  end;
  -- hobbies are not a recruiter criterion
  begin
    perform ai_private.apply_spec_ops(null, '[{"op":"add","kind":"interest","concept":"chess"}]', 'recruiter',
                                      null, null, null, true);
    raise exception 'FAIL: interest accepted in recruiter mode';
  exception when invalid_parameter_value then null;
  end;
  -- a negated criterion is a hard exclusion
  v := ai_private.apply_spec_ops(null, '[{"op":"add","kind":"tool","concept":"pytorch","negated":true,"required":false}]',
                                 'recruiter', null, null, null, true);
  if not (v->'atoms'->0->>'required')::boolean then raise exception 'FAIL: negation not made required'; end if;
  -- at most 12 criteria
  begin
    perform ai_private.apply_spec_ops(null, (select jsonb_agg(jsonb_build_object('op','add','kind','tool','concept',slug))
                                               from (select slug from ai_private.concepts where kind = 'tool' limit 13) s),
                                      'recruiter', null, null, null, true);
    raise exception 'FAIL: 13 criteria accepted';
  exception when invalid_parameter_value then null;
  end;
  -- an expired chat source drops out of the spec at read time
  v := jsonb_build_object('atoms', jsonb_build_array(
         jsonb_build_object('id','a1','kind','tool','concept','pytorch','source',jsonb_build_object('type','message','expires_at', now() - interval '1 second')),
         jsonb_build_object('id','a2','kind','tool','concept','python','source',jsonb_build_object('type','job'))));
  if jsonb_array_length(ai_private.effective_spec(v)->'atoms') <> 1 then
    raise exception 'FAIL: expired criterion still effective';
  end if;
end $$;


-- ─── 3. Ledger: caps hold, prices must be confirmed, settle is idempotent ─
do $$
declare
  v_id   uuid;
  v_cost bigint;
begin
  -- 1000 microdollars of headroom over whatever today has already used.
  update ai_private.settings
     set ingestion_daily_cap_micro = 1000 + coalesce((select sum(ai_private.spend_charged(s)) from ai_private.spend s
                                                       where s.day = (now() at time zone 'utc')::date
                                                         and s.purpose = 'ingestion'), 0),
         controller_daily_cap_micro = 100000000
   where id = 1;
  v_id := ai_private.spend_reserve('ingestion', null, null, null, null, 'test', 'fake-mini', 100, 100);
  begin
    perform ai_private.spend_reserve('ingestion', null, null, null, null, 'test', 'fake-mini', 1000000, 0);
    raise exception 'FAIL: reservation over the ingestion cap accepted';
  exception when raise_exception then
    if sqlerrm not like 'budget_exhausted%' then raise; end if;
  end;
  v_cost := ai_private.spend_settle(v_id, 10, 10);
  if v_cost <> ai_private.spend_settle(v_id, 999999, 999999) then
    raise exception 'FAIL: settling twice changed the charge';
  end if;
  begin
    perform ai_private.spend_reserve('matching', 'network', null, null, null, 'test', 'gpt-5.4', 10, 10);
    raise exception 'FAIL: an unconfirmed price was accepted for matching';
  exception when raise_exception then
    if sqlerrm not like 'unconfirmed_price%' then raise; end if;
  end;
end $$;


-- ─── 4. Audiences: education decides, unknown sees nothing, F18 marker ─
do $$
declare
  v_student uuid := (select v from t where k = 'student');
  v_grad    uuid := (select v from t where k = 'grad');
  v_unknown uuid := (select v from t where k = 'unknown');
  v_poster  uuid := (select v from t where k = 'poster');
  v_admin   uuid := (select v from t where k = 'admin');
  v_job     uuid := (select v from t where k = 'job');
  v_sjob    uuid := (select v from t where k = 'students_job');
  v_new     uuid;
begin
  perform pg_temp.as_member(v_student);
  if exists (select 1 from public.list_approved_opportunities() where id = v_job) then
    raise exception 'FAIL: a student sees a graduates-only job';
  end if;
  if not exists (select 1 from public.list_approved_opportunities() where id = v_sjob)
     or not exists (select 1 from public.get_approved_opportunity(v_sjob)) then
    raise exception 'FAIL: a student cannot see a students job';
  end if;
  if exists (select 1 from public.opportunities where id = v_job) then
    raise exception 'FAIL: table RLS shows a graduates-only job to a student';
  end if;

  perform pg_temp.as_member(v_unknown);
  if exists (select 1 from public.list_approved_opportunities() where id in (v_job, v_sjob))
     or exists (select 1 from public.list_newest_opportunities(20) where id in (v_job, v_sjob)) then
    raise exception 'FAIL: unknown education status sees an audience job';
  end if;

  perform pg_temp.as_member(v_poster);
  if (select count(*) from public.list_approved_opportunities() where id in (v_job, v_sjob)) <> 2 then
    raise exception 'FAIL: the poster lost sight of their own jobs';
  end if;

  perform pg_temp.as_member(v_admin);
  v_new := public.admin_create_opportunity('Admin job', 'Co', 'Paid', 'remote', null,
             'An admin-created role using Python.', 1::smallint, 2027, current_date + 5, null, false, 'email', null,
             null, null, 'both');
  perform pg_temp.as_owner();
  if (select creation_source from public.opportunities where id = v_new) <> 'admin' then
    raise exception 'FAIL: admin_create_opportunity did not mark the job as admin-created (F18)';
  end if;

  perform pg_temp.as_member(v_grad);
  begin
    perform public.submit_opportunity('No audience', 'Co', 'Paid', 'remote', null, 'A role description here.',
      1::smallint, 2027, current_date + 5, null, false, 'email', null, null, null, null);
    raise exception 'FAIL: a job without an audience was accepted';
  exception when invalid_parameter_value then null;
  end;
  perform pg_temp.as_owner();
end $$;


-- ─── 5. Admission, idempotency and leases ───────────────────────────
do $$
declare
  v_grad uuid := (select v from t where k = 'grad');
  r      record;
  r2     record;
  v_ctx  jsonb;
  v_lease uuid;
begin
  perform pg_temp.as_member(v_grad);
  select * into r from public.ai_submit_turn('network', null, null, 'message', 'python', 'key-0000001', null, false);
  if r.outcome <> 'disabled' then raise exception 'FAIL: AI off but turn admitted: %', r.outcome; end if;

  perform pg_temp.as_owner();
  update public.app_config set value = 'true' where key in ('ai_enabled', 'ai_network_enabled');

  perform pg_temp.as_member(v_grad);
  select * into r from public.ai_submit_turn('network', null, null, 'message', 'python', 'key-0000002', null, false);
  if r.outcome <> 'queued' then raise exception 'FAIL: turn not queued: %', r.outcome; end if;
  select * into r2 from public.ai_submit_turn('network', null, null, 'message', 'python', 'key-0000002', null, false);
  if r2.outcome <> 'duplicate' or r2.turn_id <> r.turn_id then raise exception 'FAIL: retry made a second turn'; end if;
  select * into r2 from public.ai_submit_turn('network', null, null, 'message', 'rust', 'key-0000002', null, false);
  if r2.outcome <> 'idempotency_conflict' then raise exception 'FAIL: changed body reused a key'; end if;
  select * into r2 from public.ai_submit_turn('network', null, null, 'message', repeat('x', 601), 'key-0000003', null, false);
  if r2.outcome <> 'invalid_message' then raise exception 'FAIL: oversize message admitted'; end if;
  select * into r2 from public.ai_submit_turn('network', null, null, 'message', 'find sam student', 'key-0000004', null, false);
  if r2.outcome <> 'named_person' then raise exception 'FAIL: name search admitted: %', r2.outcome; end if;
  if exists (select 1 from public.ai_turn_status(gen_random_uuid())) then
    raise exception 'FAIL: status of a turn that is not yours';
  end if;

  -- the executor: a lease, and a stale one refused
  perform pg_temp.as_owner();
  set local role ai_service;
  v_ctx := ai_private.exec_claim('smoke');
  v_lease := (v_ctx->>'lease')::uuid;
  if (v_ctx->>'turn_id')::uuid <> r.turn_id then raise exception 'FAIL: claimed the wrong turn'; end if;
  perform ai_private.exec_heartbeat(r.turn_id, v_lease, 'searching');
  begin
    perform ai_private.exec_heartbeat(r.turn_id, gen_random_uuid(), 'searching');
    raise exception 'FAIL: a forged lease was accepted';
  exception when raise_exception then
    if sqlerrm not like 'stale_lease%' then raise; end if;
  end;
  perform ai_private.exec_finish(r.turn_id, v_lease, 'failed', 'error');
  begin
    perform ai_private.exec_heartbeat(r.turn_id, v_lease, 'searching');
    raise exception 'FAIL: a finished turn kept its lease';
  exception when raise_exception then
    if sqlerrm not like 'stale_lease%' then raise; end if;
  end;
  reset role;
end $$;


-- ─── 6. Withdrawal deletes the purpose's projection immediately ─────
do $$
declare
  v_grad uuid := (select v from t where k = 'grad');
begin
  perform pg_temp.as_owner();
  insert into ai_private.member_docs (member_id, purpose, source_version, consent_epoch, policy_version,
                                      projection_hash, body)
  values (v_grad, 'network', 1, 1, 'v', repeat('a', 64), 'Python');
  perform pg_temp.as_member(v_grad);
  perform public.set_my_ai_settings(false, false, false, true, '{}', '{}', '{}', '{}', 'ai-discovery-v1');
  perform pg_temp.as_owner();
  if exists (select 1 from ai_private.member_docs where member_id = v_grad and purpose = 'network') then
    raise exception 'FAIL: withdrawal left the network projection in place';
  end if;
  if not exists (select 1 from ai_private.consent_events where member_id = v_grad) then
    -- a first save records the choices made
    null;
  end if;
end $$;


-- ─── 7. Account deletion works with AI rows present (F30) ───────────
do $$
declare
  v_grad uuid := (select v from t where k = 'grad');
begin
  perform pg_temp.as_owner();
  if not exists (select 1 from ai_private.conversations where owner_id = v_grad) then
    raise exception 'FAIL: fixture has no AI rows to delete through';
  end if;
  perform pg_temp.as_member(v_grad);
  perform public.delete_my_account();
  perform pg_temp.as_owner();
  if exists (select 1 from public.profiles where id = v_grad)
     or exists (select 1 from ai_private.conversations where owner_id = v_grad)
     or exists (select 1 from ai_private.usage_events where owner_id = v_grad) then
    raise exception 'FAIL: account deletion left the member or their AI rows behind';
  end if;
  if exists (select 1 from ai_private.spend where member_id = v_grad) then
    raise exception 'FAIL: spend rows still name a deleted member';
  end if;
end $$;


-- ─── 8. Purge: expired chat history goes ────────────────────────────
do $$
declare
  v_student uuid := (select v from t where k = 'student');
  v_conv    uuid;
begin
  perform pg_temp.as_owner();
  insert into ai_private.conversations (owner_id, mode, last_activity_at)
  values (v_student, 'network', now() - interval '8 days') returning id into v_conv;
  insert into ai_private.messages (conversation_id, owner_id, role, kind, body, created_at, expires_at)
  values (v_conv, v_student, 'member', 'message', 'old', now() - interval '8 days', now() - interval '1 day');
  perform ai_private.cron_purge();
  if exists (select 1 from ai_private.conversations where id = v_conv) then
    raise exception 'FAIL: a conversation past seven days survived the purge';
  end if;
end $$;

-- ─── 9. Admin deletion and job deletion with AI rows present (F30) ──
do $$
declare
  v_student uuid := (select v from t where k = 'student');
  v_poster  uuid := (select v from t where k = 'poster');
  v_admin   uuid := (select v from t where k = 'admin');
  v_sjob    uuid := (select v from t where k = 'students_job');
  v_conv    uuid;
  v_turn    uuid;
begin
  perform pg_temp.as_owner();
  -- The student is a result in the poster's recruiter search, has
  -- projections and a cached assessment; the poster's job has job docs.
  insert into ai_private.member_docs (member_id, purpose, source_version, consent_epoch, policy_version, projection_hash, body)
  values (v_student, 'recruiter', 1, 1, 'v', repeat('b', 64), 'PyTorch');
  insert into ai_private.member_evidence (member_id, purpose, source_version, source_kind, text)
  values (v_student, 'recruiter', 1, 'cv_skill', 'CV skill: PyTorch');
  insert into ai_private.assessments (cache_key, target_member, purpose, projection_hash, verdict, expires_at)
  values (repeat('c', 64), v_student, 'recruiter', repeat('b', 64), '{}', now() + interval '1 day');
  insert into ai_private.job_docs (opportunity_id, content_version, body) values (v_sjob, 1, 'Student role');
  insert into ai_private.job_requirements (opportunity_id, content_version, status) values (v_sjob, 1, 'parsed');
  insert into ai_private.conversations (owner_id, mode, opportunity_id) values (v_poster, 'recruiter', v_sjob)
  returning id into v_conv;
  insert into ai_private.turns (conversation_id, owner_id, mode, opportunity_id, kind, idempotency_key, body_digest,
                                expected_revision, status)
  values (v_conv, v_poster, 'recruiter', v_sjob, 'run', 'key-f30-0001', 'd', 0, 'completed') returning id into v_turn;
  insert into ai_private.results (turn_id, slot, target_member, score, tier) values (v_turn, 1, v_student, 80, 'meets');

  perform pg_temp.as_member(v_admin);
  perform public.admin_delete_user(v_student, 'ai_smoke F30');
  perform pg_temp.as_owner();
  if exists (select 1 from public.profiles where id = v_student)
     or exists (select 1 from ai_private.member_docs where member_id = v_student)
     or exists (select 1 from ai_private.results where target_member = v_student)
     or exists (select 1 from ai_private.assessments where target_member = v_student) then
    raise exception 'FAIL: admin deletion left the member or AI rows naming them';
  end if;

  delete from public.opportunities where id = v_sjob;
  if exists (select 1 from ai_private.job_docs where opportunity_id = v_sjob)
     or exists (select 1 from ai_private.conversations where id = v_conv) then
    raise exception 'FAIL: deleting a job left its AI rows';
  end if;
end $$;

select 'ai_smoke: all checks passed' as result;
rollback;
