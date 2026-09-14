-- ════════════════════════════════════════════════════════════════════
-- Foundry · RLS smoke tests
--
-- Run against a fresh local Supabase (`supabase db reset`) before each
-- production deploy. Asserts the high-impact RLS policies behave as
-- expected. Plain assertions via `do $$ ... raise exception ... $$;`
-- — no test framework needed.
--
-- The pattern: insert seed rows as service_role, then switch to
-- authenticated with a faked sub claim and verify that what the policy
-- *should* let through is visible, and what it *shouldn't* is not.
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/rls_smoke.sql
-- ════════════════════════════════════════════════════════════════════

begin;

-- ─── Seed: two student-ish profiles, two listings, one admin ────────
set local role postgres;

do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_opp_a  uuid := gen_random_uuid();
  v_opp_b  uuid := gen_random_uuid();
begin
  -- Seed as service_role. The *_protect_status triggers fire BEFORE UPDATE
  -- and reject any status change that isn't service_role / is_admin() / the
  -- onboarding GUC. The auth.users inserts below trip the auto-create-profile
  -- trigger, so the profiles upsert lands on its DO UPDATE branch (a status
  -- change) and is otherwise rejected. Faking the service_role JWT claim is
  -- the bypass this file always intended (see header note).
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

  -- Pretend auth.users rows exist for these UUIDs. The real GoTrue
  -- service inserts them; in tests we bypass.
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values
    (v_user_a, 'a@imperial.ac.uk', '{"first_name":"A","surname":"User","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb),
    (v_user_b, 'b@imperial.ac.uk', '{"first_name":"B","surname":"User","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb),
    (v_admin,  'admin@imperial.ac.uk', '{"first_name":"Ad","surname":"Min","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb)
  on conflict do nothing;

  -- The new-user trigger inserts profiles, but if it didn't fire (test
  -- bypass), insert them directly.
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year)
  values
    (v_user_a, 'student', 'approved', 'A', 'User', 'MEng Computing', 2027),
    (v_user_b, 'student', 'approved', 'B', 'User', 'BSc Maths',      2026),
    (v_admin,  'student', 'approved', 'Ad','Min',  'MSc Physics',    2025)
  on conflict (id) do update set
    status     = excluded.status,
    course     = excluded.course,
    grad_year  = excluded.grad_year;

  insert into public.admins (user_id) values (v_admin) on conflict do nothing;

  -- A pending opportunity owned by A, an approved one owned by B.
  -- approved_at / approved_by must be set inline: the opportunities_approval_metadata
  -- CHECK rejects an 'approved' row with null approval metadata, so we can't insert
  -- approved-then-backfill -- the per-row CHECK fires at insert time.
  insert into public.opportunities (
    id, posted_by, status, position_name, company, pay, location_type,
    description, start_month, start_year, application_deadline,
    contact_email, apply_method, approved_at, approved_by
  ) values
    (v_opp_a, v_user_a, 'pending',
     'A''s role', 'Co', '£50k', 'remote',
     'Description that is at least twenty chars long.',
     1, 2027, current_date + 30,
     'a@imperial.ac.uk', 'email', null, null),
    (v_opp_b, v_user_b, 'approved',
     'B''s approved role', 'Co', '£50k', 'remote',
     'Description that is at least twenty chars long.',
     1, 2027, current_date + 30,
     'b@imperial.ac.uk', 'email', now(), v_admin);

  -- Stash UUIDs so the test blocks below can find them.
  create temporary table _test_ctx (k text, v uuid);
  insert into _test_ctx (k, v) values
    ('user_a', v_user_a), ('user_b', v_user_b), ('admin', v_admin),
    ('opp_a', v_opp_a), ('opp_b', v_opp_b);
  -- Test bodies switch to the authenticated role so RLS applies, and that
  -- role leaks into later do-blocks (set_config is transaction-local). Grant
  -- _test_ctx so fixture lookups in those blocks' DECLARE sections still work.
  grant select on _test_ctx to authenticated;
end;
$$;

-- ─── Helper: switch to authenticated with a faked JWT sub ───────────
-- Supabase RLS reads auth.uid() from the JWT. We can fake it by setting
-- request.jwt.claims directly.
create or replace function _set_caller(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

-- ─── Tests ──────────────────────────────────────────────────────────

-- 1. User A can read their own pending listing.
do $$
declare
  v_a   uuid := (select v from _test_ctx where k='user_a');
  v_opa uuid := (select v from _test_ctx where k='opp_a');
  v_seen int;
begin
  perform _set_caller(v_a);
  select count(*) into v_seen from public.opportunities where id = v_opa;
  if v_seen <> 1 then raise exception 'FAIL: user A cannot read own pending listing'; end if;
end;
$$;

-- 2. User A *cannot* read user B's pending listing.
--    (B's opp is approved though, so use a separate pending row.)
do $$
declare
  v_a   uuid := (select v from _test_ctx where k='user_a');
  v_b   uuid := (select v from _test_ctx where k='user_b');
  v_new uuid := gen_random_uuid();
  v_seen int;
begin
  -- 'none' resets to the login superuser; the leaked authenticated role
  -- can't SET ROLE postgres (it isn't a member of it).
  set local role none;
  insert into public.opportunities (
    id, posted_by, status, position_name, company, pay, location_type,
    description, start_month, start_year, application_deadline,
    contact_email, apply_method
  ) values (
    v_new, v_b, 'pending',
    'B''s pending', 'Co', '£50k', 'remote',
    'Description that is at least twenty chars long.',
    1, 2027, current_date + 30,
    'b@imperial.ac.uk', 'email'
  );

  perform _set_caller(v_a);
  select count(*) into v_seen from public.opportunities where id = v_new;
  if v_seen <> 0 then raise exception 'FAIL: user A could read user B''s pending listing'; end if;
end;
$$;

-- 3. User A *cannot* update user B's approved listing (bait-and-switch
--    attempt).
do $$
declare
  v_a   uuid := (select v from _test_ctx where k='user_a');
  v_opb uuid := (select v from _test_ctx where k='opp_b');
  v_count int;
begin
  perform _set_caller(v_a);
  update public.opportunities
     set position_name = 'HIJACKED'
   where id = v_opb;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL: user A updated user B''s approved listing (% rows)', v_count; end if;
end;
$$;

-- 4. User A *cannot* update their own approved listing either (bait-
--    and-switch on own row).
do $$
declare
  v_b   uuid := (select v from _test_ctx where k='user_b');
  v_opb uuid := (select v from _test_ctx where k='opp_b');
  v_count int;
begin
  perform _set_caller(v_b);
  update public.opportunities
     set position_name = 'HIJACKED-OWN'
   where id = v_opb;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL: user B updated own approved listing (% rows)', v_count; end if;
end;
$$;

-- 5. User A *can* update their own pending listing.
do $$
declare
  v_a   uuid := (select v from _test_ctx where k='user_a');
  v_opa uuid := (select v from _test_ctx where k='opp_a');
  v_count int;
begin
  perform _set_caller(v_a);
  update public.opportunities
     set position_name = 'Edited title'
   where id = v_opa;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 1 then raise exception 'FAIL: user A could not edit own pending listing (% rows)', v_count; end if;
end;
$$;

-- 6. Non-admins cannot read the admins table.
do $$
declare
  v_a uuid := (select v from _test_ctx where k='user_a');
  v_seen int;
begin
  perform _set_caller(v_a);
  select count(*) into v_seen from public.admins;
  if v_seen <> 0 then raise exception 'FAIL: non-admin user A could read public.admins'; end if;
end;
$$;

-- 7. Profile status can be changed by an admin but not by the owner.
do $$
declare
  v_a uuid := (select v from _test_ctx where k='user_a');
  v_count int;
begin
  perform _set_caller(v_a);
  begin
    update public.profiles set status = 'rejected' where id = v_a;
    raise exception 'FAIL: user A flipped own profile status without admin context';
  exception
    when sqlstate '42501' then null;  -- expected
  end;
end;
$$;

-- 8. A pending_onboarding user CAN complete onboarding via the RPC.
--    Regression test for the 20260531000003 signature mismatch, where
--    the status-protect trigger required a GUC that the live 9-arg
--    submit_onboarding never set -> every submission failed with 42501
--    ("You don't have permission to do that") for students and alumni
--    alike. Asserts the student path flips pending_onboarding ->
--    approved through the RPC without error.
do $$
declare
  v_new uuid := gen_random_uuid();
  v_status user_status;
begin
  set local role none;  -- reset to the login superuser (see test 2)
  -- Re-assert the service_role seed bypass: prior tests overwrote the JWT
  -- claim via _set_caller, so the upsert below would otherwise be rejected.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_new, 'onboard@imperial.ac.uk',
          '{"first_name":"On","surname":"Board","role":"student"}'::jsonb,
          '{"provider":"email"}'::jsonb)
  on conflict do nothing;
  insert into public.profiles (id, role, status, first_name, surname)
  values (v_new, 'student', 'pending_onboarding', 'On', 'Board')
  on conflict (id) do update set status = excluded.status;

  perform _set_caller(v_new);
  perform public.submit_onboarding(
    p_course        => 'MEng Computing',
    p_grad_year     => 2028,
    p_linkedin_url  => null,
    p_github_url    => null,
    p_portfolio_url => null
  );

  set local role none;  -- reset to the login superuser to read back status
  select status into v_status from public.profiles where id = v_new;
  if v_status <> 'approved' then
    raise exception 'FAIL: student onboarding did not approve (status=%)', v_status;
  end if;
  -- Don't leak the trusted-call GUC into later tests.
  perform set_config('foundry.onboarding_submission', '', true);
end;
$$;

-- 9. get_my_listing_stats counts clicks by DISTINCT viewer, not raw events.
--    Regression test for 20260602000001: record_listing_event lets any
--    authenticated user insert unlimited click events for any listing_id, so
--    count(*) let one member arbitrarily inflate the click total the poster
--    sees on /my-submissions. Here user B fires 3 clicks and the admin fires
--    1 on user A's listing (4 raw events, 2 distinct viewers). Owner A must
--    see click_count = 2. Under the old count(*) this would be 4.
do $$
declare
  v_a    uuid := (select v from _test_ctx where k='user_a');
  v_b    uuid := (select v from _test_ctx where k='user_b');
  v_adm  uuid := (select v from _test_ctx where k='admin');
  v_opa  uuid := (select v from _test_ctx where k='opp_a');
  v_clicks int;
begin
  -- User B clicks through three times (e.g. apply, then contact, then apply).
  perform _set_caller(v_b);
  perform public.record_listing_event('opportunity', v_opa, 'apply_click');
  perform public.record_listing_event('opportunity', v_opa, 'contact_click');
  perform public.record_listing_event('opportunity', v_opa, 'apply_click');

  -- A second distinct viewer (admin) clicks once.
  perform _set_caller(v_adm);
  perform public.record_listing_event('opportunity', v_opa, 'external_click');

  -- Owner A reads their stats: 4 raw click events, 2 distinct viewers.
  perform _set_caller(v_a);
  select click_count into v_clicks
    from public.get_my_listing_stats()
   where listing_id = v_opa;
  if v_clicks is distinct from 2 then
    raise exception 'FAIL: click_count = % (expected 2 distinct viewers; count(*) would give 4)', v_clicks;
  end if;
end;
$$;

-- 10. A user cannot change their own role.
--     Regression test for 20260603000001: profiles.role was user-writable
--     via profiles_update_own, so an alum could flip to 'student' and
--     self-approve through submit_onboarding's role→status map. The
--     role-protect trigger now rejects any non-admin / non-service role
--     change.
do $$
declare
  v_a uuid := (select v from _test_ctx where k='user_a');  -- a student
begin
  perform _set_caller(v_a);
  begin
    update public.profiles set role = 'alum' where id = v_a;
    raise exception 'FAIL: user A changed own role without admin context';
  exception
    when sqlstate '42501' then null;  -- expected: role-protect trigger
  end;
end;
$$;

-- 11. submit_onboarding re-checks the Imperial domain for students.
--     A student whose auth email is non-Imperial (only reachable via a
--     role flip after an alum-style Google signup) cannot self-approve.
do $$
declare
  v_new uuid := gen_random_uuid();
  v_cy  int  := extract(year from now())::int;
begin
  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_new, 'sneaky@gmail.com',
          '{"first_name":"Sn","surname":"Eaky","role":"alum"}'::jsonb,
          '{"provider":"google"}'::jsonb)
  on conflict do nothing;
  -- Flip alum→student + pending_onboarding as service_role (allowed by the
  -- protect triggers). The auth email stays non-Imperial.
  update public.profiles
     set role = 'student', status = 'pending_onboarding'
   where id = v_new;

  perform _set_caller(v_new);
  begin
    perform public.submit_onboarding(
      p_course        => 'MEng Computing',
      p_grad_year     => v_cy + 1,
      p_linkedin_url  => null,
      p_github_url    => null,
      p_portfolio_url => null
    );
    raise exception 'FAIL: non-Imperial student completed onboarding';
  exception
    when sqlstate '42501' then null;  -- expected: domain re-check
  end;
  perform set_config('foundry.onboarding_submission', '', true);
end;
$$;

-- 12. Students must pick a future graduation year (>= current_year + 1).
do $$
declare
  v_new uuid := gen_random_uuid();
  v_cy  int  := extract(year from now())::int;
