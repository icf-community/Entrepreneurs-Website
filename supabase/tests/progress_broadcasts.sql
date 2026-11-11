-- ════════════════════════════════════════════════════════════════════
-- Foundry · progress broadcasts (20261111000001)
--
-- The triggers must send exactly one signal per real change, from every
-- writer (including the restricted cv_worker and ai_service roles, which
-- can't write realtime.messages themselves), and a member may receive only
-- their own topic and send on none.
--
-- Usage: psql "$DATABASE_URL" -f supabase/tests/progress_broadcasts.sql
-- ════════════════════════════════════════════════════════════════════
begin;
set local role postgres;
grant cv_worker to postgres;

create temp table t_ids as select gen_random_uuid() as a, gen_random_uuid() as b, gen_random_uuid() as cv;
grant select on t_ids to public;

do $$
declare v record;
begin
  select * into v from t_ids;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
    (v.a, 'pb-a@imperial.ac.uk', '{"first_name":"A","surname":"U","role":"student"}', '{"provider":"email"}'),
    (v.b, 'pb-b@imperial.ac.uk', '{"first_name":"B","surname":"U","role":"student"}', '{"provider":"email"}');
  insert into public.cvs (id, member_id, blob_key, status) values (v.cv, v.a, 'pb/test.pdf', 'pending');
  insert into public.github_connections (member_id, github_user_id, github_username, access_token_encrypted, scan_status)
  values (v.a, 990001, 'pb-a', 'x', 'pending');
end $$;

create temp table t_before as select count(*) as n from realtime.messages;
grant select on t_before to public;

-- 1. A real change by the worker's own role signals once; a no-op update doesn't.
set local role cv_worker;
update public.cvs set status = 'extracting' where id = (select cv from t_ids);
update public.cvs set status = 'extracting' where id = (select cv from t_ids);
update public.github_connections set scan_status = 'ready' where member_id = (select a from t_ids);
reset role;

do $$
declare v record; n int; p jsonb;
begin
  select * into v from t_ids;
  select count(*), max(payload::text)::jsonb into n, p from realtime.messages
   where topic = 'member:' || v.a and event = 'progress' and private and payload->>'kind' = 'cv';
  if n <> 1 then raise exception 'cv status: expected 1 signal, got %', n; end if;
  if p->>'kind' <> 'cv' then raise exception 'cv status: wrong kind %', p; end if;
  if p ? 'status' then raise exception 'payload must not carry the status: %', p; end if;
end $$;

-- 2. Suggestions signal on change; GitHub status (updated by cv_worker in 1) too.
update public.profiles set cv_suggested_skill_ids = '{1}' where id = (select a from t_ids);
do $$
declare n int;
begin
  select count(*) into n from realtime.messages
   where topic = 'member:' || (select a from t_ids) and payload->>'kind' = 'cv_suggestions';
  if n <> 1 then raise exception 'cv_suggestions: expected 1 signal, got %', n; end if;
  select count(*) into n from realtime.messages
   where topic = 'member:' || (select a from t_ids) and payload->>'kind' = 'github';
  if n <> 1 then raise exception 'github: expected 1 signal (from cv_worker), got %', n; end if;
end $$;

-- 2b. An AI turn's revision bump signals with the turn id. The runner (ai_service)
-- writes turns only through SECURITY DEFINER exec_* functions, so the trigger
-- runs as their owner; a direct update here is the same path.
create temp table t_turn (id uuid);
grant select on t_turn to public;
do $$
declare v_conv uuid; v_turn uuid;
begin
  insert into ai_private.conversations (owner_id, mode) values ((select a from t_ids), 'network') returning id into v_conv;
  insert into ai_private.turns (conversation_id, owner_id, mode, kind, idempotency_key, body_digest, expected_revision, status)
  values (v_conv, (select a from t_ids), 'network', 'run', 'pb-key-0001', 'd', 0, 'queued') returning id into v_turn;
  insert into t_turn values (v_turn);
end $$;
update ai_private.turns set status = 'running', revision = revision + 1 where id = (select id from t_turn);
do $$
declare n int;
begin
  select count(*) into n from realtime.messages
   where topic = 'member:' || (select a from t_ids) and payload->>'kind' = 'ai_turn'
     and payload->>'turn' = (select id from t_turn)::text;
  if n <> 1 then raise exception 'ai_turn: expected 1 signal (revision bump), got %', n; end if;
end $$;

-- 3. Receive: own topic yes, someone else's no; send: never.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select b from t_ids), 'role', 'authenticated')::text, true);
select set_config('realtime.topic', 'member:' || (select a from t_ids), true);
do $$
begin
  if exists (select 1 from realtime.messages where topic = 'member:' || (select a from t_ids)) then
    raise exception 'member B can read member A''s progress topic';
  end if;
end $$;

select set_config('realtime.topic', 'member:' || (select b from t_ids), true);
do $$
begin
  begin
    insert into realtime.messages (topic, extension, event, payload, private)
    values ('member:' || (select b from t_ids), 'broadcast', 'progress', '{"kind":"cv"}', true);
    raise exception 'member could send on their own progress topic';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select a from t_ids), 'role', 'authenticated')::text, true);
select set_config('realtime.topic', 'member:' || (select a from t_ids), true);
do $$
begin
  if not exists (select 1 from realtime.messages where topic = 'member:' || (select a from t_ids)) then
    raise exception 'member A cannot read their own progress topic';
  end if;
end $$;
reset role;

-- 4. The trigger function is not callable by clients.
do $$
begin
  if has_function_privilege('authenticated', 'public.tg_broadcast_member_progress()', 'execute')
     or has_function_privilege('anon', 'public.tg_broadcast_member_progress()', 'execute') then
    raise exception 'tg_broadcast_member_progress is executable by a client role';
  end if;
end $$;

select 'progress_broadcasts: all assertions passed' as result;
rollback;
