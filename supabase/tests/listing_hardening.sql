-- ════════════════════════════════════════════════════════════════════
-- Foundry · Listing hardening (adversarial sweep F1-F8)
--
-- Regression tests for the bugs found by the 2026-10-27 adversarial
-- sweep (tasks/e2e-adversarial-sweep.md). Each section was written to
-- FAIL against the unfixed schema and pass once the fix lands.
--
-- Same conventions as adversarial_edges.sql: assertions are
-- `raise exception 'FAIL(..)'`, success is SILENT, the whole file rolls
-- back. Exit 0 with no output means every assertion held.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/listing_hardening.sql
-- ════════════════════════════════════════════════════════════════════

begin;

set local role postgres;

create temporary table _ctx (k text primary key, v uuid) on commit drop;

create or replace function _set_caller(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function _as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
end;
$$;

-- ─── Seed: one approved member, one approved admin ───────────────────
do $$
declare
  v_member uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
    (v_member, 'lh-member@imperial.ac.uk', '{"first_name":"Lh","surname":"Member","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb),
    (v_admin,  'lh-admin@imperial.ac.uk',  '{"first_name":"Lh","surname":"Admin","role":"student"}'::jsonb,  '{"provider":"email"}'::jsonb)
  on conflict do nothing;

  insert into public.profiles (id, role, status, first_name, surname, course, grad_year) values
    (v_member, 'student', 'approved', 'Lh', 'Member', 'MEng Computing', 2027),
    (v_admin,  'student', 'approved', 'Lh', 'Admin',  'MSc Physics',    2026)
  on conflict (id) do update set status = excluded.status, course = excluded.course, grad_year = excluded.grad_year;

  insert into public.admins (user_id) values (v_admin) on conflict do nothing;

  insert into _ctx values ('member', v_member), ('admin', v_admin);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- F1. Non-finite and absurd event dates are refused at the RPC, and the
--     table refuses them even if an RPC forgets.
-- ═════════════════════════════════════════════════════════════════════
do $$
declare
  v_member uuid := (select v from _ctx where k = 'member');
  v_admin  uuid := (select v from _ctx where k = 'admin');
  v_ev     uuid;
  v_ver    bigint;
  v_bad    timestamptz;
  v_label  text;
begin
  -- Positive control: a sensible future date still goes through, so a
  -- guard that refuses everything cannot pass this file.
  perform _set_caller(v_member);
  v_ev := public.submit_event('F1 control event', 'A perfectly ordinary event description.',
            'https://lu.ma/f1-control', now() + interval '30 days', 'Imperial, SW7', 'Society', 'e@example.com', false);
  if v_ev is null then raise exception 'FAIL(F1): control submit_event returned null'; end if;

  for v_label, v_bad in
    select * from (values
      ('infinity',        'infinity'::timestamptz),
      ('-infinity',       '-infinity'::timestamptz),
      ('year 2100',       '2100-01-01T00:00:00Z'::timestamptz),
      ('year 9999',       '9999-12-31T00:00:00Z'::timestamptz),
      ('6 years ahead',   now() + interval '6 years')
    ) t(l, b)
  loop
    -- submit_event
    perform _set_caller(v_member);
    begin
      perform public.submit_event('F1 ' || v_label, 'A perfectly ordinary event description.',
                'https://lu.ma/f1', v_bad, 'Imperial, SW7', 'Society', 'e@example.com', false);
      raise exception 'FAIL(F1): submit_event accepted event_at = %', v_label;
    exception when sqlstate '22023' then null;
    end;

    -- update_event on the member's own pending event
    perform _as_service();
    select edit_version into v_ver from public.events where id = v_ev;
    perform _set_caller(v_member);
    begin
      perform public.update_event(v_ev, 'F1 control event', 'A perfectly ordinary event description.',
                'https://lu.ma/f1-control', v_bad, 'Imperial, SW7', 'Society', 'e@example.com', false, v_ver);
      raise exception 'FAIL(F1): update_event accepted event_at = %', v_label;
    exception when sqlstate '22023' then null;
    end;

    -- admin_create_event
    perform _set_caller(v_admin);
    begin
      perform public.admin_create_event('F1 admin ' || v_label, 'A perfectly ordinary event description.',
                'https://lu.ma/f1-admin', v_bad, 'Imperial, SW7', 'Society', 'e@example.com', false, false);
      raise exception 'FAIL(F1): admin_create_event accepted event_at = %', v_label;
    exception when sqlstate '22023' then null;
    end;
  end loop;

  -- The table is the last line of defence: a direct write that skips
  -- every RPC must still be refused.
  perform _as_service();
  set local role postgres;
  begin
    update public.events set event_at = 'infinity' where id = v_ev;
    raise exception 'FAIL(F1): the events table accepted event_at = infinity';
  exception when check_violation then null;
  end;

  -- And nothing leaked in from the loop above.
  if (select count(*) from public.events where title like 'F1 %' and title <> 'F1 control event') <> 0 then
    raise exception 'FAIL(F1): a refused submission still left a row behind';
  end if;
end;
$$;


-- ═════════════════════════════════════════════════════════════════════
-- Helpers for the sections below: call an RPC as the member and return the
-- SQLSTATE it raised ('00000' when it succeeded).
-- ═════════════════════════════════════════════════════════════════════
create or replace function _state(p_sql text, p_caller uuid) returns text
language plpgsql as $f$
declare
  v_state text := '00000';
begin
  begin
    perform _set_caller(p_caller);
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  -- Leave the session as we found it, so the caller can read _ctx again.
  perform _as_service();
  return v_state;
end;
$f$;

create or replace function _opp(p_caller uuid, p_title text default 'Valid role', p_deadline date default null,
                                p_email text default 'hire@example.com', p_skills smallint[] default '{}',
                                p_year integer default null) returns text
language plpgsql as $f$
begin
  return _state(format($q$select public.submit_opportunity(%L, 'Sweep Ltd', '£15/hr', 'remote', null,
      'A perfectly ordinary description of a perfectly ordinary role.', 6::smallint, %s, %L::date,
      %L, false, 'link', 'https://example.com/apply', %L::smallint[], '{}'::smallint[], 'both')$q$,
      p_title, coalesce(p_year, extract(year from now())::int + 1), coalesce(p_deadline, current_date + 30), p_email, p_skills), p_caller);
end;
$f$;

create or replace function _evt(p_caller uuid, p_title text default 'Valid event', p_email text default 'ev@example.com') returns text
language plpgsql as $f$
begin
  return _state(format($q$select public.submit_event(%L, 'A perfectly ordinary event description.', 'https://lu.ma/x',
      now() + interval '20 days', 'Imperial, SW7', 'Society', %L, false)$q$, p_title, p_email), p_caller);
end;
$f$;

create or replace function _vc(p_caller uuid, p_name text default 'Valid fund', p_deadline text default null) returns text
language plpgsql as $f$
begin
  return _state(format($q$select public.submit_vc_grant('vc', %L, 'A perfectly ordinary fund description.',
      'https://example.com/fund', '£50k', %L::date, 'pre-seed')$q$, p_name, p_deadline), p_caller);
end;
$f$;

-- ═════════════════════════════════════════════════════════════════════
-- F5. The wording the app maps to "already handled" is pinned here: if an
--     RPC reword drops it, the admin who loses a race sees a generic error
--     again (supabaseErrors.ts ALREADY_HANDLED).
-- ═════════════════════════════════════════════════════════════════════
do $$
declare
  v_member uuid := (select v from _ctx where k = 'member');
  v_admin  uuid := (select v from _ctx where k = 'admin');
  v_ev     uuid;
  v_ver    bigint;
  v_msg    text;
  v_state  text;
begin
  perform _set_caller(v_member);
  v_ev := public.submit_event('F5 race event', 'A perfectly ordinary event description.',
            'https://lu.ma/f5', now() + interval '10 days', 'Imperial, SW7', 'Society', 'e@example.com', false);
  perform _as_service();
  select edit_version into v_ver from public.events where id = v_ev;

  perform _set_caller(v_admin);
  perform public.approve_event(v_ev, null, v_ver);          -- the winner
  begin
    perform public.approve_event(v_ev, null, v_ver);        -- the loser
    raise exception 'FAIL(F5): a second approve succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_state := sqlstate;
  end;
  if v_state <> 'P0001' or v_msg !~ ' is not pending review \(status=' then
    raise exception 'FAIL(F5): loser got % / %, the app maps P0001 "... is not pending review (status=" only', v_state, v_msg;
  end if;

  begin
    perform public.approve_event(gen_random_uuid(), null, 0);
    raise exception 'FAIL(F5): approving a missing event succeeded';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_state := sqlstate;
  end;
  if v_state <> 'P0001' or v_msg !~ '^[A-Za-z/ ]+ not found: ' then
    raise exception 'FAIL(F5): missing event got % / %, the app maps P0001 "... not found: " only', v_state, v_msg;
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- F6. A member cannot park unlimited submissions in the review queue,
--     even when the Upstash limiter is off (local, or fail-open in prod).
-- ═════════════════════════════════════════════════════════════════════
do $$
declare
  v_other uuid := gen_random_uuid();
  v_i int;
  v_last text;
begin
  perform _as_service();
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_other, 'lh-flood@imperial.ac.uk', '{"first_name":"Lh","surname":"Flood","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb);
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year)
  values (v_other, 'student', 'approved', 'Lh', 'Flood', 'MEng Computing', 2027)
  on conflict (id) do update set status = 'approved', course = 'MEng Computing', grad_year = 2027;
  insert into _ctx values ('flood', v_other);

  for v_i in 1..10 loop
    if _opp(v_other, 'Role ' || v_i) <> '00000' then raise exception 'FAIL(F6): opportunity % within the cap was refused', v_i; end if;
    if _evt(v_other, 'Event ' || v_i) <> '00000' then raise exception 'FAIL(F6): event % within the cap was refused', v_i; end if;
    if _vc(v_other, 'Fund ' || v_i) <> '00000' then raise exception 'FAIL(F6): vc % within the cap was refused', v_i; end if;
  end loop;

  v_last := _opp(v_other, 'Role 11');
  if v_last <> '22023' then raise exception 'FAIL(F6): 11th pending opportunity gave %, want 22023', v_last; end if;
  v_last := _evt(v_other, 'Event 11');
  if v_last <> '22023' then raise exception 'FAIL(F6): 11th pending event gave %, want 22023', v_last; end if;
  v_last := _vc(v_other, 'Fund 11');
  if v_last <> '22023' then raise exception 'FAIL(F6): 11th pending vc gave %, want 22023', v_last; end if;

  -- The cap is per member and per kind: someone else is unaffected, and
  -- approving one frees a slot.
  if _opp((select v from _ctx where k = 'member'), 'Unaffected role') <> '00000' then
    raise exception 'FAIL(F6): the cap leaked to another member';
  end if;
  perform _as_service();
  update public.opportunities set status = 'approved', approved_at = now(), approved_by = (select v from _ctx where k = 'admin')
   where id = (select id from public.opportunities where posted_by = v_other order by created_at limit 1);
  if _opp(v_other, 'Role after approval') <> '00000' then
    raise exception 'FAIL(F6): approving a listing did not free a slot';
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- F7. user_listing_actions can never hold a row for a listing that is gone:
--     the insert takes a share lock on the listing, so a concurrent delete
--     serialises with it (and the delete's cleanup trigger then removes it).
--     The two-session race itself is in e2e/adversarial/concurrency.spec.ts.
-- ═════════════════════════════════════════════════════════════════════
do $$
declare
  v_member uuid := (select v from _ctx where k = 'member');
  v_state text;
  v_opp uuid;
begin
  perform _as_service();
  set local role postgres;
  begin
    insert into public.user_listing_actions (user_id, listing_kind, listing_id, action_type)
    values (v_member, 'opportunity', gen_random_uuid(), 'applied');
    raise exception 'FAIL(F7): a user_listing_actions row for a nonexistent listing was stored';
  exception when sqlstate 'P0002' then null;
  end;

  -- The legitimate path still works, and deleting the listing cleans up.
  select id into v_opp from public.opportunities where posted_by = v_member limit 1;
  if v_opp is null then
    perform _opp(v_member, 'F7 role');
    select id into v_opp from public.opportunities where posted_by = v_member limit 1;
  end if;
  insert into public.user_listing_actions (user_id, listing_kind, listing_id, action_type)
  values (v_member, 'opportunity', v_opp, 'applied');
  delete from public.opportunities where id = v_opp;
  if exists (select 1 from public.user_listing_actions where listing_id = v_opp) then
    raise exception 'FAIL(F7): deleting a listing left its action row behind';
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- F8. Values that are technically accepted but nonsensical or hostile.
-- ═════════════════════════════════════════════════════════════════════
do $$
declare
  v_member uuid := (select v from _ctx where k = 'member');
  v_ids smallint[];
  v_r text;
begin
  -- control
  if _opp(v_member, 'Control role F8') <> '00000' then raise exception 'FAIL(F8): control opportunity refused'; end if;

  -- blank-looking titles (whitespace, zero-width) are refused for every kind
  foreach v_r in array array[E'   ', E'\t\n ', E'\u200b\u200b\u200b', E'\ufeff\u2060'] loop
    if _opp(v_member, v_r) = '00000' then raise exception 'FAIL(F8): blank opportunity title % accepted', quote_literal(v_r); end if;
    if _evt(v_member, v_r) = '00000' then raise exception 'FAIL(F8): blank event title % accepted', quote_literal(v_r); end if;
    if _vc(v_member, v_r) = '00000' then raise exception 'FAIL(F8): blank vc name % accepted', quote_literal(v_r); end if;
  end loop;

  -- oversized contact email (RFC 5321 caps an address at 254)
  v_r := repeat('x', 250) || '@example.com';
  if _opp(v_member, 'Long email role', null, v_r) = '00000' then raise exception 'FAIL(F8): 262-char contact email accepted (opportunity)'; end if;
  if _evt(v_member, 'Long email event', v_r) = '00000' then raise exception 'FAIL(F8): 262-char contact email accepted (event)'; end if;

  -- absurd opportunity deadline
  if _opp(v_member, 'Far deadline', date '9999-12-31') = '00000' then raise exception 'FAIL(F8): deadline in year 9999 accepted'; end if;

  -- VC deadline: past refused, today and later accepted, blank (rolling) accepted
  if _vc(v_member, 'Past deadline fund', (current_date - 1)::text) <> '22023' then raise exception 'FAIL(F8): past VC deadline not refused with 22023'; end if;
  if _vc(v_member, 'Far deadline fund', '9999-12-31') = '00000' then raise exception 'FAIL(F8): VC deadline in year 9999 accepted'; end if;
  if _vc(v_member, 'Rolling fund', null) <> '00000' then raise exception 'FAIL(F8): a rolling (no-deadline) VC was refused'; end if;
  if _vc(v_member, 'Today fund', current_date::text) <> '00000' then raise exception 'FAIL(F8): a VC closing today was refused'; end if;

  -- skills: more than 50 refused with a readable sentence; a nonexistent id
  -- is a foreign-key failure the app already words as "no longer exists"
  select array_agg(id::smallint) into v_ids from (select id from public.skills order by id limit 60) s;
  if _opp(v_member, 'Many skills role', null, 'hire@example.com', v_ids) <> '22023' then
    raise exception 'FAIL(F8): 60 skill ids not refused with 22023';
  end if;
  if _opp(v_member, 'Ghost skill role', null, 'hire@example.com', array[32000]::smallint[]) = '00000' then
    raise exception 'FAIL(F8): a nonexistent skill id was accepted';
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- D-1. A retried submit (the first reply was lost) returns the listing that
--      already exists. Any changed field, or another member, is a new row.
-- ═════════════════════════════════════════════════════════════════════
do $$
declare
  v_me    uuid := (select v from _ctx where k = 'member');
  v_other uuid := gen_random_uuid();
  v_when  timestamptz := now() + interval '10 days';
  v_a uuid; v_b uuid; v_c uuid;
  v_s1 smallint; v_s2 smallint;
  v_deadline date := current_date + 20;
begin
  perform _as_service();
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_other, 'lh-d1@imperial.ac.uk', '{"first_name":"Lh","surname":"Dee","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb);
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year)
  values (v_other, 'student', 'approved', 'Lh', 'Dee', 'MEng Computing', 2027)
  on conflict (id) do update set status = 'approved', course = 'MEng Computing', grad_year = 2027;
  select id into v_s1 from public.skills order by id limit 1;
  select id into v_s2 from public.skills order by id offset 1 limit 1;

  -- events
  perform _set_caller(v_me);
  v_a := public.submit_event('D1 event', 'A perfectly ordinary event description.', 'https://lu.ma/d1', v_when, 'Hall', 'Org', null, false);
  v_b := public.submit_event('D1 event', 'A perfectly ordinary event description.', 'https://lu.ma/d1', v_when, 'Hall', 'Org', null, false);
  if v_a is distinct from v_b then raise exception 'FAIL(D-1): an identical event retry created a second row'; end if;
  v_c := public.submit_event('D1 event', 'A perfectly ordinary event description, corrected.', 'https://lu.ma/d1', v_when, 'Hall', 'Org', null, false);
  if v_c = v_a then raise exception 'FAIL(D-1): a corrected event was swallowed by the earlier one'; end if;
  perform _set_caller(v_other);
  v_c := public.submit_event('D1 event', 'A perfectly ordinary event description.', 'https://lu.ma/d1', v_when, 'Hall', 'Org', null, false);
  if v_c = v_a then raise exception 'FAIL(D-1): another member received this member''s event id'; end if;

  -- vc / grants
  perform _set_caller(v_me);
  v_a := public.submit_vc_grant('vc', 'D1 fund', 'A perfectly ordinary fund description.', 'https://example.com/d1', ' £1m ', null, null);
  v_b := public.submit_vc_grant('vc', 'D1 fund', 'A perfectly ordinary fund description.', 'https://example.com/d1', '£1m', null, '');
  if v_a is distinct from v_b then raise exception 'FAIL(D-1): an identical vc retry (whitespace-equivalent) created a second row'; end if;
  v_c := public.submit_vc_grant('vc', 'D1 fund', 'A perfectly ordinary fund description.', 'https://example.com/d1', '£2m', null, null);
  if v_c = v_a then raise exception 'FAIL(D-1): a vc with a changed amount was swallowed'; end if;

  -- opportunities, including the skill set
  v_a := public.submit_opportunity('D1 role', 'Sweep Ltd', '£15/hr', 'remote', null, 'A perfectly ordinary description of a perfectly ordinary role.',
                                   1::smallint, 2028, v_deadline, 'hiring@example.com', false, 'link', 'https://example.com/apply',
                                   array[v_s2, v_s1, v_s1]::smallint[], null::smallint[], 'both');
  v_b := public.submit_opportunity('D1 role', 'Sweep Ltd', '£15/hr', 'remote', null, 'A perfectly ordinary description of a perfectly ordinary role.',
                                   1::smallint, 2028, v_deadline, 'hiring@example.com', false, 'link', 'https://example.com/apply',
                                   array[v_s1, v_s2]::smallint[], null::smallint[], 'both');
  if v_a is distinct from v_b then raise exception 'FAIL(D-1): an identical opportunity retry (same skill set, different order) created a second row'; end if;
  v_c := public.submit_opportunity('D1 role', 'Sweep Ltd', '£15/hr', 'remote', null, 'A perfectly ordinary description of a perfectly ordinary role.',
                                   1::smallint, 2028, v_deadline, 'hiring@example.com', false, 'link', 'https://example.com/apply',
                                   array[v_s1]::smallint[], null::smallint[], 'both');
  if v_c = v_a then raise exception 'FAIL(D-1): an opportunity with a different skill set was swallowed'; end if;

  perform _as_service();
  if (select count(*) from public.opportunities where posted_by = v_me and position_name = 'D1 role') <> 2 then
    raise exception 'FAIL(D-1): expected exactly 2 D1 opportunities (original + different skills)';
  end if;
  -- Only PENDING rows are matched: once approved, the same content is a new submission.
  update public.opportunities set status = 'approved', approved_at = now(), approved_by = (select v from _ctx where k = 'admin') where id = v_a;
  perform _set_caller(v_me);
  v_b := public.submit_opportunity('D1 role', 'Sweep Ltd', '£15/hr', 'remote', null, 'A perfectly ordinary description of a perfectly ordinary role.',
                                   1::smallint, 2028, v_deadline, 'hiring@example.com', false, 'link', 'https://example.com/apply',
                                   array[v_s1, v_s2]::smallint[], null::smallint[], 'both');
  if v_b = v_a then raise exception 'FAIL(D-1): a resubmission after approval returned the approved row'; end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- Grants. The trigger functions are internal: nobody can call them
-- directly. The recreated RPCs keep exactly the grants they had (members
-- and admins reach them through `authenticated`, never `anon`). Uses
-- has_function_privilege rather than a call (a denied SECURITY DEFINER
-- call crashes the local image on CLI 2.116).
-- ═════════════════════════════════════════════════════════════════════
do $$
declare
  v_fn text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.tg_vcs_grants_deadline()', 'public.tg_cap_opportunity_skills()',
    'public.tg_cap_pending_listings()', 'public.tg_user_listing_actions_listing_exists()'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception 'FAIL(grants): % can execute internal trigger function %', v_role, v_fn;
      end if;
    end loop;
  end loop;

  foreach v_fn in array array[
    'public.submit_event(text, text, text, timestamptz, text, text, text, boolean)',
    'public.update_event(uuid, text, text, text, timestamptz, text, text, text, boolean, bigint)',
    'public.admin_create_event(text, text, text, timestamptz, text, text, text, boolean, boolean)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'FAIL(grants): anon can execute %', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'FAIL(grants): authenticated lost execute on %', v_fn;
    end if;
  end loop;
end;
$$;

set local role postgres;
drop function _state(text, uuid);
drop function _opp(uuid, text, date, text, smallint[], integer);
drop function _evt(uuid, text, text);
drop function _vc(uuid, text, text);
drop function _set_caller(uuid);
drop function _as_service();
rollback;