begin
  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_new, 'stud12@imperial.ac.uk',
          '{"first_name":"St","surname":"Ud","role":"student"}'::jsonb,
          '{"provider":"email"}'::jsonb)
  on conflict do nothing;
  insert into public.profiles (id, role, status, first_name, surname)
  values (v_new, 'student', 'pending_onboarding', 'St', 'Ud')
  on conflict (id) do update set status = excluded.status;

  perform _set_caller(v_new);
  begin
    perform public.submit_onboarding(
      p_course        => 'MEng Computing',
      p_grad_year     => v_cy,          -- not in the future → rejected
      p_linkedin_url  => null,
      p_github_url    => null,
      p_portfolio_url => null
    );
    raise exception 'FAIL: student set a non-future graduation year';
  exception
    when sqlstate '22023' then null;  -- expected: grad-year bound
  end;
  perform set_config('foundry.onboarding_submission', '', true);
end;
$$;

-- 13. Alumni cannot set a future graduation year (> current_year).
do $$
declare
  v_new uuid := gen_random_uuid();
  v_cy  int  := extract(year from now())::int;
begin
  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_new, 'alum13@gmail.com',
          '{"first_name":"Al","surname":"Um","role":"alum"}'::jsonb,
          '{"provider":"google"}'::jsonb)
  on conflict do nothing;
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year, linkedin_url)
  values (v_new, 'alum', 'approved', 'Al', 'Um', 'MEng', v_cy - 1, 'https://linkedin.com/in/alum13')
  on conflict (id) do update set
    status       = excluded.status,
    role         = excluded.role,
    course       = excluded.course,
    grad_year    = excluded.grad_year,
    linkedin_url = excluded.linkedin_url;

  perform _set_caller(v_new);
  begin
    perform public.update_profile(
      p_first_name    => 'Al',
      p_surname       => 'Um',
      p_course        => 'MEng',
      p_grad_year     => v_cy + 1,       -- future → rejected for alumni
      p_linkedin_url  => 'https://linkedin.com/in/alum13',
      p_github_url    => null,
      p_portfolio_url => null
    );
    raise exception 'FAIL: alum set a future graduation year';
  exception
    when sqlstate '22023' then null;  -- expected: grad-year bound
  end;
end;
$$;

-- 14. A non-admin cannot INSERT an event already flagged as a society
--     event (impersonating an official event). The flag-protect trigger
--     (20260603000002) rejects it.
do $$
declare
  v_a uuid := (select v from _test_ctx where k='user_a');
begin
  perform _set_caller(v_a);
  begin
    insert into public.events (
      posted_by, status, title, description, luma_link,
      event_at, location, organiser_name, contact_email, is_society_event
    ) values (
      v_a, 'pending', 'Fake society night',
      'Description that is at least twenty chars long.',
      'https://lu.ma/x', now() + interval '7 days', 'Imperial',
      'A User', 'a@imperial.ac.uk', true
    );
    raise exception 'FAIL: non-admin inserted a society event';
  exception
    when sqlstate '42501' then null;  -- expected: flag-protect trigger
  end;
end;
$$;

-- 15. A non-admin cannot UPDATE their own pending event to set the
--     society flag (the user edit path is a direct PostgREST UPDATE).
do $$
declare
  v_a   uuid := (select v from _test_ctx where k='user_a');
  v_evt uuid := gen_random_uuid();
begin
  -- Seed an ordinary (external) pending event owned by A, as service_role.
  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.events (
    id, posted_by, status, title, description, luma_link,
    event_at, location, organiser_name, contact_email
  ) values (
    v_evt, v_a, 'pending', 'A''s external event',
    'Description that is at least twenty chars long.',
    'https://lu.ma/x', now() + interval '7 days', 'Imperial',
    'A User', 'a@imperial.ac.uk'
  );

  perform _set_caller(v_a);
  begin
    update public.events set is_society_event = true where id = v_evt;
    raise exception 'FAIL: non-admin set the society flag via update';
  exception
    when sqlstate '42501' then null;  -- expected: flag-protect trigger
  end;
end;
$$;

-- 16. admin_create_event with p_is_society_event => true publishes an
--     approved society event, and the flag persists.
do $$
declare
  v_adm uuid := (select v from _test_ctx where k='admin');
  v_new uuid;
  v_flag boolean;
  v_status user_status;
begin
  perform _set_caller(v_adm);
  v_new := public.admin_create_event(
    p_title                 => 'Official Demo Day',
    p_description           => 'Description that is at least twenty chars long.',
    p_luma_link             => 'https://lu.ma/official',
    p_event_at              => now() + interval '14 days',
    p_location              => 'Imperial',
    p_organiser_name        => 'Imperial Entrepreneurs',
    p_contact_email         => 'admin@imperial.ac.uk',
    p_contact_email_visible => false,
    p_is_society_event      => true
  );

  set local role none;  -- read back as the owner
  select is_society_event, status into v_flag, v_status
    from public.events where id = v_new;
  if v_flag is not true then
    raise exception 'FAIL: admin_create_event did not persist the society flag';
  end if;
  if v_status <> 'approved' then
    raise exception 'FAIL: admin_create_event did not auto-approve (status=%)', v_status;
  end if;
end;
$$;

-- 17. submit_event (the member path) produces an EXTERNAL event
--     (is_society_event = false), with no way to opt in.
do $$
declare
  v_b   uuid := (select v from _test_ctx where k='user_b');
  v_new uuid;
  v_flag boolean;
begin
  perform _set_caller(v_b);
  v_new := public.submit_event(
    p_title                 => 'Member meetup',
    p_description           => 'Description that is at least twenty chars long.',
    p_luma_link             => 'https://lu.ma/member',
    p_event_at              => now() + interval '10 days',
    p_location              => 'Online',
    p_organiser_name        => 'B User',
    p_contact_email         => 'b@imperial.ac.uk',
    p_contact_email_visible => false
  );

  set local role none;  -- read back as the owner
  select is_society_event into v_flag from public.events where id = v_new;
  if v_flag is distinct from false then
    raise exception 'FAIL: submit_event produced a non-external event (flag=%)', v_flag;
  end if;
end;
$$;

-- 18. No dead RPC overloads. A `CREATE OR REPLACE FUNCTION` with a drifted
--     signature doesn't replace the old function — it creates a SECOND
--     overload, and the stale one keeps answering. supabase-js `.rpc(name)`
--     calls by name only and can't disambiguate, so ANY duplicate public
--     function name is a latent bug (PostgREST errors with "could not choose
--     the best candidate function"). This guard makes that loud. Extension-
--     owned functions (pgcrypto et al. legitimately overload) are excluded.
set local role postgres;
do $$
declare
  v_dupes text;
begin
  select string_agg(format('%s (%s overloads)', proname, cnt), ', ')
  into v_dupes
  from (
    select p.proname, count(*) as cnt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'  -- skip extension-owned funcs
      )
    group by p.proname
    having count(*) > 1
  ) dupes;

  if v_dupes is not null then
    raise exception
      'FAIL: public function(s) have multiple overloads (supabase-js .rpc() cannot disambiguate — likely a dead CREATE OR REPLACE signature drift): %',
      v_dupes;
  end if;
end;
$$;

-- 19. A non-admin cannot call ANY admin-only RPC. These are SECURITY DEFINER
--     (they bypass RLS by design), so their ONLY gate is the internal
--     is_admin() check, which raises 'Forbidden' with SQLSTATE 42501. This is
--     the "can't reach admin endpoints" guarantee. We assert each raises 42501;
--     a silent success (or any other error) fails the test loudly.
--     `perform * from f(...)` works for both void- and table-returning RPCs.
set local role postgres;
do $$
declare
  v_a   uuid := (select v from _test_ctx where k='user_a');  -- non-admin
  v_b   uuid := (select v from _test_ctx where k='user_b');
  v_opa uuid := (select v from _test_ctx where k='opp_a');
begin
  perform _set_caller(v_a);

  begin
    perform * from public.approve_user(v_b, null);
    raise exception 'FAIL: non-admin called approve_user without being blocked';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform * from public.reject_user(v_b, 'spam');
    raise exception 'FAIL: non-admin called reject_user without being blocked';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform * from public.admin_delete_user(v_b, 'spam');
    raise exception 'FAIL: non-admin called admin_delete_user without being blocked';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform * from public.approve_opportunity(v_opa, null);
    raise exception 'FAIL: non-admin called approve_opportunity without being blocked';
  exception when sqlstate '42501' then null;
  end;

  -- The paginated admin profile RPCs (migration 20260826000004). These
  -- return every member's status and signup email, so the is_admin()
  -- check inside them is the only thing between a member and the
  -- directory of everyone who was ever rejected.
  begin
    perform * from public.admin_list_profiles();
    raise exception 'FAIL: non-admin called admin_list_profiles without being blocked';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform * from public.admin_profile_facets();
    raise exception 'FAIL: non-admin called admin_profile_facets without being blocked';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform * from public.admin_list_pending_profiles();
    raise exception 'FAIL: non-admin called admin_list_pending_profiles without being blocked';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform * from public.reject_opportunity(v_opa, 'spam');
    raise exception 'FAIL: non-admin called reject_opportunity without being blocked';
  exception when sqlstate '42501' then null;
  end;
end;
$$;

-- 20. A user cannot read another user's bookmarks (IDOR on a per-user table).
--     opportunity_bookmarks is select-own-only (user_id = auth.uid()).
set local role postgres;
do $$
declare
  v_a   uuid := (select v from _test_ctx where k='user_a');
  v_b   uuid := (select v from _test_ctx where k='user_b');
  v_opb uuid := (select v from _test_ctx where k='opp_b');
  v_seen int;
begin
  -- Seed a bookmark owned by B (role postgres bypasses RLS for the insert).
  insert into public.opportunity_bookmarks (user_id, opportunity_id)
  values (v_b, v_opb) on conflict do nothing;

  -- As A, B's bookmark must be invisible.
  perform _set_caller(v_a);
  select count(*) into v_seen from public.opportunity_bookmarks where user_id = v_b;
  if v_seen <> 0 then
    raise exception 'FAIL: user A could read user B''s bookmarks (% rows)', v_seen;
  end if;
end;
$$;

-- 21. Function-grant lockdown (regression guard for the whole class of bug).
--     On Supabase the real authz boundary for a function is its in-body check
--     PLUS the named-role grant — `revoke ... from public` alone is a no-op
--     because anon/authenticated hold direct grants. This assertion fails CI
--     if ANY public function outside the intentionally-callable allowlist
--     becomes EXECUTE-able by anon or authenticated (e.g. a future migration
--     that forgets to lock a new internal/cron/trigger function, or relies on
--     `revoke from public`). `has_function_privilege` is authoritative — it
--     accounts for direct grants, the PUBLIC grant, and role membership.
--
--     Every name in the allowlist is reached by the frontend as a user
--     session AND self-defends in-body (is_admin / auth.uid / is_approved),
--     or is an RLS helper (is_admin/is_approved) the policies call. Adding a
--     new user-facing RPC means adding it here on purpose — that deliberate
--     edit is the point of the tripwire.
--
--     Security audit 2026-09-05: the check below this comment only ever
--     asked "is this function reachable by anon OR authenticated" — every
--     name on the allowlist passes that regardless of which role can
--     actually call it, so a function that leaked EXECUTE to anon while
--     self-defending in-body (admin_profile_facets, admin_list_pending_profiles,
--     list_approved_vcs_grants — all fixed in 20260905000003) sat on this
--     allowlist and passed silently. The second assertion below closes
--     that: every allowlisted name except _set_caller (this test's own
--     helper) and is_admin/is_approved (deliberately anon-executable pure
--     predicates, see 20260830000005) is meant for authenticated only,
--     never anon, so it fails CI if any of them regains anon EXECUTE.
set local role postgres;
do $$
declare
  v_allowed text[] := array[
    -- RLS + app helpers (policies call is_admin/is_approved)
    'is_admin','is_approved',
    -- account / profile (user)
    'delete_my_account','update_profile','submit_onboarding',
    -- profile media (user) — avatar/CV upload confirm + removal, added by
    -- 20260901000003. Each self-defends on auth.uid() and verifies an
    -- upload_tickets row before writing.
    'confirm_avatar_upload','remove_my_avatar','confirm_cv_upload','remove_my_cv',
    'get_my_cv_info',
    -- CV-skill suggestion prefill (user), added by 20260901000012 — writes
    -- only the caller's own cv_suggested_skill_ids, same auth.uid() trust
    -- boundary as the other profile-media RPCs above.
    'set_cv_suggested_skills',
    -- profile intake (user), added by 20260901000006 (submit_intake.sql)
    'submit_intake','defer_intake',
    -- LinkedIn setter (user), added by 20260901000013 — writes only the
    -- caller's own linkedin_url, same auth.uid() trust boundary as the
    -- other profile-media RPCs above.
    'set_my_linkedin',
    -- profile media (admin) — moderation + access logging, added by
    -- 20260901000003. Both self-defend on is_admin().
    'admin_clear_avatar','admin_log_cv_access','admin_get_cv_info',
    -- Deliberately granted to `authenticated` by 20260828000004: a member
    -- corrects their own affiliation between the five non-student roles. Its
    -- own guards (never from 'student', never to 'student') are the policy,
    -- and admission_roles.sql is where they are tested.
    'set_my_affiliation',
    -- listing submit / edit (user)
    'submit_opportunity','update_opportunity','submit_event','update_event',
    'submit_vc_grant','update_vc_grant',
    -- admin direct-create
    'admin_create_opportunity','admin_create_event','admin_create_vc_grant',
    -- admin review queues + actions
    'list_pending_opportunities_admin','list_pending_events_admin',
    'approve_opportunity','reject_opportunity','approve_event','reject_event',
    'approve_vc_grant','reject_vc_grant','approve_user','reject_user',
    'admin_delete_user','admin_delete_graduates','admin_get_signup_emails',
    'admin_outbound_email_stats',
    'admin_list_profiles','admin_profile_facets','admin_list_pending_profiles',
    -- committee escalation (20260904000003): admin_set_committee guards on
    -- is_admin() itself; list_committee_cards is the member-readable gallery,
    -- same visibility gate as list_directory_cards.
    'admin_set_committee','list_committee_cards',
    -- public / member reads
    'list_approved_opportunities','list_approved_events',
    'list_approved_vcs_grants',
    'list_directory_cards','list_directory_facets',
    'list_my_bookmarked_opportunities',
    'get_my_activity','get_my_listing_actions','get_my_listing_stats',
    'get_opportunity_for_edit','get_event_for_edit',
    -- listing engagement
    'mark_listing_action','unmark_listing_action','record_listing_event',
    -- community posts (member)
    'posting_enabled','issue_upload_ticket','create_post','delete_my_post',
    'report_post','list_community_feed','list_my_posts','toggle_post_like',
    'get_post_like_counts',
    -- community posts (admin)
    'admin_delete_post','admin_resolve_post_report','admin_list_post_reports',
    -- CV + GitHub matchmaker (20260906000001 / 20260907000001 /
    -- 20260907000004). Every one self-defends on auth.uid() and reads or
    -- writes only the caller's own row; the pipeline-internal functions
    -- (enqueue_*, due_*, mark_*, reap_stalled_jobs) are deliberately
    -- absent and stay service-role only.
    'get_my_cv_status','get_my_cv_profile',
    'get_my_github_status','confirm_github_connected','disconnect_github',
    'get_my_github_showcase','set_my_github_showcase',
    'dismiss_my_github_showcase_prompt','set_my_github_nudges',
    -- post-approval listing revisions (20260907000005). The member pair
    -- self-defends on auth.uid() + ownership of the *listing*, not of the
    -- revision row; the admin four on is_admin(). stage_listing_edit,
    -- apply_listing_edit_payload, listing_snapshot and listing_table_name
    -- are deliberately absent — they are internal, and section 34 asserts
    -- a member cannot reach them.
    'listing_has_pending_edit','get_my_pending_listing_edit',
    'admin_list_listing_edits','admin_apply_listing_edit',
    'admin_reject_listing_edit','admin_update_listing',
    -- ingestion kill switch (20260911000003) — read by the two RPCs above
    -- and by the intake/profile server pages to decide whether to show the
    -- GitHub-connect/CV-upload entry points at all.
    'github_cv_ingestion_enabled',
    -- admin UI toggle for the same switch (20260914000002): granted to
    -- authenticated same as every other admin_* RPC in this list, guarded
    -- by is_admin() inside the function body rather than at the grant —
    -- see section 38's non-admin-forbidden check.
    'admin_get_ingestion_status','admin_set_ingestion_enabled',
    -- this test's OWN role-impersonation helper (created near the top of this
    -- file, dropped in cleanup below). Not an app RPC — it only exists during
    -- the test run, where Supabase default privileges make it anon-callable;
    -- harmless, so it is exempted here rather than being a false leak.
    '_set_caller'
  ];
  v_leaked text;
begin
  select string_agg(distinct p.proname, ', ' order by p.proname)
    into v_leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prokind = 'f'
     -- only our own functions; ignore anything owned by an extension
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e')
     and (has_function_privilege('anon',          p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and not (p.proname = any (v_allowed));
  if v_leaked is not null then
    raise exception
      'FAIL: internal function(s) EXECUTE-able by anon/authenticated: %', v_leaked;
  end if;

  select string_agg(distinct p.proname, ', ' order by p.proname)
    into v_leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.proname = any (v_allowed)
     and p.proname not in ('_set_caller', 'is_admin', 'is_approved')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_leaked is not null then
    raise exception
      'FAIL: authenticated-only function(s) EXECUTE-able by anon: %', v_leaked;
  end if;
end;
$$;

-- ─── 22. admin_create_* RPCs guard against a missing poster profile ──
-- All three insert posted_by = caller, which FK-references profiles(id). A
-- bootstrap admin with no profile row used to get a raw 23503 surfaced to
-- the UI as "That item no longer exists"; migration 20260610000000 added a
-- pre-flight guard that raises a clear message instead. Assert all three
-- still carry it — recreating any of them from an older definition (the
-- dead-overload trap this codebase has hit before) would silently drop it.
set local role postgres;
do $$
declare
  v_guarded int;
begin
  select count(*) into v_guarded
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.proname in ('admin_create_opportunity', 'admin_create_event', 'admin_create_vc_grant')
     and pg_get_functiondef(p.oid) ilike '%does not have a member profile%';
  if v_guarded <> 3 then
    raise exception
      'FAIL: only % of 3 admin_create_* functions carry the no-profile guard', v_guarded;
  end if;
end;
$$;

-- ─── 23. The owner/pending edit split holds for events too ──────────
-- Tests 1-5 assert this for opportunities only. events and vcs_grants have
-- their own ~25 policies each, written by hand in parallel, and nothing was
-- checking that they agree. This is the same five properties against events.
set local role postgres;
do $$
declare
  v_a       uuid := (select v from _test_ctx where k='user_a');
  v_b       uuid := (select v from _test_ctx where k='user_b');
  v_admin   uuid := (select v from _test_ctx where k='admin');
  v_pend_a  uuid := gen_random_uuid();
  v_pend_b  uuid := gen_random_uuid();
  v_appr_b  uuid := gen_random_uuid();
  v_seen    int;
  v_count   int;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.events (
    id, posted_by, status, title, description, luma_link, event_at,
    location, organiser_name, contact_email, approved_at, approved_by
  ) values
    (v_pend_a, v_a, 'pending',  'A''s pending event',
     'Description that is at least twenty chars long.', 'https://lu.ma/a',
     now() + interval '30 days', 'London', 'A User', 'a@imperial.ac.uk', null, null),
    (v_pend_b, v_b, 'pending',  'B''s pending event',
     'Description that is at least twenty chars long.', 'https://lu.ma/b',
     now() + interval '30 days', 'London', 'B User', 'b@imperial.ac.uk', null, null),
    (v_appr_b, v_b, 'approved', 'B''s approved event',
     'Description that is at least twenty chars long.', 'https://lu.ma/c',
     now() + interval '30 days', 'London', 'B User', 'b@imperial.ac.uk', now(), v_admin);

  -- (a) owner reads their own pending row
  perform _set_caller(v_a);
  select count(*) into v_seen from public.events where id = v_pend_a;
  if v_seen <> 1 then raise exception 'FAIL(events): owner cannot read own pending event'; end if;

  -- (b) a non-owner does not
  select count(*) into v_seen from public.events where id = v_pend_b;
  if v_seen <> 0 then raise exception 'FAIL(events): user A could read user B''s pending event'; end if;

  -- (c) a non-owner cannot edit someone else's approved row
  update public.events set title = 'HIJACKED' where id = v_appr_b;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL(events): user A edited user B''s approved event (% rows)', v_count; end if;

  -- (d) nor can the owner, once it is approved (bait-and-switch)
  perform _set_caller(v_b);
  update public.events set title = 'HIJACKED-OWN' where id = v_appr_b;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL(events): owner edited own approved event (% rows)', v_count; end if;

  -- (e) but the owner can edit it while it is still pending
  update public.events set title = 'Edited title' where id = v_pend_b;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 1 then raise exception 'FAIL(events): owner could not edit own pending event (% rows)', v_count; end if;
end;
$$;

-- ─── 24. …and for vcs_grants ────────────────────────────────────────
set local role postgres;
do $$
declare
  v_a       uuid := (select v from _test_ctx where k='user_a');
  v_b       uuid := (select v from _test_ctx where k='user_b');
  v_admin   uuid := (select v from _test_ctx where k='admin');
  v_pend_a  uuid := gen_random_uuid();
  v_pend_b  uuid := gen_random_uuid();
  v_appr_b  uuid := gen_random_uuid();
  v_seen    int;
  v_count   int;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.vcs_grants (
    id, kind, posted_by, status, name, description, link, approved_at, approved_by
  ) values
    (v_pend_a, 'vc',    v_a, 'pending',
     'A''s pending fund', 'Description that is at least twenty chars long.',
     'https://example.com/a', null, null),
    (v_pend_b, 'vc',    v_b, 'pending',
     'B''s pending fund', 'Description that is at least twenty chars long.',
     'https://example.com/b', null, null),
    (v_appr_b, 'grant', v_b, 'approved',
     'B''s approved grant', 'Description that is at least twenty chars long.',
     'https://example.com/c', now(), v_admin);

  perform _set_caller(v_a);
  select count(*) into v_seen from public.vcs_grants where id = v_pend_a;
  if v_seen <> 1 then raise exception 'FAIL(vcs): owner cannot read own pending listing'; end if;

  select count(*) into v_seen from public.vcs_grants where id = v_pend_b;
  if v_seen <> 0 then raise exception 'FAIL(vcs): user A could read user B''s pending listing'; end if;

  update public.vcs_grants set name = 'HIJACKED' where id = v_appr_b;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL(vcs): user A edited user B''s approved listing (% rows)', v_count; end if;

  perform _set_caller(v_b);
  update public.vcs_grants set name = 'HIJACKED-OWN' where id = v_appr_b;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL(vcs): owner edited own approved listing (% rows)', v_count; end if;

  update public.vcs_grants set name = 'Edited name' where id = v_pend_b;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 1 then raise exception 'FAIL(vcs): owner could not edit own pending listing (% rows)', v_count; end if;
end;
$$;

-- ─── 25. Approving a listing takes it out of the owner's edit reach ──
-- The property 6c depends on: whatever mechanism the edit path uses, an
-- approve must close the window. Asserted for all three tables at once so a
-- new listing type can't be added with this policy quietly missing.
set local role postgres;
do $$
declare
  v_a    uuid := (select v from _test_ctx where k='user_a');
  v_adm  uuid := (select v from _test_ctx where k='admin');
  v_opp  uuid := gen_random_uuid();
  v_ev   uuid := gen_random_uuid();
  v_vc   uuid := gen_random_uuid();
  v_count int;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.opportunities (
    id, posted_by, status, position_name, company, pay, location_type,
    description, start_month, start_year, application_deadline,
    contact_email, apply_method
  ) values (v_opp, v_a, 'pending', 'Soon approved', 'Co', '£50k', 'remote',
            'Description that is at least twenty chars long.',
            1, 2027, current_date + 30, 'a@imperial.ac.uk', 'email');
  insert into public.events (
    id, posted_by, status, title, description, luma_link, event_at,
    location, organiser_name, contact_email
  ) values (v_ev, v_a, 'pending', 'Soon approved event',
            'Description that is at least twenty chars long.', 'https://lu.ma/d',
            now() + interval '30 days', 'London', 'A User', 'a@imperial.ac.uk');
  insert into public.vcs_grants (
    id, kind, posted_by, status, name, description, link
  ) values (v_vc, 'vc', v_a, 'pending', 'Soon approved fund',
            'Description that is at least twenty chars long.', 'https://example.com/d');

  -- Approve all three through the real admin RPCs.
  perform _set_caller(v_adm);
  perform public.approve_opportunity(v_opp, null);
  perform public.approve_event(v_ev, null);
  perform public.approve_vc_grant(v_vc, null);

  -- The owner's edit window is now shut on every one of them.
  perform _set_caller(v_a);
  update public.opportunities set position_name = 'TOO LATE' where id = v_opp;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL: owner still edits an approved opportunity (% rows)', v_count; end if;

  update public.events set title = 'TOO LATE' where id = v_ev;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL: owner still edits an approved event (% rows)', v_count; end if;

  update public.vcs_grants set name = 'TOO LATE' where id = v_vc;
  get diagnostics v_count = ROW_COUNT;
  if v_count <> 0 then raise exception 'FAIL: owner still edits an approved VC/grant (% rows)', v_count; end if;
end;
$$;

-- ─── 26. update_event / update_vc_grant enforce their own guards ─────
-- Migration 20260826000001 moved the event and VC/grant edit paths off
-- client-direct PostgREST UPDATEs onto SECURITY DEFINER RPCs, matching
-- update_opportunity. SECURITY DEFINER bypasses RLS, so the in-body
-- ownership + status checks ARE the boundary — tests 23-25 prove the
-- policies are right, and prove nothing about these. Both directions are
-- asserted: the guards reject, and a legitimate edit still succeeds.
--
-- Rejections are checked with a "did it succeed" flag rather than by
-- catching the expected exception. A handler wide enough to catch the RPC's
-- error is also wide enough to swallow the FAIL raise inside the same block,
-- which would turn a broken guard into a silent pass.
set local role postgres;
do $$
declare
  v_a      uuid := (select v from _test_ctx where k='user_a');
  v_b      uuid := (select v from _test_ctx where k='user_b');
  v_adm    uuid := (select v from _test_ctx where k='admin');
  v_ev     uuid := gen_random_uuid();
  v_vc     uuid := gen_random_uuid();
  v_title  text;
  v_name   text;
  v_passed boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.events (
    id, posted_by, status, title, description, luma_link, event_at,
    location, organiser_name, contact_email
  ) values (v_ev, v_a, 'pending', 'RPC guard event',
            'Description that is at least twenty chars long.', 'https://lu.ma/g',
            now() + interval '30 days', 'London', 'A User', 'a@imperial.ac.uk');
  insert into public.vcs_grants (
    id, kind, posted_by, status, name, description, link
  ) values (v_vc, 'vc', v_a, 'pending', 'RPC guard fund',
            'Description that is at least twenty chars long.', 'https://example.com/g');

  -- (a) a non-owner is refused, even though the RPC runs as definer
  perform _set_caller(v_b);
  v_passed := false;
  begin
    perform public.update_event(v_ev, 'HIJACKED',
      'Description that is at least twenty chars long.', 'https://lu.ma/g',
      now() + interval '30 days', 'London', 'B User', 'b@imperial.ac.uk', false);
    v_passed := true;
  exception when others then null;
  end;
  if v_passed then raise exception 'FAIL: update_event let a non-owner through'; end if;

  v_passed := false;
  begin
    perform public.update_vc_grant(v_vc, 'vc', 'HIJACKED',
      'Description that is at least twenty chars long.', 'https://example.com/g',
      null, null, null);
    v_passed := true;
  exception when others then null;
  end;
  if v_passed then raise exception 'FAIL: update_vc_grant let a non-owner through'; end if;

  -- (b) the owner can edit while pending
  perform _set_caller(v_a);
  perform public.update_event(v_ev, 'Edited via RPC',
    'Description that is at least twenty chars long.', 'https://lu.ma/g',
    now() + interval '30 days', 'London', 'A User', 'a@imperial.ac.uk', false);
  perform public.update_vc_grant(v_vc, 'grant', 'Edited via RPC',
    'Description that is at least twenty chars long.', 'https://example.com/g',
    null, null, null);

  set local role none;
  select title into v_title from public.events     where id = v_ev;
  select name  into v_name  from public.vcs_grants where id = v_vc;
  if v_title <> 'Edited via RPC' then raise exception 'FAIL: update_event did not apply the edit (got %)', v_title; end if;
  if v_name  <> 'Edited via RPC' then raise exception 'FAIL: update_vc_grant did not apply the edit (got %)', v_name; end if;

  -- (c) once approved, the same call no longer writes through. Changed
  --     deliberately by 20260907000005: it used to raise, which left a
  --     wrong room number on a live event unfixable by anyone including
  --     an admin. It now stages a revision for review. The property that
  --     actually matters is unchanged and is what is asserted here —
  --     nothing a member types reaches the published row without a human
  --     approving it. Section 34 covers the rest of that path.
  perform _set_caller(v_adm);
  perform public.approve_event(v_ev, null);
  perform public.approve_vc_grant(v_vc, null);

  perform _set_caller(v_a);
  perform public.update_event(v_ev, 'TOO LATE',
    'Description that is at least twenty chars long.', 'https://lu.ma/g',
    now() + interval '30 days', 'London', 'A User', 'a@imperial.ac.uk', false);
  perform public.update_vc_grant(v_vc, 'vc', 'TOO LATE',
    'Description that is at least twenty chars long.', 'https://example.com/g',
    null, null, null);

  set local role none;
  select title into v_title from public.events     where id = v_ev;
  select name  into v_name  from public.vcs_grants where id = v_vc;
  if v_title = 'TOO LATE' then raise exception 'FAIL: update_event published an edit to an approved event'; end if;
  if v_name  = 'TOO LATE' then raise exception 'FAIL: update_vc_grant published an edit to an approved listing'; end if;
  if (select count(*) from public.listing_edits
       where listing_id in (v_ev, v_vc) and status = 'pending') <> 2 then
    raise exception 'FAIL: the approved edits were neither published nor queued for review';
  end if;

  -- A rejected listing still refuses outright: there is nothing
  -- published to revise, so there is nothing to review.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role none;
  update public.vcs_grants set status = 'rejected', rejected_reason = 'test' where id = v_vc;
  perform _set_caller(v_a);
  v_passed := false;
  begin
    perform public.update_vc_grant(v_vc, 'vc', 'TOO LATE',
      'Description that is at least twenty chars long.', 'https://example.com/g',
      null, null, null);
    v_passed := true;
  exception when others then null;
  end;
  if v_passed then raise exception 'FAIL: update_vc_grant edited a rejected listing'; end if;

  -- (d) an event cannot be edited into the past — on either path, which
  --     is why the guard sits above the pending/approved branch.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role none;
  update public.events set status = 'pending', approved_at = null, approved_by = null where id = v_ev;
  perform _set_caller(v_a);
  v_passed := false;
  begin
    perform public.update_event(v_ev, 'Backdated',
      'Description that is at least twenty chars long.', 'https://lu.ma/g',
      now() - interval '2 days', 'London', 'A User', 'a@imperial.ac.uk', false);
    v_passed := true;
  exception when others then null;
  end;
  if v_passed then raise exception 'FAIL: update_event accepted a start time in the past'; end if;
end;
$$;

-- ─── 27. The admin profile lists page, and count what they didn't return ──
--     PostgREST silently truncates any response at max_rows (1000), which
--     is how /admin/members came to show 1000 of however many members
--     there were. The fix only works if two things hold: a page really is
--     capped at p_limit, and total_count reports the whole match rather
--     than the page. If total_count ever tracked the page, the pager would
--     render "Page 1 of 1" over a truncated list — the original bug with a
--     pager bolted on.
set local role postgres;
do $$
declare
  v_adm   uuid := (select v from _test_ctx where k='admin');
  v_seed  uuid;
  v_total bigint;
  v_rows  int;
  v_first text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

  -- 60 extra members: more than one page of 50, few enough to stay fast.
  for i in 1..60 loop
    v_seed := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (v_seed, 'page' || i || '@imperial.ac.uk',
            '{"first_name":"Page","surname":"Member","role":"student"}'::jsonb,
            '{"provider":"email"}'::jsonb)
    on conflict do nothing;
    -- Distinct created_at values, oldest first. now() is the transaction
    -- timestamp, so without this every seeded row shares one and the
    -- oldest-first assertion below would really be testing the uuid
    -- tiebreak.
    insert into public.profiles (id, role, status, first_name, surname, course, grad_year, created_at)
    values (v_seed, 'student',
            (case when i <= 10 then 'pending_review' else 'approved' end)::public.user_status,
            'Page', 'Member' || i, 'MEng Paging', 2027,
            now() - make_interval(mins => 100 - i))
    on conflict (id) do update set
      status = excluded.status, first_name = excluded.first_name,
      surname = excluded.surname, course = excluded.course,
      -- The auto-create-profile trigger has already inserted a bare row, so
      -- this lands on DO UPDATE. grad_year has to come along:
      -- profiles_grad_year_role_consistency rejects an approved student
      -- without one.
      grad_year = excluded.grad_year, created_at = excluded.created_at;
  end loop;

  perform _set_caller(v_adm);

  -- (a) a page is p_limit long, and the count is of everything matching
  select count(*), max(total_count) into v_rows, v_total
    from public.admin_list_profiles(p_limit => 50);
  if v_rows <> 50 then
    raise exception 'FAIL: admin_list_profiles returned % rows for p_limit 50', v_rows;
  end if;
  if v_total < 63 then
    raise exception 'FAIL: total_count reported % — it is counting the page, not the match', v_total;
  end if;

  -- (b) the offset moves the window without changing the total
  select count(*), max(total_count) into v_rows, v_total
    from public.admin_list_profiles(p_limit => 50, p_offset => 50);
  if v_rows = 0 then raise exception 'FAIL: page 2 of admin_list_profiles came back empty'; end if;
  if v_total < 63 then raise exception 'FAIL: total_count changed with the offset (got %)', v_total; end if;

  -- (c) p_limit is clamped, so a crafted ?limit= can't ask for everything
  --     and reintroduce the truncation this migration removed
  select count(*) into v_rows from public.admin_list_profiles(p_limit => 100000);
  if v_rows > 200 then
    raise exception 'FAIL: admin_list_profiles honoured an unclamped p_limit (% rows)', v_rows;
  end if;

  -- (d) filters narrow the count as well as the rows. A filter that
  --     narrowed only the page would page over the unfiltered set.
  select count(*), max(total_count) into v_rows, v_total
    from public.admin_list_profiles(p_statuses => array['pending_review'], p_limit => 50);
  if v_rows <> 10 then
    raise exception 'FAIL: status filter returned % rows, expected 10', v_rows;
  end if;
  if v_total <> 10 then
    raise exception 'FAIL: status filter left total_count at % — filters are not reaching the count', v_total;
  end if;

  -- (e) the search matches the signup email, which only admins can see
  select count(*) into v_rows from public.admin_list_profiles(p_query => 'page7@imperial.ac.uk');
  if v_rows <> 1 then
    raise exception 'FAIL: email search matched % rows, expected 1', v_rows;
  end if;

  -- (f) the review queue is bounded and counts its whole backlog
  select count(*), max(total_count) into v_rows, v_total
    from public.admin_list_pending_profiles(p_limit => 5);
  if v_rows <> 5  then raise exception 'FAIL: pending queue returned % rows for p_limit 5', v_rows; end if;
  if v_total <> 10 then raise exception 'FAIL: pending queue total_count is % , expected 10', v_total; end if;

  -- (g) oldest first — a queue that shows newest first buries the person
  --     who has waited longest
  select surname into v_first from public.admin_list_pending_profiles(p_limit => 1);
  if v_first <> 'Member1' then
    raise exception 'FAIL: pending queue is not oldest-first (first row was %)', v_first;
  end if;

  -- (h) facets span every status, not just approved members — filtering
  --     this page by "rejected" is the point of it
  if not exists (
    select 1 from public.admin_profile_facets() f where 'MEng Paging' = any(f.courses)
  ) then
    raise exception 'FAIL: admin_profile_facets is missing a course that exists on a profile';
  end if;
end;
$$;

-- ─── 28. No admin RPC is callable by `anon` ─────────────────────────
-- Section 21 asserts that nothing outside the allowlist is reachable by
-- anon OR authenticated. The admin RPCs are on that allowlist, and have to
-- be — an admin is an `authenticated` session. This is the tighter claim
-- for that subset: they must not be reachable by `anon` at all.
--
-- Their in-body `is_admin()` already rejects an anonymous caller, so this
-- is defence in depth, not a live hole. It is here because the in-body
-- check is one edit away from being the only thing standing there, and
-- because Supabase's default privileges re-grant EXECUTE to anon every
-- time one of these functions is re-created — so the lock applied by
-- migration 20260827000001 needs something that notices when a later
-- `create or replace` quietly undoes it.
--
-- Matched by NAME, exactly as the migration does, so a signature change
-- cannot slip a function past either of them.
set local role postgres;
do $$
declare
  v_leaked text;
begin
  select string_agg(distinct p.proname, ', ' order by p.proname)
    into v_leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prokind = 'f'
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e')
     and (p.proname ~ '^(admin|approve|reject)_'
          or p.proname in ('list_pending_opportunities_admin',
                           'list_pending_events_admin'))
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_leaked is not null then
    raise exception
      'FAIL: admin RPC(s) EXECUTE-able by anon: %. A re-created function picks up '
      'Supabase''s default grant again — re-apply the revoke from '
      'migration 20260827000001.', v_leaked;
  end if;
end;
$$;

-- And the same functions must still be reachable by a signed-in admin —
-- a revoke that took `authenticated` with it would lock the admin console
-- out, and every in-body check would keep passing while it did.
set local role postgres;
do $$
declare
  v_locked text;
begin
  select string_agg(distinct p.proname, ', ' order by p.proname)
    into v_locked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prokind = 'f'
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e')
     and (p.proname ~ '^(admin|approve|reject)_'
          or p.proname in ('list_pending_opportunities_admin',
                           'list_pending_events_admin'))
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_locked is not null then
    raise exception
      'FAIL: admin RPC(s) no longer EXECUTE-able by authenticated: % — the revoke '
      'took the admin console with it', v_locked;
  end if;
end;
$$;

-- ─── 29. The analytics write path is bounded and gated ──────────────
-- record_listing_event is reached client-direct from the browser, so it
-- never passes through the middleware and no rate-limit bucket sees it.
-- Its own two guards are therefore the only ones there: it must be
-- idempotent (or one account can grow the largest table without limit),
-- and it must require an approved member (a ban is status='rejected',
-- and an already-issued JWT keeps working for up to an hour after one).
set local role postgres;
do $$
declare
  v_member   uuid;
  v_rejected uuid;
  v_listing  uuid;
  v_rows     int;
begin
  select id into v_member   from public.profiles where status = 'approved' limit 1;
  select id into v_rejected from public.profiles where status = 'rejected' limit 1;
  select id into v_listing  from public.opportunities where status = 'approved' limit 1;
  if v_member is null or v_listing is null then
    raise exception 'FAIL: fixture missing (approved profile / approved opportunity)';
  end if;

  -- (a) idempotent: the same view recorded repeatedly is one row
  perform _set_caller(v_member);
  perform public.record_listing_event('opportunity', v_listing, 'expand');
  perform public.record_listing_event('opportunity', v_listing, 'expand');
  perform public.record_listing_event('opportunity', v_listing, 'expand');

  set local role postgres;
  select count(*) into v_rows
    from public.listing_events
   where listing_kind = 'opportunity' and listing_id = v_listing
     and viewer_id = v_member and event_type = 'expand';
  if v_rows <> 1 then
    raise exception
      'FAIL: record_listing_event wrote % rows for one repeated view — it is unbounded again', v_rows;
  end if;

  -- (b) a rejected (banned) member cannot write at all
  if v_rejected is not null then
    perform _set_caller(v_rejected);
    begin
      perform public.record_listing_event('opportunity', v_listing, 'expand');
      set local role postgres;
      raise exception 'FAIL: a rejected member recorded an analytics event';
    exception when insufficient_privilege then
      null; -- expected
    end;
  end if;
  set local role postgres;
end;
$$;

-- ─── 30. The email-change log is service-role only, and cascades ────
-- It holds former email addresses, which is PII this project otherwise
-- keeps very sparingly (reject_user deletes the whole account and retains
-- only the rejection reason). Two things therefore have to hold, and the
-- second is the one most likely to be quietly wrong.
set local role postgres;
do $$
declare
  v_member uuid;
  v_other  uuid;
  v_rows   int;
  v_uid    uuid := gen_random_uuid();
begin
  select id into v_member from public.profiles where status = 'approved' limit 1;
  select id into v_other  from public.profiles where id <> v_member limit 1;
  if v_member is null then
    raise exception 'FAIL: fixture missing (approved profile)';
  end if;

  -- Seed a row directly; the trigger's own behaviour is covered by the E2E,
  -- which drives a real email change through GoTrue.
  insert into public.email_change_log (user_id, old_email, new_email)
  values (v_member, 'was@imperial.ac.uk', 'now@imperial.ac.uk');

  -- (a) a member cannot read the log — not their own row, not anyone's.
  --     This is a hard permission denial rather than an RLS-filtered empty
  --     result, because the grants are revoked as well as RLS being on.
  --     That is the stronger of the two: adding a careless policy later
  --     still would not open it, since the table grant is gone too.
  perform _set_caller(v_member);
  begin
    select count(*) into v_rows from public.email_change_log;
    set local role postgres;
    raise exception
      'FAIL: an authenticated member read email_change_log (% rows) — it holds former addresses', v_rows;
  exception when insufficient_privilege then
    null; -- expected
  end;

  -- (b) nor can they write one, which would let anyone forge the record an
  --     admin uses to identify a locked-out member.
  begin
    insert into public.email_change_log (user_id, old_email, new_email)
    values (v_member, 'forged@imperial.ac.uk', 'attacker@example.com');
    set local role postgres;
    raise exception 'FAIL: an authenticated member inserted into email_change_log';
  exception when insufficient_privilege then
    null; -- expected
  end;

  -- (c) deleting the account takes its history with it. Without this the
  --     deletion paths stop being complete deletions and the table becomes
  --     a quiet archive of people who asked to be forgotten.
  set local role postgres;
  insert into auth.users (id, instance_id, email, aud, role)
  values (v_uid, '00000000-0000-0000-0000-000000000000', 'cascade@imperial.ac.uk', 'authenticated', 'authenticated');
  insert into public.email_change_log (user_id, old_email, new_email)
  values (v_uid, 'cascade@imperial.ac.uk', 'cascade-new@imperial.ac.uk');

  delete from auth.users where id = v_uid;

  select count(*) into v_rows from public.email_change_log where user_id = v_uid;
  if v_rows <> 0 then
    raise exception
      'FAIL: % email_change_log row(s) survived the account being deleted', v_rows;
  end if;
end;
$$;

-- ─── 31. Community posts: authorisation, retention, and the audit trail ──
-- The Community feed is the only content type here that publishes without
-- review, so the guarantees below are the whole safety model. Each block
-- asserts one of them.
--
-- Note on role switching: upload_tickets, post_reports, post_moderation_log
-- and blob_deletion_queue are deny-all to `authenticated`, so any check that
-- reads them has to run as the owner role. That this is necessary is itself
-- the assertion in 31f.
set local role postgres;

-- 31a. The kill switch actually gates creation, and defaults closed.
do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  delete from public.app_config where key = 'community_posts_enabled';

  perform _set_caller((select id from public.profiles where status='approved' limit 1));
  begin
    perform public.create_post('A blocked title', 'body text');
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: create_post succeeded with no community_posts_enabled row (must default closed)';
  end if;

  set local role postgres;
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  insert into public.app_config (key, value) values ('community_posts_enabled','true')
  on conflict (key) do update set value = 'true';
end;
$$;

-- 31b. An upload ticket is single-use and bound to the member it was issued
--      to. Without this, a client could attach another member's image to its
--      own post.
do $$
declare
  v_a uuid; v_b uuid; v_key text; v_ok boolean := false;
begin
  set local role postgres;
  select id into v_a from public.profiles where status='approved' order by created_at limit 1;
  select id into v_b from public.profiles where status='approved' and id <> v_a order by created_at limit 1;

  perform _set_caller(v_b);
  v_key := public.issue_upload_ticket('post_image');

  perform _set_caller(v_a);
  begin
    perform public.create_post('Ticket theft', 'body text',
      jsonb_build_array(jsonb_build_object(
        'blob_key', v_key, 'alt_text','x','width',10,'height',10,'byte_size',10)));
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: a member consumed another member''s upload ticket';
  end if;
end;
$$;

-- 31c. Only the author may delete their own post.
do $$
declare v_a uuid; v_b uuid; v_post uuid; v_ok boolean := false;
begin
  set local role postgres;
  select id into v_a from public.profiles where status='approved' order by created_at limit 1;
  select id into v_b from public.profiles where status='approved' and id <> v_a order by created_at limit 1;

  perform _set_caller(v_a);
  select cp.id into v_post from public.create_post('Owner only', 'This belongs to A.') cp;

  perform _set_caller(v_b);
  begin
    perform public.delete_my_post(v_post);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: a member deleted another member''s post'; end if;
end;
$$;

-- 31d. Admin takedown snapshots the content and audits, BEFORE deleting.
--      An appeal is the only time this log is ever read, and by then the
--      post is gone — so a log without the snapshot would be worthless.
do $$
declare v_a uuid; v_admin uuid; v_post uuid; v_n int;
begin
  set local role postgres;
  select id into v_a from public.profiles where status='approved' order by created_at limit 1;
  select user_id into v_admin from public.admins limit 1;

  perform _set_caller(v_a);
  select cp.id into v_post from public.create_post('Takedown target', 'Objectionable content here.') cp;

  perform _set_caller(v_admin);
  perform public.admin_delete_post(v_post, 'Breaches guideline 3.');

  set local role postgres;
  select count(*) into v_n from public.post_moderation_log
   where post_id = v_post
     and body_snapshot = 'Objectionable content here.'
     and reason = 'Breaches guideline 3.'
     and purge_after > now() + interval '11 months';
  if v_n <> 1 then
    raise exception 'FAIL: takedown did not write a complete 12-month moderation record';
  end if;

  select count(*) into v_n from public.posts where id = v_post;
  if v_n <> 0 then raise exception 'FAIL: post survived an admin takedown'; end if;
end;
$$;

-- 31e. Deleting an image ALWAYS schedules its bytes. This one trigger is
--      what makes an erasure request actually complete rather than merely
--      appear to, across every deletion path.
do $$
declare v_a uuid; v_key text; v_post uuid; v_n int;
begin
  set local role postgres;
  select id into v_a from public.profiles where status='approved' order by created_at limit 1;

  perform _set_caller(v_a);
  v_key  := public.issue_upload_ticket('post_image');
  select cp.id into v_post from public.create_post('With an image', 'body text',
    jsonb_build_array(jsonb_build_object(
      'blob_key', v_key, 'alt_text','A photo','width',800,'height',600,'byte_size',1234))) cp;
  perform public.delete_my_post(v_post);

  set local role postgres;
  select count(*) into v_n from public.blob_deletion_queue where blob_key = v_key;
  if v_n <> 1 then
    raise exception 'FAIL: deleting a post did not queue its image bytes for destruction';
  end if;
end;
$$;

-- 31f. The four deny-all tables are opaque to `authenticated`. A reporter
--      must not be able to read who reported what, and an audit log the
--      application can read is one it can be tricked into leaking.
do $$
declare v_a uuid; v_n int;
begin
  set local role postgres;
  select id into v_a from public.profiles where status='approved' order by created_at limit 1;
  perform _set_caller(v_a);

  select count(*) into v_n from public.post_moderation_log;
  if v_n <> 0 then raise exception 'FAIL: authenticated read % post_moderation_log row(s)', v_n; end if;
  select count(*) into v_n from public.post_reports;
  if v_n <> 0 then raise exception 'FAIL: authenticated read % post_reports row(s)', v_n; end if;
  select count(*) into v_n from public.upload_tickets;
  if v_n <> 0 then raise exception 'FAIL: authenticated read % upload_tickets row(s)', v_n; end if;
  select count(*) into v_n from public.blob_deletion_queue;
  if v_n <> 0 then raise exception 'FAIL: authenticated read % blob_deletion_queue row(s)', v_n; end if;
end;
$$;

-- 31g. A banned member's posts go with them. Leaving them in the feed is
--      the outcome the ban exists to prevent, and banned_until can take an
--      hour to invalidate their JWT.
do $$
declare v_victim uuid; v_n int;
begin
  set local role postgres;
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  select id into v_victim from public.profiles where status='approved' order by created_at limit 1;

  perform _set_caller(v_victim);
  perform public.create_post('Doomed by ban', 'This should vanish with the account.');

  set local role postgres;
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  update public.profiles set status = 'rejected' where id = v_victim;

  select count(*) into v_n from public.posts where author_id = v_victim;
  if v_n <> 0 then
    raise exception 'FAIL: a banned member kept % post(s) live on the feed', v_n;
  end if;
end;
$$;

-- 31h. Retention purges run, and legal_hold survives them — so one record
--      can outlive the window for a live claim without the purge having to
--      be disabled for everyone.
do $$
declare v_n int;
begin
  set local role postgres;
  update public.post_moderation_log set purge_after = now() - interval '1 day';
  update public.post_moderation_log set legal_hold = true
   where id = (select id from public.post_moderation_log limit 1);

  perform public.purge_moderation_records();

  select count(*) into v_n from public.post_moderation_log;
  if v_n <> 1 then
    raise exception 'FAIL: expected exactly the legal_hold row to survive the purge, got %', v_n;
  end if;
end;
$$;

-- 31i. An admin CANNOT delete a post straight off the table. This is the
--      one that keeps the moderation log meaningful: a DELETE through
--      PostgREST would remove the post while writing no audit row, no
--      admin_actions entry and sending the author no notice. The RPC is
--      the only takedown route, and it is SECURITY DEFINER, so it does not
--      need — and must not have — an RLS policy backing it up.
do $$
declare
  v_admin uuid; v_author uuid; v_post uuid; v_n int;
begin
  set local role postgres;
  select user_id into v_admin from public.admins limit 1;
  select id into v_author from public.profiles where status='approved' and id <> v_admin limit 1;

  perform _set_caller(v_author);
  select cp.id into v_post from public.create_post('Admin bypass probe', 'body text long enough') cp;

  perform _set_caller(v_admin);
  delete from public.posts where id = v_post;

  set local role postgres;
  select count(*) into v_n from public.posts where id = v_post;
  if v_n <> 1 then
    raise exception 'FAIL: an admin deleted a post directly, bypassing admin_delete_post and the moderation log';
  end if;

  select count(*) into v_n from public.post_moderation_log where post_id = v_post;
  if v_n <> 0 then
    raise exception 'FAIL: a direct delete somehow wrote a moderation row';
  end if;

  -- And the supported route still works, without an RLS policy helping it.
  perform _set_caller(v_admin);
  perform public.admin_delete_post(v_post, 'Removed by the supported route.');
  set local role postgres;
  select count(*) into v_n from public.posts where id = v_post;
  if v_n <> 0 then
    raise exception 'FAIL: admin_delete_post left the post behind';
  end if;
end;
$$;

-- 31j. The posting ceiling lives in the database, not only in the server
--      action. create_post is EXECUTE-able by `authenticated`, so anyone
--      who can open devtools can skip the Upstash limiter entirely — on a
--      surface that publishes straight to every member with no queue in
--      between. The action stays the limit members meet; this is the floor
--      under it.
do $$
declare
  v_author uuid; v_i int; v_ok boolean := false;
begin
  set local role postgres;
  select id into v_author from public.profiles where status='approved' limit 1;
  delete from public.posts where author_id = v_author;

  perform _set_caller(v_author);
  for v_i in 1..15 loop
    perform public.create_post('Flood probe ' || v_i, 'body text long enough ' || v_i);
  end loop;

  begin
    perform public.create_post('Flood probe 16', 'body text long enough 16');
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: create_post accepted a 16th post in 24h — the rate backstop is not enforced in the database';
  end if;

  set local role postgres;
  delete from public.posts where author_id = v_author;
end;
$$;

-- 31k. Same argument for reporting. The unique index already stops the same
--      post being reported twice; this stops one member working through
--      everyone else's posts through the RPC directly.
do $$
declare
  v_reporter uuid; v_author uuid; v_post uuid; v_i int; v_ok boolean := false;
begin
  set local role postgres;
  select id into v_author   from public.profiles where status='approved' order by created_at limit 1;
  select id into v_reporter from public.profiles where status='approved' and id <> v_author order by created_at limit 1;
  delete from public.post_reports where reporter_id = v_reporter;

  for v_i in 1..11 loop
    perform _set_caller(v_author);
    select cp.id into v_post from public.create_post('Report target ' || v_i, 'body text long enough ' || v_i) cp;

    perform _set_caller(v_reporter);
    begin
      perform public.report_post(v_post, 'spam', 'Repeated advertising from this account.');
    exception when others then v_ok := true;
    end;
    exit when v_ok;
  end loop;

  if not v_ok then
    raise exception 'FAIL: report_post accepted an 11th report in 24h — report-bombing is not bounded in the database';
  end if;

  set local role postgres;
  delete from public.post_reports where reporter_id = v_reporter;
  delete from public.posts where author_id = v_author;
end;
$$;

-- 31l. An expired post is invisible before the hourly purge reaches it.
--      The privacy page promises seven days; the cron reclaims the row, but
--      the read is what makes the promise exact for the member.
do $$
declare
  v_author uuid; v_post uuid; v_n int;
begin
  set local role postgres;
  select id into v_author from public.profiles where status='approved' limit 1;

  perform _set_caller(v_author);
  select cp.id into v_post from public.create_post('Expiry probe', 'body text long enough') cp;

  set local role postgres;
  update public.posts set expires_at = now() - interval '1 minute' where id = v_post;

  perform _set_caller(v_author);
  select count(*) into v_n from public.list_community_feed(null, null, 50) f where f.id = v_post;
  if v_n <> 0 then
    raise exception 'FAIL: an expired post is still served by list_community_feed';
  end if;

  select count(*) into v_n from public.list_my_posts(null, null, 50) f where f.id = v_post;
  if v_n <> 0 then
    raise exception 'FAIL: an expired post is still served by list_my_posts';
  end if;

  set local role postgres;
  delete from public.posts where id = v_post;
end;
$$;

-- ─── 32. No pre-community-posts member RPC is callable by `anon` ─────
-- Section 28 asserts this for the admin RPCs (20260827000001). This is the
-- same claim for the 22 member-facing RPCs 20260830000005 locked down —
-- everything from before the community-posts feature that reads or writes
-- on the caller's own behalf: update_profile, submit_opportunity,
-- list_approved_events, and the rest.
--
-- Their in-body auth.uid() check (direct, or through is_approved()) already
-- rejects an anonymous caller, so this is defence in depth, not a live
-- hole — same reasoning as section 28. It is here because that in-body
-- check is one edit away from being the only thing standing there, and
-- because Supabase's default privileges re-grant EXECUTE to anon every
-- time one of these functions is re-created, so 20260830000005's revoke
-- needs something that notices when a later `create or replace` quietly
-- undoes it.
--
-- Matched by NAME, exactly as 20260830000005 does, so a signature change
-- cannot slip a function past either of them.
set local role postgres;
do $$
declare
  v_leaked  text;
  v_targets text[] := array[
    'delete_my_account', 'get_event_for_edit', 'get_my_activity',
    'get_my_listing_actions', 'get_my_listing_stats', 'get_opportunity_for_edit',
    'list_approved_events', 'list_approved_opportunities',
    'list_directory_cards', 'list_directory_facets',
    'list_my_bookmarked_opportunities', 'mark_listing_action',
    'record_listing_event', 'submit_event', 'submit_onboarding',
    'submit_opportunity', 'submit_vc_grant', 'unmark_listing_action',
    'update_event', 'update_opportunity', 'update_profile', 'update_vc_grant'
  ];
begin
  select string_agg(distinct p.proname, ', ' order by p.proname)
    into v_leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prokind = 'f'
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e')
     and p.proname = any(v_targets)
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_leaked is not null then
    raise exception
      'FAIL: member RPC(s) EXECUTE-able by anon: %. A re-created function picks up '
      'Supabase''s default grant again — re-apply the revoke from '
      'migration 20260830000005.', v_leaked;
  end if;
end;
$$;

-- And the same functions must still be reachable by a signed-in member —
-- a revoke that took `authenticated` with it would lock every submission
-- and profile-edit form, while every in-body check kept passing.
set local role postgres;
do $$
declare
  v_locked  text;
  v_targets text[] := array[
    'delete_my_account', 'get_event_for_edit', 'get_my_activity',
    'get_my_listing_actions', 'get_my_listing_stats', 'get_opportunity_for_edit',
    'list_approved_events', 'list_approved_opportunities',
    'list_directory_cards', 'list_directory_facets',
    'list_my_bookmarked_opportunities', 'mark_listing_action',
    'record_listing_event', 'submit_event', 'submit_onboarding',
    'submit_opportunity', 'submit_vc_grant', 'unmark_listing_action',
    'update_event', 'update_opportunity', 'update_profile', 'update_vc_grant'
  ];
begin
  select string_agg(distinct p.proname, ', ' order by p.proname)
    into v_locked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prokind = 'f'
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e')
     and p.proname = any(v_targets)
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_locked is not null then
    raise exception
      'FAIL: member RPC(s) no longer EXECUTE-able by authenticated: % — the revoke '
      'took every member-facing form with it', v_locked;
  end if;
end;
$$;

-- ─── 33. post_likes: deny-all RLS, the toggle's own guards, and the feed ──
-- post_likes has no RLS policies at all — every write goes through
-- toggle_post_like (20260831000001), same reasoning as post_reports and
-- upload_tickets in §31. Each block asserts one guarantee.
set local role postgres;

-- 33a. A member can like another member's post, and the feed reflects it.
do $$
declare
  v_author uuid; v_liker uuid; v_post uuid;
  v_liked boolean; v_count int;
begin
  select id into v_author from public.profiles where status='approved' order by created_at limit 1;
  select id into v_liker  from public.profiles where status='approved' and id <> v_author order by created_at limit 1;

  perform _set_caller(v_author);
  select id into v_post from public.create_post('Likeable post', 'Body text long enough.', '[]'::jsonb);

  perform _set_caller(v_liker);
  select liked, like_count into v_liked, v_count from public.toggle_post_like(v_post);
  if not v_liked or v_count <> 1 then
    raise exception 'FAIL: toggle_post_like did not register a like (liked=%, count=%)', v_liked, v_count;
  end if;

  select like_count, liked_by_me into v_count, v_liked
    from public.list_community_feed() where id = v_post;
  if not v_liked or v_count <> 1 then
    raise exception 'FAIL: list_community_feed does not reflect the like (liked_by_me=%, like_count=%)', v_liked, v_count;
  end if;

  -- Toggling again removes it.
  select liked, like_count into v_liked, v_count from public.toggle_post_like(v_post);
  if v_liked or v_count <> 0 then
    raise exception 'FAIL: toggling twice did not unlike (liked=%, count=%)', v_liked, v_count;
  end if;
end;
$$;

-- 33b. An author cannot like their own post.
do $$
declare v_author uuid; v_post uuid; v_ok boolean := false;
begin
  select id into v_author from public.profiles where status='approved' order by created_at limit 1;

  perform _set_caller(v_author);
  select id into v_post from public.create_post('Self-like bait', 'Body text long enough.', '[]'::jsonb);

  begin
    perform public.toggle_post_like(v_post);
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: an author was able to like their own post';
  end if;
end;
$$;

-- 33c. A nonexistent (or expired) post is rejected, not silently ignored.
do $$
declare v_liker uuid; v_ok boolean := false;
begin
  select id into v_liker from public.profiles where status='approved' limit 1;
  perform _set_caller(v_liker);
  begin
    perform public.toggle_post_like(gen_random_uuid());
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: toggle_post_like accepted a nonexistent post id';
  end if;
end;
$$;

-- 33d. Direct writes to post_likes are blocked — deny-all RLS, exactly as
--      claimed above, not just "nobody happens to call insert directly."
do $$
declare v_liker uuid; v_post uuid; v_ok boolean := false;
begin
  set local role postgres;
  select id into v_liker from public.profiles where status='approved' order by created_at limit 1;
  select id into v_post from public.posts where kind='member' order by created_at desc limit 1;

  perform _set_caller(v_liker);
  begin
    insert into public.post_likes (post_id, user_id) values (v_post, v_liker);
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: post_likes accepted a direct insert from authenticated — RLS is not deny-all';
  end if;
end;
$$;

-- 33e. get_post_like_counts (20260831000002) — the batched read the feed
--      polls on. Matches toggle_post_like's own counts and rejects an
--      oversized request rather than silently truncating it.
do $$
declare
  v_author uuid; v_liker uuid; v_post1 uuid; v_post2 uuid;
  v_count int; v_liked boolean; v_ok boolean := false;
begin
  select id into v_author from public.profiles where status='approved' order by created_at limit 1;
  select id into v_liker  from public.profiles where status='approved' and id <> v_author order by created_at limit 1;

  perform _set_caller(v_author);
  select id into v_post1 from public.create_post('Batch count A', 'Body text long enough.', '[]'::jsonb);
  select id into v_post2 from public.create_post('Batch count B', 'Body text long enough.', '[]'::jsonb);

  perform _set_caller(v_liker);
  perform public.toggle_post_like(v_post1);

  select like_count, liked_by_me into v_count, v_liked
    from public.get_post_like_counts(array[v_post1, v_post2]) where id = v_post1;
  if v_count <> 1 or not v_liked then
    raise exception 'FAIL: get_post_like_counts wrong for a liked post (count=%, liked=%)', v_count, v_liked;
  end if;

  select like_count, liked_by_me into v_count, v_liked
    from public.get_post_like_counts(array[v_post1, v_post2]) where id = v_post2;
  if v_count <> 0 or v_liked then
    raise exception 'FAIL: get_post_like_counts wrong for an unliked post (count=%, liked=%)', v_count, v_liked;
  end if;

  begin
    perform public.get_post_like_counts(array(select gen_random_uuid() from generate_series(1, 51)));
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: get_post_like_counts accepted a batch over the 50-id cap';
  end if;
end;
$$;

-- 22. Profile media (avatar/CV) protection — 20260901000003/000006.
do $$
declare
  v_a uuid := (select v from _test_ctx where k='user_a');
  v_b uuid := (select v from _test_ctx where k='user_b');
  v_ok boolean := false;
begin
  -- 22a. A member cannot UPDATE their own avatar_path/cv_path directly —
  --      only confirm_avatar_upload/confirm_cv_upload may, via the GUC.
  perform _set_caller(v_a);
  begin
    update public.profiles set avatar_path = 'x.webp' where id = v_a;
    raise exception 'FAIL: member wrote avatar_path directly';
  exception when sqlstate '42501' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: direct avatar_path UPDATE was not rejected with 42501';
  end if;

  v_ok := false;
  begin
    update public.profiles set cv_path = 'x.pdf' where id = v_a;
    raise exception 'FAIL: member wrote cv_path directly';
  exception when sqlstate '42501' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: direct cv_path UPDATE was not rejected with 42501';
  end if;

  -- 22b. cv_path is not readable by column privilege at all, even for the
  --      caller's own row — profiles_select_directory is a ROW policy and
  --      cannot express "only your own", so the column itself is locked.
  --      get_my_cv_info() is the one legitimate way back in.
  if has_column_privilege('authenticated', 'public.profiles', 'cv_path', 'SELECT') then
    raise exception 'FAIL: authenticated can still SELECT profiles.cv_path directly';
  end if;

  -- 22c. issue_upload_ticket refuses a caller who isn't approved yet.
  --      Status flips need service_role context, not just a role reset —
  --      tg_profiles_protect_status reads the JWT claims GUC, which
  --      `set local role none` alone does not touch (see test 8).
  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set status = 'pending_review' where id = v_b;

  v_ok := false;
  perform _set_caller(v_b);
  begin
    perform public.issue_upload_ticket('cv');
    raise exception 'FAIL: a pending_review member obtained a CV upload ticket';
  exception when sqlstate '42501' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: issue_upload_ticket did not reject a non-approved caller';
  end if;

  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set status = 'approved' where id = v_b;

  -- 22d. confirm_cv_upload refuses a ticket issued to a DIFFERENT member —
  --      the exact IDOR a forged/replayed blob key would attempt.
  insert into public.upload_tickets (blob_key, user_id, purpose)
  values ('11111111-1111-1111-1111-111111111111.pdf', v_b, 'cv')
  on conflict do nothing;
  v_ok := false;
  perform _set_caller(v_a);  -- v_a, not v_b — the ticket belongs to v_b
  begin
    perform public.confirm_cv_upload(
      '11111111-1111-1111-1111-111111111111.pdf', 'cv.pdf', false);
    raise exception 'FAIL: confirmed a CV upload using another member''s ticket';
  exception when sqlstate '42501' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: confirm_cv_upload did not reject a foreign ticket';
  end if;

  -- 22e. submit_intake refuses a caller who is not yet approved.
  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set status = 'pending_review' where id = v_a;

  v_ok := false;
  perform _set_caller(v_a);
  begin
    perform public.submit_intake('Al', 'Focus', 'Hobbies');
    raise exception 'FAIL: a pending_review member completed submit_intake';
  exception when sqlstate '42501' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: submit_intake did not reject a non-approved caller';
  end if;

  -- 22f. update_profile refuses a caller whose status is not 'approved' —
  --      the gap 20260902000002 closed: a member rejected mid-session must
  --      not be able to keep saving profile edits from an already-open tab.
  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set status = 'rejected' where id = v_a;

  v_ok := false;
  perform _set_caller(v_a);
  begin
    -- grad_year is null here deliberately: the status check must raise
    -- before any field validation runs, so this call would fail differently
    -- (and validly so) if the gate below it were ever skipped.
    perform public.update_profile(
      p_first_name    => 'Al',
      p_surname       => 'Um',
      p_course        => 'MEng',
      p_grad_year     => null,
      p_linkedin_url  => 'https://linkedin.com/in/foundry-test',
      p_github_url    => null,
      p_portfolio_url => null
    );
    raise exception 'FAIL: a rejected member saved profile edits via update_profile';
  exception when sqlstate '42501' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: update_profile did not reject a non-approved caller';
  end if;

  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set status = 'approved' where id = v_a;
end;
$$;

-- 23. approve_user refuses to re-process a target that is not currently
--     pending_review — the guard 20260902000003 added to match reject_user's
--     existing convention. Without it, a devtools-bypassed double-click or a
--     race between two admin tabs both succeed, each firing a duplicate
--     acceptance email and writing a duplicate admin_actions row.
do $$
declare
  v_a     uuid := (select v from _test_ctx where k='user_a');
  v_admin uuid := (select v from _test_ctx where k='admin');
  v_ok    boolean := false;
begin
  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set status = 'pending_review' where id = v_a;

  perform _set_caller(v_admin);
  perform * from public.approve_user(v_a, null);  -- first call: succeeds

  begin
    perform * from public.approve_user(v_a, null);  -- second call: must refuse
    raise exception 'FAIL: approve_user re-processed an already-approved target';
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: approve_user did not guard against re-approval';
  end if;

  set local role none;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set status = 'approved' where id = v_a;
end;
$$;

-- 24. approve_opportunity/reject_opportunity/approve_event/reject_event/
--     approve_vc_grant/reject_vc_grant refuse to re-process a target that
--     is not currently 'pending' — the guard 20260904000001 added to match
--     approve_user/reject_user's own convention (test 23 above), extended
--     to the three listing types. Without it: a double-click past the
--     client-side disabled state, or two admin tabs racing, both succeed —
--     a double-reject fires the poster two identical rejection emails, and
--     an approve-then-reject on the same stale tab silently un-publishes
--     an already-approved listing.
do $$
declare
  v_a     uuid := (select v from _test_ctx where k='user_a');
  v_admin uuid := (select v from _test_ctx where k='admin');
  v_opp   uuid := gen_random_uuid();
  v_ev    uuid := gen_random_uuid();
  v_vc    uuid := gen_random_uuid();
  v_ok    boolean;
begin
  set local role postgres;
  insert into public.opportunities (
    id, posted_by, status, position_name, company, pay, location_type,
    description, start_month, start_year, application_deadline,
    contact_email, apply_method
  ) values (v_opp, v_a, 'pending', 'Guard test role', 'Co', '£50k', 'remote',
            'Description that is at least twenty chars long.',
            1, 2027, current_date + 30, 'a@imperial.ac.uk', 'email');
  insert into public.events (
    id, posted_by, status, title, description, luma_link, event_at,
    location, organiser_name, contact_email
  ) values (v_ev, v_a, 'pending', 'Guard test event',
            'Description that is at least twenty chars long.', 'https://lu.ma/gt',
            now() + interval '30 days', 'London', 'A User', 'a@imperial.ac.uk');
  insert into public.vcs_grants (
    id, kind, posted_by, status, name, description, link
  ) values (v_vc, 'vc', v_a, 'pending', 'Guard test fund',
            'Description that is at least twenty chars long.', 'https://example.com/gt');

  perform _set_caller(v_admin);

  -- (a) double-approve is refused, for all three types.
  perform public.approve_opportunity(v_opp, null);
  v_ok := false;
  begin
    perform public.approve_opportunity(v_opp, null);
    raise exception 'FAIL: approve_opportunity re-processed an already-approved listing';
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: approve_opportunity did not guard against re-approval'; end if;

  perform public.approve_event(v_ev, null);
  v_ok := false;
  begin
    perform public.approve_event(v_ev, null);
    raise exception 'FAIL: approve_event re-processed an already-approved listing';
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: approve_event did not guard against re-approval'; end if;

  perform public.approve_vc_grant(v_vc, null);
  v_ok := false;
  begin
    perform public.approve_vc_grant(v_vc, null);
    raise exception 'FAIL: approve_vc_grant re-processed an already-approved listing';
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: approve_vc_grant did not guard against re-approval'; end if;

  -- (b) cross-action race: a stale tab's reject on an already-approved
  -- listing must also be refused, not silently un-publish it.
  v_ok := false;
  begin
    perform * from public.reject_opportunity(v_opp, 'stale tab');
    raise exception 'FAIL: reject_opportunity un-approved an already-approved listing';
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: reject_opportunity did not guard against a cross-action race'; end if;

  -- (c) double-reject is refused (second call would otherwise re-fire the
  -- poster's rejection email).
  set local role postgres;
  update public.opportunities
     set status = 'pending', approved_at = null, approved_by = null, rejected_reason = null
   where id = v_opp;
  perform _set_caller(v_admin);
  perform * from public.reject_opportunity(v_opp, 'spam');
  v_ok := false;
  begin
    perform * from public.reject_opportunity(v_opp, 'spam');
    raise exception 'FAIL: reject_opportunity re-processed an already-rejected listing';
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: reject_opportunity did not guard against re-rejection'; end if;
end;
$$;

-- 25. admin_set_committee grants admin access on an is_committee transition
--     to true and revokes it on a transition to false (20260904000004) —
--     the business rule is "on committee ⇒ admin", enforced inside the RPC
--     rather than as a second manual step an admin could forget.
do $$
declare
  v_a     uuid := (select v from _test_ctx where k='user_a');
  v_b     uuid := (select v from _test_ctx where k='user_b');
  v_admin uuid := (select v from _test_ctx where k='admin');
  v_ok    boolean := false;
begin
  -- 25a. Only an admin may call it.
  perform _set_caller(v_b);
  begin
    perform public.admin_set_committee(v_a, true, 'Committee member');
    raise exception 'FAIL: a non-admin called admin_set_committee';
  exception when sqlstate '42501' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: admin_set_committee did not reject a non-admin caller';
  end if;

  -- 25b. Granting committee membership grants admin, and logs it.
  perform _set_caller(v_admin);
  perform public.admin_set_committee(v_a, true, 'Committee member');

  if not exists (select 1 from public.admins where user_id = v_a) then
    raise exception 'FAIL: admin_set_committee(true) did not grant an admins row';
  end if;
  if not exists (
    select 1 from public.admin_actions
     where admin_id = v_admin and action = 'grant_committee_admin' and target_id = v_a
  ) then
    raise exception 'FAIL: admin_set_committee(true) did not log grant_committee_admin';
  end if;

  -- 25c. A repeat call with the same flag is a true no-op: no duplicate
  --      audit log entry (a duplicate admins row would violate its own
  --      primary key, so that half is enforced by the schema itself).
  perform public.admin_set_committee(v_a, true, 'Committee member');
  if (select count(*) from public.admin_actions
       where admin_id = v_admin and action = 'grant_committee_admin' and target_id = v_a) <> 1 then
    raise exception 'FAIL: an idempotent admin_set_committee(true) call logged a duplicate grant';
  end if;

  -- 25d. Revoking committee membership revokes admin, and logs it.
  perform public.admin_set_committee(v_a, false, null);
  if exists (select 1 from public.admins where user_id = v_a) then
    raise exception 'FAIL: admin_set_committee(false) did not revoke the admins row';
  end if;
  if not exists (
    select 1 from public.admin_actions
     where admin_id = v_admin and action = 'revoke_committee_admin' and target_id = v_a
  ) then
    raise exception 'FAIL: admin_set_committee(false) did not log revoke_committee_admin';
  end if;

  -- 25e. Revoking never touches an admin who got there some other way —
  --      the fixture admin (v_admin) is never a committee member in this
  --      test and must still be admin throughout.
  if not exists (select 1 from public.admins where user_id = v_admin) then
    raise exception 'FAIL: an unrelated admin lost admin access during this test';
  end if;
end;
$$;

-- ─── 34. Post-approval listing revisions ────────────────────────────
-- 20260907000005 is the first migration that lets a member's write touch
-- a *published* row's future, so the interesting assertions are about
-- what it cannot do: publish without review, read somebody else's
-- proposal, reach the internal appliers, or survive the listing being
-- unpublished. Section 26(c) proves the routing; this proves the rest.
set local role postgres;
do $$
declare
  v_a      uuid := (select v from _test_ctx where k='user_a');
  v_b      uuid := (select v from _test_ctx where k='user_b');
  v_adm    uuid := (select v from _test_ctx where k='admin');
  v_ev     uuid := gen_random_uuid();
  v_edit   uuid;
  v_txt    text;
  v_n      int;
  v_passed boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.events (
    id, posted_by, status, title, description, luma_link, event_at,
    location, organiser_name, contact_email, approved_at, approved_by
  ) values (v_ev, v_a, 'approved', 'Revision fixture',
            'Description that is at least twenty chars long.', 'https://lu.ma/r',
            now() + interval '30 days', 'Huxley 340', 'A User', 'a@imperial.ac.uk',
            now(), v_adm);

  -- (a) the owner's edit stages a revision and leaves the live row alone
  perform _set_caller(v_a);
  perform public.update_event(v_ev, 'Revision fixture',
    'Description that is at least twenty chars long.', 'https://lu.ma/r',
    now() + interval '30 days', 'Blackett 202', 'A User', 'a@imperial.ac.uk', false);

  set local role none;
  select location into v_txt from public.events where id = v_ev;
  if v_txt <> 'Huxley 340' then
    raise exception 'FAIL: a proposed revision changed the published event (%)', v_txt;
  end if;

  -- (b) a listing has at most one open revision, enforced by the index
  perform _set_caller(v_a);
  perform public.update_event(v_ev, 'Revision fixture',
    'Description that is at least twenty chars long.', 'https://lu.ma/r',
    now() + interval '30 days', 'Blackett 999', 'A User', 'a@imperial.ac.uk', false);
  set local role none;
  select count(*) into v_n from public.listing_edits where listing_id = v_ev and status = 'pending';
  if v_n <> 1 then raise exception 'FAIL: % open revisions on one listing', v_n; end if;

  -- (c) a payload that violates the table's own CHECK constraints is
  --     refused at proposal time, not left to blow up in the reviewer's
  --     face — and the dry run that proves it must not leak onto the row
  perform _set_caller(v_a);
  v_passed := false;
  begin
    perform public.update_event(v_ev, 'x',
      'Description that is at least twenty chars long.', 'https://lu.ma/r',
      now() + interval '30 days', 'Blackett 999', 'A User', 'a@imperial.ac.uk', false);
    v_passed := true;
  exception when others then null;
  end;
  if v_passed then raise exception 'FAIL: staged a revision violating events_title_len'; end if;
  set local role none;
  select title into v_txt from public.events where id = v_ev;
  if v_txt <> 'Revision fixture' then
    raise exception 'FAIL: the validation dry run leaked onto the live row (%)', v_txt;
  end if;

  -- (d) the table is unreachable directly. Stricter than the other
  --     deny-all tables here, which keep the SELECT grant and rely on
  --     having no policies (so a read returns 0 rows): this one has the
  --     grant revoked as well, so a direct read is a hard permission
  --     error. Asserted as an error, not as an empty result.
  perform _set_caller(v_b);
  v_passed := false;
  begin
    select count(*) into v_n from public.listing_edits;
    v_passed := true;
  exception when others then null;
  end;
  if v_passed then raise exception 'FAIL: a member selected from listing_edits directly'; end if;

  -- (e) another member cannot read the owner's proposal through the RPC
  select count(*) into v_n from public.get_my_pending_listing_edit('event', v_ev);
  if v_n <> 0 then raise exception 'FAIL: a non-owner read a queued revision'; end if;

  -- (f) …nor reach the internal appliers that publish one.
  --
  --     Asserted through has_function_privilege rather than by calling
  --     them and catching the refusal, which is how the other "a member
  --     cannot call this" checks in this file are written. Two reasons,
  --     and the first is enough on its own:
  --
  --     1. The local Postgres image (public.ecr.aws/supabase/postgres
  --        17.6.1.105, shipped by Supabase CLI 2.116.0) SEGFAULTS the
  --        backend when a role without EXECUTE calls a plpgsql SECURITY
  --        DEFINER function under `set local role`. Not specific to
  --        these functions — public.expire_events() and
  --        public.rls_auto_enable(), both years old, crash it too. CI
  --        pins the CLI to 2.105.0, so this is a local-only regression,
  --        but a test that takes the server down on a developer's
  --        machine is not a test anyone will keep running.
  --     2. has_function_privilege is the stronger assertion anyway: it
  --        is what section 21 uses, and it accounts for direct grants,
  --        the PUBLIC grant and role membership at once.
  if has_function_privilege('authenticated',
       'public.apply_listing_edit_payload(public.listing_event_kind, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.stage_listing_edit(public.listing_event_kind, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.listing_snapshot(public.listing_event_kind, uuid)', 'EXECUTE')
  then
    raise exception 'FAIL: a member can execute one of the internal listing-edit appliers';
  end if;

  perform _set_caller(v_b);
  v_passed := false;
  begin
    perform public.admin_update_listing('event', v_ev, jsonb_build_object('title', 'HIJACKED'));
    v_passed := true;
  exception when others then null;
  end;
  if v_passed then raise exception 'FAIL: a member called admin_update_listing'; end if;

  -- (g) an admin applying it publishes the change and never moves status
  perform _set_caller(v_adm);
  select id into v_edit from public.admin_list_listing_edits() where listing_id = v_ev;
  if v_edit is null then raise exception 'FAIL: the revision is missing from the admin queue'; end if;
  perform public.admin_apply_listing_edit(v_edit);

  set local role none;
  select location into v_txt from public.events where id = v_ev;
  if v_txt <> 'Blackett 999' then raise exception 'FAIL: apply did not publish (%)', v_txt; end if;
  select status::text into v_txt from public.events where id = v_ev;
  if v_txt <> 'approved' then
    raise exception 'FAIL: applying a revision moved the listing to %', v_txt;
  end if;
  select previous->>'location' into v_txt from public.listing_edits where id = v_edit;
  if v_txt <> 'Huxley 340' then raise exception 'FAIL: no before-snapshot recorded (%)', v_txt; end if;

  -- (h) unpublishing the listing discards whatever was queued against it
  perform _set_caller(v_a);
  perform public.update_event(v_ev, 'Revision fixture',
    'Description that is at least twenty chars long.', 'https://lu.ma/r',
    now() + interval '30 days', 'Doomed room', 'A User', 'a@imperial.ac.uk', false);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role none;
  update public.events set status = 'expired' where id = v_ev;
  select count(*) into v_n from public.listing_edits where listing_id = v_ev and status = 'pending';
  if v_n <> 0 then raise exception 'FAIL: % revisions survived the listing being unpublished', v_n; end if;

  -- (i) deleting the listing takes its revision history with it
  delete from public.events where id = v_ev;
  select count(*) into v_n from public.listing_edits where listing_id = v_ev;
  if v_n <> 0 then raise exception 'FAIL: % orphaned listing_edits rows after delete', v_n; end if;
end;
$$;

-- ─── 35. get_my_cv_profile: skills are deduplicated across sources ────
-- member_skills holds one row per (member, source, skill) — a skill
-- found on both the CV and GitHub resolves to the same cv_skills row
-- via two DIFFERENT member_skills rows (source='cv' and source='github').
-- get_my_cv_profile's array_agg must still surface it once, not twice
-- (20260911000002 — found as a duplicate-key React warning that was
-- really a duplicate-data bug).
do $$
declare
  v_m            uuid := gen_random_uuid();
  v_cv           uuid := gen_random_uuid();
  v_skill        uuid;
  v_dummy        vector(1536) := (select ('[' || string_agg('0', ',') || ']')::vector
                                     from generate_series(1, 1536));
  v_skills       text[];
  v_match_count  int;
begin
  set local role postgres;
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_m, 'dedup-skills@imperial.ac.uk',
          '{"first_name":"D","surname":"Skills","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb)
  on conflict do nothing;
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year)
  values (v_m, 'student', 'approved', 'D', 'Skills', 'MEng Computing', 2027)
  on conflict (id) do update set
    status     = excluded.status,
    course     = excluded.course,
    grad_year  = excluded.grad_year;

  insert into public.cvs (id, member_id, blob_key, status, is_current)
  values (v_cv, v_m, 'dedup-skills.pdf', 'ready', true);
  insert into public.cv_profiles (cv_id, is_current, profile, summary, model_name, prompt_version)
  values (v_cv, true, '{}'::jsonb, 'A summary.', 'test-model', 'test-v1');

  insert into public.cv_skills (canonical_name, embedding)
  values ('Python (rls_smoke dedup fixture)', v_dummy)
  on conflict (canonical_name) do nothing
  returning id into v_skill;
  if v_skill is null then
    select id into v_skill from public.cv_skills where canonical_name = 'Python (rls_smoke dedup fixture)';
  end if;

  -- Same canonical skill, reached from both signals — exactly what a
  -- member with Python on their CV and among their GitHub languages
  -- produces.
  insert into public.member_skills (member_id, skill_id, raw_text, confidence, source)
  values
    (v_m, v_skill, 'Python', 1.0,  'cv'),
    (v_m, v_skill, 'Python', 0.95, 'github');

  perform _set_caller(v_m);
  select skills into v_skills from public.get_my_cv_profile();
  set local role none;

  select count(*) into v_match_count
    from unnest(v_skills) s where s = 'Python (rls_smoke dedup fixture)';
  if v_match_count <> 1 then
    raise exception
      'FAIL: get_my_cv_profile returned % copies of a skill matched from two sources, want 1',
      v_match_count;
  end if;
end;
$$;

-- ─── 36. Ingestion kill switch: gates the job, not the storage ────────
-- (20260911000003). Deliberately NOT posting_enabled's raise-an-exception
-- shape: confirm_cv_upload/confirm_github_connected must still succeed and
-- still do their storage/connection write while the switch is off — only
-- the ingest_cv / scan_github job insert is suppressed. See that
-- migration's header for why (raising would also roll back the unrelated,
-- pre-existing storage write in the same transaction).
do $$
declare
  v_m           uuid := gen_random_uuid();
  v_key         text;
  v_cv_count    int;
  v_ingest_before int;
  v_ingest_after  int;
  v_scan_before   int;
  v_scan_after    int;
  v_cv_path     text;
  v_gh_status   text;
begin
  set local role postgres;
  -- The previous test block left request.jwt.claims set to a non-admin
  -- member — tg_profiles_protect_status (20260531000003) rejects a
  -- status-setting INSERT/UPDATE without service_role or is_admin(), so
  -- this has to be explicit rather than assumed left over from above.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_m, 'kill-switch@imperial.ac.uk',
          '{"first_name":"K","surname":"Switch","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb)
  on conflict do nothing;
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year)
  values (v_m, 'student', 'approved', 'K', 'Switch', 'MEng Computing', 2027)
  on conflict (id) do update set
    status     = excluded.status,
    course     = excluded.course,
    grad_year  = excluded.grad_year;

  update public.app_config set value = 'false' where key = 'github_cv_ingestion_enabled';

  -- 36a. confirm_cv_upload: storage still happens, ingest job does not.
  select count(*) into v_ingest_before from public.jobs where kind = 'ingest_cv';

  perform _set_caller(v_m);
  v_key := public.issue_upload_ticket('cv');
  perform public.confirm_cv_upload(v_key, 'switch-test.pdf', true);
  set local role postgres;

  select cv_path into v_cv_path from public.profiles where id = v_m;
  select count(*) into v_cv_count from public.cvs where member_id = v_m;
  select count(*) into v_ingest_after from public.jobs where kind = 'ingest_cv';

  if v_cv_path is distinct from v_key then
    raise exception 'FAIL: confirm_cv_upload did not store cv_path while the kill switch was off';
  end if;
  if v_cv_count <> 0 then
    raise exception 'FAIL: confirm_cv_upload opened a cvs row while the kill switch was off';
  end if;
  if v_ingest_after <> v_ingest_before then
    raise exception 'FAIL: confirm_cv_upload enqueued an ingest_cv job while the kill switch was off';
  end if;

  -- 36b. confirm_github_connected: connection still recorded, scan job does not.
  select count(*) into v_scan_before from public.jobs where kind = 'scan_github';

  perform _set_caller(v_m);
  perform public.confirm_github_connected(123456789, 'kill-switch-octocat', 'fake-token', 'test-encryption-key-not-real');
  set local role postgres;

  select scan_status into v_gh_status from public.github_connections where member_id = v_m;
  select count(*) into v_scan_after from public.jobs where kind = 'scan_github';

  if v_gh_status is distinct from 'pending' then
    raise exception 'FAIL: confirm_github_connected did not record the connection while the kill switch was off';
  end if;
  if v_scan_after <> v_scan_before then
    raise exception 'FAIL: confirm_github_connected enqueued a scan_github job while the kill switch was off';
  end if;

  -- 36b2. enqueue_github_rescans (20260911000004) self-heals a connection
  -- stranded 'pending' by the switch, but only once it's old enough —
  -- immediately after connecting it must NOT be swept up (that would
  -- double-enqueue a connection whose job is just about to land once the
  -- switch flips back on for real usage, not this synthetic gap).
  perform public.enqueue_github_rescans();
  select count(*) into v_scan_after from public.jobs where kind = 'scan_github';
  if v_scan_after <> v_scan_before then
    raise exception 'FAIL: enqueue_github_rescans swept up a freshly-stranded pending connection too early';
  end if;

  -- 36b3. (20260913000001) Even once the connection IS old enough, the
  -- self-heal must not fire while the switch is still off — that would
  -- re-create the exact job the switch is suppressing. This is the
  -- adversarial-audit finding: the pre-fix body swept this up regardless
  -- of switch state.
  set local role postgres;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.github_connections
     set connected_at = now() - interval '1 hour'
   where member_id = v_m;
  perform public.enqueue_github_rescans();
  select count(*) into v_scan_after from public.jobs where kind = 'scan_github';
  if v_scan_after <> v_scan_before then
    raise exception 'FAIL: enqueue_github_rescans self-healed a stranded pending connection while the kill switch was still off';
  end if;

  -- 36c. Flip back on: the same two RPCs resume enqueuing, proving the
  -- suppression above was the switch and not some other break — and the
  -- now-old-enough stranded connection from 36b3 finally heals on this
  -- same tick, proving the switch being back on is what unblocks it.
  update public.app_config set value = 'true' where key = 'github_cv_ingestion_enabled';

  perform public.enqueue_github_rescans();
  select count(*) into v_scan_after from public.jobs where kind = 'scan_github';
  if v_scan_after <> v_scan_before + 1 then
    raise exception 'FAIL: enqueue_github_rescans did not self-heal a stranded pending connection once the kill switch was back on';
  end if;

  perform _set_caller(v_m);
  v_key := public.issue_upload_ticket('cv');
  perform public.confirm_cv_upload(v_key, 'switch-test-2.pdf', true);
  set local role postgres;

  select count(*) into v_cv_count from public.cvs where member_id = v_m;
  select count(*) into v_ingest_after from public.jobs where kind = 'ingest_cv';
  if v_cv_count <> 1 then
    raise exception 'FAIL: confirm_cv_upload did not open a cvs row once the kill switch was back on';
  end if;
  if v_ingest_after <> v_ingest_before + 1 then
    raise exception 'FAIL: confirm_cv_upload did not enqueue an ingest_cv job once the kill switch was back on';
  end if;
end;
$$;

-- 37. (20260914000001) The weekly staleness rescan is now ALSO paused by
-- the switch — a reversal of 20260911000003/20260913000001's explicit
-- "the weekly rescan is not what this switch controls" stance. Uses its
-- own member with an already-'ready', already-stale connection, so this
-- is independent of block 36's v_m (which never reaches 'ready' in this
-- SQL-only test — no worker runs here to complete a scan).
do $$
declare
  v_m2          uuid := gen_random_uuid();
  v_scan_before int;
  v_scan_after  int;
begin
  set local role postgres;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_m2, 'kill-switch-weekly@imperial.ac.uk',
          '{"first_name":"K2","surname":"Switch","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb)
  on conflict do nothing;
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year)
  values (v_m2, 'student', 'approved', 'K2', 'Switch', 'MEng Computing', 2027)
  on conflict (id) do update set
    status     = excluded.status,
    course     = excluded.course,
    grad_year  = excluded.grad_year;

  insert into public.github_connections
    (member_id, github_user_id, github_username, access_token_encrypted, scan_status, last_scanned_at)
  values
    (v_m2, 987654321, 'weekly-rescan-octocat', '\x00'::bytea, 'ready', now() - interval '8 days')
  on conflict (member_id) do update set
    scan_status     = excluded.scan_status,
    last_scanned_at = excluded.last_scanned_at;

  update public.app_config set value = 'false' where key = 'github_cv_ingestion_enabled';

  select count(*) into v_scan_before from public.jobs where kind = 'scan_github';
  perform public.enqueue_github_rescans();
  select count(*) into v_scan_after from public.jobs where kind = 'scan_github';
  if v_scan_after <> v_scan_before then
    raise exception 'FAIL: enqueue_github_rescans rescanned an already-ready, stale connection while the kill switch was off';
  end if;

  update public.app_config set value = 'true' where key = 'github_cv_ingestion_enabled';

  perform public.enqueue_github_rescans();
  select count(*) into v_scan_after from public.jobs where kind = 'scan_github';
  if v_scan_after <> v_scan_before + 1 then
    raise exception 'FAIL: enqueue_github_rescans did not resume the weekly rescan once the kill switch was back on';
  end if;
end;
$$;

-- 38. (20260914000002) The admin UI toggle for the kill switch: both RPCs
-- reject a non-admin, and an admin's calls actually flip app_config,
-- write an admin_actions row, and are reflected back by the status read.
do $$
declare
  v_admin    uuid := gen_random_uuid();
  v_nonadmin uuid := gen_random_uuid();
  v_value    text;
  v_row      record;
begin
  set local role postgres;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values
    (v_admin, 'ingestion-toggle-admin@imperial.ac.uk',
     '{"first_name":"Toggle","surname":"Admin","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb),
    (v_nonadmin, 'ingestion-toggle-nonadmin@imperial.ac.uk',
     '{"first_name":"Toggle","surname":"NonAdmin","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb)
  on conflict do nothing;
  update public.profiles set status = 'approved', course = 'MEng Computing', grad_year = 2027
   where id in (v_admin, v_nonadmin);
  insert into public.admins (user_id) values (v_admin) on conflict do nothing;

  perform _set_caller(v_nonadmin);

  begin
    perform public.admin_set_ingestion_enabled(false);
    raise exception 'FAIL: non-admin called admin_set_ingestion_enabled without being blocked';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform * from public.admin_get_ingestion_status();
    raise exception 'FAIL: non-admin called admin_get_ingestion_status without being blocked';
  exception when sqlstate '42501' then null;
  end;

  perform _set_caller(v_admin);

  perform public.admin_set_ingestion_enabled(false);
  set local role postgres;
  select value into v_value from public.app_config where key = 'github_cv_ingestion_enabled';
  if v_value <> 'false' then
    raise exception 'FAIL: admin_set_ingestion_enabled(false) did not flip app_config';
  end if;
  if not exists (
    select 1 from public.admin_actions
     where admin_id = v_admin and action = 'pause_github_ingestion' and target_table = 'app_config'
  ) then
    raise exception 'FAIL: admin_set_ingestion_enabled(false) did not log to admin_actions';
  end if;

  perform _set_caller(v_admin);
  select * into v_row from public.admin_get_ingestion_status();
  if v_row.enabled <> false or v_row.last_changed_by <> 'Toggle Admin' then
    raise exception 'FAIL: admin_get_ingestion_status did not reflect the pause (enabled=%, by=%)',
      v_row.enabled, v_row.last_changed_by;
  end if;

  perform public.admin_set_ingestion_enabled(true);
  set local role postgres;
  select value into v_value from public.app_config where key = 'github_cv_ingestion_enabled';
  if v_value <> 'true' then
    raise exception 'FAIL: admin_set_ingestion_enabled(true) did not flip app_config back';
  end if;
end;
$$;

-- ─── Cleanup ────────────────────────────────────────────────────────
-- The test blocks leak the transaction-local 'authenticated' role (see note
-- above), so reset to the owner role before dropping the helper function.
set local role postgres;
drop function _set_caller(uuid);
rollback;
