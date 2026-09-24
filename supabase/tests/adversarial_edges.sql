-- ════════════════════════════════════════════════════════════════════
-- Foundry · Adversarial edge cases
--
-- Companion to rls_smoke.sql, not a replacement. That file asks "does
-- the policy let the right person through?". This one asks "what
-- happens when someone sends something nobody expected?" — malformed
-- payloads, hostile values, lifecycle races, and the states a UI never
-- produces but a direct RPC call can.
--
-- Same conventions as rls_smoke.sql: assertions are `raise exception`,
-- success is SILENT, and the whole file rolls back. An exit code of 0
-- with no output means every assertion held.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/adversarial_edges.sql
--
-- ──────────────────────────────────────────────────────────────────────
-- WHY THESE CASES
-- ──────────────────────────────────────────────────────────────────────
-- The three newest features each added a surface where a *member's*
-- input reaches something privileged:
--
--   listing_edits      a member's jsonb is stored, then later applied to
--                      a published row by an admin's action
--   github showcase    a member's chosen strings become recruiter-facing
--                      links on their profile
--   cv upload          a member's consent flag gates whether their CV
--                      text ever reaches OpenAI
--
-- In each case the interesting question is not "can they read it" but
-- "what is the worst thing they can make happen with a value they
-- control". That is what this file tries.
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

-- ─── Seed ────────────────────────────────────────────────────────────
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_ev    uuid := gen_random_uuid();
  v_op    uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims',
    json_build_object('role','service_role')::text, true);

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
    (v_owner, 'owner@imperial.ac.uk', '{"first_name":"Own","surname":"Er","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb),
    (v_other, 'other@imperial.ac.uk', '{"first_name":"Oth","surname":"Er","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb),
    (v_admin, 'adm@imperial.ac.uk',   '{"first_name":"Ad","surname":"Min","role":"student"}'::jsonb,  '{"provider":"email"}'::jsonb)
  on conflict do nothing;

  insert into public.profiles (id, role, status, first_name, surname, course, grad_year) values
    (v_owner, 'student', 'approved', 'Own','Er', 'Computing', 2027),
    (v_other, 'student', 'approved', 'Oth','Er', 'Computing', 2027),
    (v_admin, 'student', 'approved', 'Ad', 'Min','Computing', 2026)
  on conflict (id) do update set status = excluded.status,
    course = excluded.course, grad_year = excluded.grad_year;

  insert into public.admins (user_id) values (v_admin) on conflict do nothing;

  -- An APPROVED event owned by v_owner. is_society_event deliberately
  -- false: it is one of the fields a revision must never be able to set.
  insert into public.events (
    id, posted_by, status, title, description, luma_link, event_at,
    location, organiser_name, contact_email, approved_at, approved_by, is_society_event
  ) values (v_ev, v_owner, 'approved', 'Adversarial fixture',
            'Description that is at least twenty chars long.', 'https://lu.ma/adv',
            now() + interval '30 days', 'Huxley 340', 'Own Er', 'owner@imperial.ac.uk',
            now(), v_admin, false);

  insert into public.opportunities (
    id, posted_by, status, position_name, company, pay, location_type, description,
    start_month, start_year, application_deadline, contact_email, apply_method,
    approved_at, approved_by
  ) values (v_op, v_owner, 'approved', 'Engineer', 'Co', '£40k', 'remote',
            'Description that is at least twenty chars long.', 3, 2027,
            current_date + 30, 'owner@imperial.ac.uk', 'email', now(), v_admin);

  insert into _ctx (k,v) values
    ('owner',v_owner), ('other',v_other), ('admin',v_admin), ('ev',v_ev), ('op',v_op);
end;
$$;


-- ════════════════════════════════════════════════════════════════════
-- A. PRIVILEGE ESCALATION THROUGH A REVISION PAYLOAD
--
-- The control being tested is apply_listing_edit_payload's hand-written,
-- per-kind column list. `proposed` is jsonb — it can hold ANY key — so
-- the only thing standing between a crafted blob and a self-approved,
-- reassigned, society-badged event is that the applier never reads a key
-- it was not written to read. These tests write the blob directly,
-- bypassing update_event's own jsonb_build_object, because that is
-- exactly what a bug or a compromised call path elsewhere would do.
-- ════════════════════════════════════════════════════════════════════
set local role postgres;
do $$
declare
  v_owner uuid := (select v from _ctx where k='owner');
  v_other uuid := (select v from _ctx where k='other');
  v_admin uuid := (select v from _ctx where k='admin');
  v_ev    uuid := (select v from _ctx where k='ev');
  v_edit  uuid;
  r       record;
begin
  perform _as_service();

  insert into public.listing_edits (listing_kind, listing_id, proposed, proposed_by)
  values ('event', v_ev, jsonb_build_object(
            'title',       'Legitimate looking title',
            'description', 'Description that is at least twenty chars long.',
            'luma_link',   'https://lu.ma/adv',
            'event_at',    (now() + interval '30 days')::text,
            'location',    'Huxley 340',
            'organiser_name', 'Own Er',
            'contact_email',  'owner@imperial.ac.uk',
            'contact_email_visible', false,
            -- everything below is the attack
            'status',           'approved',
            'approved_by',      v_other::text,
            'approved_at',      now()::text,
            'posted_by',        v_other::text,
            'is_society_event', true,
            'id',               gen_random_uuid()::text,
            'created_at',       '1970-01-01T00:00:00Z'
          ), v_owner)
  returning id into v_edit;

  perform _set_caller(v_admin);
  perform public.admin_apply_listing_edit(v_edit);

  set local role none;
  select * into r from public.events where id = v_ev;

  if r.posted_by <> v_owner then
    raise exception 'FAIL(A1): a revision payload reassigned posted_by to %', r.posted_by;
  end if;
  if r.approved_by <> v_admin then
    raise exception 'FAIL(A2): a revision payload rewrote approved_by to %', r.approved_by;
  end if;
  if r.is_society_event then
    raise exception 'FAIL(A3): a revision payload set is_society_event';
  end if;
  if r.id <> v_ev then
    raise exception 'FAIL(A4): a revision payload changed the row id';
  end if;
  -- the legitimate half must still have landed
  if r.title <> 'Legitimate looking title' then
    raise exception 'FAIL(A5): the legitimate part of the payload was not applied (%)', r.title;
  end if;
end;
$$;

-- A6. The same blob through admin_update_listing, which takes a raw
--     payload straight from an admin's request body.
set local role postgres;
do $$
declare
  v_owner uuid := (select v from _ctx where k='owner');
  v_other uuid := (select v from _ctx where k='other');
  v_admin uuid := (select v from _ctx where k='admin');
  v_ev    uuid := (select v from _ctx where k='ev');
  r       record;
begin
  perform _set_caller(v_admin);
  perform public.admin_update_listing('event', v_ev, jsonb_build_object(
    'title',       'Admin direct edit',
    'description', 'Description that is at least twenty chars long.',
    'luma_link',   'https://lu.ma/adv',
    'event_at',    (now() + interval '30 days')::text,
    'location',    'Huxley 340',
    'organiser_name', 'Own Er',
    'contact_email',  'owner@imperial.ac.uk',
    'contact_email_visible', false,
    'posted_by',        v_other::text,
    'status',           'pending',
    'is_society_event', true
  ));

  set local role none;
  select * into r from public.events where id = v_ev;
  if r.posted_by <> v_owner then
    raise exception 'FAIL(A6): admin_update_listing reassigned posted_by';
  end if;
  if r.status <> 'approved' then
    raise exception 'FAIL(A7): admin_update_listing unpublished the listing (%)', r.status;
  end if;
  if r.is_society_event then
    raise exception 'FAIL(A8): admin_update_listing set is_society_event from a payload';
  end if;
end;
$$;

-- A9. Unknown keys are ignored rather than fatal. A payload from an
--     older or newer client must not take down the reviewer's queue.
set local role postgres;
do $$
declare
  v_admin uuid := (select v from _ctx where k='admin');
  v_ev    uuid := (select v from _ctx where k='ev');
  v_txt   text;
begin
  perform _set_caller(v_admin);
  perform public.admin_update_listing('event', v_ev, jsonb_build_object(
    'title',       'Unknown keys survive',
    'description', 'Description that is at least twenty chars long.',
    'luma_link',   'https://lu.ma/adv',
    'event_at',    (now() + interval '30 days')::text,
    'location',    'Huxley 340',
    'organiser_name', 'Own Er',
    'contact_email',  'owner@imperial.ac.uk',
    'contact_email_visible', false,
    'a_column_that_does_not_exist', 'whatever',
    'nested', jsonb_build_object('deep', jsonb_build_array(1,2,3))
  ));
  set local role none;
  select title into v_txt from public.events where id = v_ev;
  if v_txt <> 'Unknown keys survive' then
    raise exception 'FAIL(A9): an unknown key blocked a valid edit';
  end if;
end;
$$;


-- ════════════════════════════════════════════════════════════════════
-- B. REVISION LIFECYCLE RACES
--
-- The states a UI will not produce but a second tab, a retry, or a
-- direct call will.
-- ════════════════════════════════════════════════════════════════════
set local role postgres;
do $$
declare
  v_owner uuid := (select v from _ctx where k='owner');
  v_other uuid := (select v from _ctx where k='other');
  v_admin uuid := (select v from _ctx where k='admin');
  v_ev    uuid := (select v from _ctx where k='ev');
  v_edit  uuid;
  v_ok    boolean;
  v_n     int;
  v_txt   text;
begin
  -- B1. Applying the same revision twice. The second must refuse:
  --     otherwise a double-clicked Approve re-publishes a payload the
  --     admin has already superseded.
  perform _as_service();
  insert into public.listing_edits (listing_kind, listing_id, proposed, proposed_by)
  values ('event', v_ev, jsonb_build_object(
    'title','Double apply','description','Description that is at least twenty chars long.',
    'luma_link','https://lu.ma/adv','event_at',(now() + interval '30 days')::text,
    'location','Huxley 340','organiser_name','Own Er',
    'contact_email','owner@imperial.ac.uk','contact_email_visible',false), v_owner)
  returning id into v_edit;

  perform _set_caller(v_admin);
  perform public.admin_apply_listing_edit(v_edit);

  v_ok := false;
  begin
    perform public.admin_apply_listing_edit(v_edit);
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(B1): the same revision applied twice'; end if;

  -- B2. Rejecting an already-applied revision must also refuse.
  v_ok := false;
  begin
    perform public.admin_reject_listing_edit(v_edit, 'changed my mind');
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(B2): an applied revision was then rejected'; end if;

  -- B3. A rejection with no reason must fail. The organiser being told
  --     "no" with no explanation is the failure mode the CHECK exists
  --     to prevent, and NULL is what an empty form field sends.
  perform _as_service();
  insert into public.listing_edits (listing_kind, listing_id, proposed, proposed_by)
  values ('event', v_ev, jsonb_build_object(
    'title','Needs a reason','description','Description that is at least twenty chars long.',
    'luma_link','https://lu.ma/adv','event_at',(now() + interval '30 days')::text,
    'location','Huxley 340','organiser_name','Own Er',
    'contact_email','owner@imperial.ac.uk','contact_email_visible',false), v_owner)
  returning id into v_edit;

  perform _set_caller(v_admin);
  v_ok := false;
  begin
    perform public.admin_reject_listing_edit(v_edit, null);
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(B3): a revision was rejected with a null reason'; end if;

  -- B4. A non-admin cannot apply or reject, even holding a real edit id.
  perform _set_caller(v_other);
  v_ok := false;
  begin
    perform public.admin_apply_listing_edit(v_edit);
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(B4): a member applied a revision'; end if;

  v_ok := false;
  begin
    perform public.admin_reject_listing_edit(v_edit, 'nope');
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(B5): a member rejected a revision'; end if;

  -- B6. A member cannot propose against somebody else's listing.
  perform _set_caller(v_other);
  v_ok := false;
  begin
    perform public.update_event(v_ev, 'Hijacked',
      'Description that is at least twenty chars long.', 'https://lu.ma/adv',
      now() + interval '30 days', 'Elsewhere', 'Own Er', 'owner@imperial.ac.uk', false);
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(B6): a non-owner staged a revision'; end if;

  -- B7. A stale proposal applies onto CURRENT values, not the values
  --     that were live when it was written. Last-write-wins is the
  --     correct semantic here, but it must be the CURRENT row that gets
  --     the patch — never a resurrection of the snapshot.
  perform _as_service();
  update public.listing_edits set status = 'discarded', reviewed_at = now()
   where listing_id = v_ev and status = 'pending';

  insert into public.listing_edits (listing_kind, listing_id, proposed, proposed_by)
  values ('event', v_ev, jsonb_build_object(
    'title','Proposed before the admin edit',
    'description','Description that is at least twenty chars long.',
    'luma_link','https://lu.ma/adv','event_at',(now() + interval '30 days')::text,
    'location','Huxley 340','organiser_name','Own Er',
    'contact_email','owner@imperial.ac.uk','contact_email_visible',false), v_owner)
  returning id into v_edit;

  -- admin changes the live row underneath the pending proposal
  perform _set_caller(v_admin);
  perform public.admin_update_listing('event', v_ev, jsonb_build_object(
    'title','Admin got there first',
    'description','Description that is at least twenty chars long.',
    'luma_link','https://lu.ma/adv','event_at',(now() + interval '30 days')::text,
    'location','Blackett 202','organiser_name','Own Er',
    'contact_email','owner@imperial.ac.uk','contact_email_visible',false));

  perform public.admin_apply_listing_edit(v_edit);
  set local role none;
  select title into v_txt from public.events where id = v_ev;
  if v_txt <> 'Proposed before the admin edit' then
    raise exception 'FAIL(B7): stale revision did not apply cleanly (%)', v_txt;
  end if;

  -- B8. The applied row records what the listing looked like BEFORE.
  --     Without this the table is not an audit trail.
  select previous->>'title' into v_txt from public.listing_edits where id = v_edit;
  if v_txt <> 'Admin got there first' then
    raise exception 'FAIL(B8): previous snapshot is wrong (%)', coalesce(v_txt,'<null>');
  end if;
end;
$$;

-- B9. A revision whose listing has been deleted must not be applicable.
set local role postgres;
do $$
declare
  v_owner uuid := (select v from _ctx where k='owner');
  v_admin uuid := (select v from _ctx where k='admin');
  v_op    uuid := (select v from _ctx where k='op');
  v_edit  uuid;
  v_ok    boolean;
  v_n     int;
begin
  perform _as_service();
  insert into public.listing_edits (listing_kind, listing_id, proposed, proposed_by)
  values ('opportunity', v_op, jsonb_build_object('position_name','Gone'), v_owner)
  returning id into v_edit;

  delete from public.opportunities where id = v_op;

  select count(*) into v_n from public.listing_edits where id = v_edit;
  if v_n <> 0 then
    raise exception 'FAIL(B9): deleting a listing left its revision behind';
  end if;
end;
$$;


-- ════════════════════════════════════════════════════════════════════
-- C. GITHUB SHOWCASE — member-controlled strings that become
--    recruiter-facing links
--
-- set_my_github_showcase is the one RPC where a member's raw input is
-- meant to end up rendered on their profile. The contract is: at most 3,
-- names resolved SERVER-SIDE against available_repos, blurbs capped.
-- The name lookup is the control that stops an arbitrary URL landing in
-- a link list a recruiter clicks.
-- ════════════════════════════════════════════════════════════════════
set local role postgres;
do $$
declare
  v_owner uuid := (select v from _ctx where k='owner');
  v_ok    boolean;
  v_picks jsonb;
  v_n     int;
  v_blurb text;
begin
  perform _as_service();
  insert into public.github_connections (
    member_id, github_user_id, github_username, access_token_encrypted,
    scan_status, available_repos
  ) values (
    v_owner, 4242, 'owneruser', '\xdeadbeef'::bytea, 'ready',
    jsonb_build_array(
      jsonb_build_object('name','repo-one','description','First', 'url','https://github.com/owneruser/repo-one'),
      jsonb_build_object('name','repo-two','description','Second','url','https://github.com/owneruser/repo-two'),
      jsonb_build_object('name','repo-three','description','Third','url','https://github.com/owneruser/repo-three'),
      jsonb_build_object('name','repo-four','description','Fourth','url','https://github.com/owneruser/repo-four'))
  );

  -- C1. More than three picks must be refused.
  perform _set_caller(v_owner);
  v_ok := false;
  begin
    perform public.set_my_github_showcase(jsonb_build_array(
      jsonb_build_object('name','repo-one'),   jsonb_build_object('name','repo-two'),
      jsonb_build_object('name','repo-three'), jsonb_build_object('name','repo-four')));
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(C1): accepted more than three showcase repos'; end if;

  -- C2. A name not in available_repos must be refused. This is THE
  --     control: without it a crafted name reaches a recruiter's screen.
  v_ok := false;
  begin
    perform public.set_my_github_showcase(jsonb_build_array(
      jsonb_build_object('name','repo-that-does-not-exist')));
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(C2): accepted a repo name not in available_repos'; end if;

  -- C3. An attacker-supplied url/description alongside a VALID name must
  --     not survive: entries are rebuilt server-side from the lookup.
  perform public.set_my_github_showcase(jsonb_build_array(
    jsonb_build_object('name','repo-one',
                       'url','https://evil.invalid/phish',
                       'description','Totally legitimate')));
  set local role none;
  select showcase_repos into v_picks from public.github_connections where member_id = v_owner;
  if v_picks::text like '%evil.invalid%' then
    raise exception 'FAIL(C3): a client-supplied URL was stored in showcase_repos (%)', v_picks::text;
  end if;

  -- C4. Blurbs are capped server-side. The client cap is UX; this is
  --     the enforcement.
  perform _set_caller(v_owner);
  perform public.set_my_github_showcase(jsonb_build_array(
    jsonb_build_object('name','repo-one', 'blurb', repeat('x', 500))));
  set local role none;
  select showcase_repos->0->>'blurb' into v_blurb
    from public.github_connections where member_id = v_owner;
  if v_blurb is not null and length(v_blurb) > 140 then
    raise exception 'FAIL(C4): blurb stored at % chars, cap is 140', length(v_blurb);
  end if;

  -- C5. An empty array clears the picks rather than erroring — this is
  --     the "actually, show none of them" case.
  perform _set_caller(v_owner);
  perform public.set_my_github_showcase('[]'::jsonb);
  set local role none;
  select showcase_repos into v_picks from public.github_connections where member_id = v_owner;
  if v_picks is not null and jsonb_array_length(v_picks) <> 0 then
    raise exception 'FAIL(C5): an empty pick list did not clear the showcase (%)', v_picks::text;
  end if;

  -- C6. Malformed input: an object where an array belongs, and a
  --     non-object entry. Must refuse, not store garbage.
  perform _set_caller(v_owner);
  v_ok := false;
  begin
    perform public.set_my_github_showcase('{"name":"repo-one"}'::jsonb);
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(C6): accepted an object instead of an array'; end if;

  v_ok := false;
  begin
    perform public.set_my_github_showcase('["repo-one"]'::jsonb);
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(C7): accepted a bare string as a pick'; end if;
end;
$$;

-- C8. A member with no github_connections row cannot set a showcase.
set local role postgres;
do $$
declare
  v_other uuid := (select v from _ctx where k='other');
  v_ok    boolean;
begin
  perform _set_caller(v_other);
  v_ok := false;
  begin
    perform public.set_my_github_showcase(jsonb_build_array(jsonb_build_object('name','repo-one')));
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then
    raise exception 'FAIL(C8): a member with no GitHub connection set a showcase';
  end if;
end;
$$;

-- C9. A member cannot read another member's showcase through the RPC.
set local role postgres;
do $$
declare
  v_other uuid := (select v from _ctx where k='other');
  v_n     int;
begin
  perform _set_caller(v_other);
  select count(*) into v_n from public.get_my_github_showcase();
  if v_n > 0 then
    raise exception 'FAIL(C9): get_my_github_showcase returned another member''s row';
  end if;
end;
$$;

-- C10. disconnect_github destroys the picks and the encrypted token with
--      the connection. The privacy promise the UI makes.
set local role postgres;
do $$
declare
  v_owner uuid := (select v from _ctx where k='owner');
  v_n     int;
begin
  perform _set_caller(v_owner);
  perform public.disconnect_github();
  set local role none;
  select count(*) into v_n from public.github_connections where member_id = v_owner;
  if v_n <> 0 then
    raise exception 'FAIL(C10): disconnect_github left the row behind';
  end if;
end;
$$;


-- ════════════════════════════════════════════════════════════════════
-- D. CV UPLOAD CONSENT GATE
--
-- The privacy policy promises CV text is only read if the box is ticked.
-- confirm_cv_upload is where that promise is either kept or broken: an
-- unconsented upload must produce no cvs row and no job, because a job
-- is what carries the text to OpenAI.
-- ════════════════════════════════════════════════════════════════════
set local role postgres;
do $$
declare
  v_owner uuid := (select v from _ctx where k='owner');
  v_other uuid := (select v from _ctx where k='other');
  v_key   text := 'member-cvs/adv/no-consent.pdf';
  v_key2  text := 'member-cvs/adv/with-consent.pdf';
  v_n     int;
  v_ok    boolean;
begin
  perform _as_service();
  insert into public.upload_tickets (blob_key, user_id, purpose)
  values (v_key, v_owner, 'cv'), (v_key2, v_owner, 'cv');

  -- D1. No consent → no cvs row, no job. The CV file still uploads and
  --     profiles.cv_path is still set; what must not happen is ingest.
  perform _set_caller(v_owner);
  perform public.confirm_cv_upload(v_key, 'nocv.pdf', false);
  set local role none;
  select count(*) into v_n from public.cvs where member_id = v_owner;
  if v_n <> 0 then
    raise exception 'FAIL(D1): an unconsented CV created a cvs row';
  end if;
  select count(*) into v_n from public.jobs where kind = 'ingest_cv';
  if v_n <> 0 then
    raise exception 'FAIL(D2): an unconsented CV enqueued an ingest job';
  end if;

  -- D3. With consent → exactly one cvs row and one job.
  perform _set_caller(v_owner);
  perform public.confirm_cv_upload(v_key2, 'yescv.pdf', true);
  set local role none;
  select count(*) into v_n from public.cvs where member_id = v_owner;
  if v_n <> 1 then
    raise exception 'FAIL(D3): consented upload produced % cvs rows', v_n;
  end if;
  select count(*) into v_n from public.jobs where kind = 'ingest_cv';
  if v_n <> 1 then
    raise exception 'FAIL(D4): consented upload produced % ingest jobs', v_n;
  end if;

  -- D5. A consumed ticket cannot be replayed.
  perform _set_caller(v_owner);
  v_ok := false;
  begin
    perform public.confirm_cv_upload(v_key2, 'replay.pdf', true);
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(D5): an upload ticket was replayed'; end if;

  -- D6. Another member cannot confirm somebody else's ticket — that
  --     would attach their blob to the attacker's profile.
  perform _as_service();
  insert into public.upload_tickets (blob_key, user_id, purpose)
  values ('member-cvs/adv/victim.pdf', v_owner, 'cv');

  perform _set_caller(v_other);
  v_ok := false;
  begin
    perform public.confirm_cv_upload('member-cvs/adv/victim.pdf', 'stolen.pdf', true);
    v_ok := true;
  exception when others then null;
  end;
  if v_ok then raise exception 'FAIL(D6): a member confirmed another member''s upload ticket'; end if;
end;
$$;


-- ════════════════════════════════════════════════════════════════════
-- E. GRANT MATRIX
--
-- Asserted with has_function_privilege rather than by calling, and that
-- is not a stylistic preference: the local Postgres image segfaults when
-- a role without EXECUTE calls a plpgsql SECURITY DEFINER function, so a
-- call-and-catch assertion here takes the database down mid-suite and
-- looks like a migration bug. This is the stronger check anyway — it
-- asks about the grant itself rather than inferring it from an error.
-- ════════════════════════════════════════════════════════════════════
set local role postgres;
do $$
declare
  r record;
  v_sig text;
begin
  -- Nothing new is reachable by anon, and the internal appliers are
  -- reachable by nobody but the definer.
  for r in
    select unnest(array[
      'public.set_my_github_showcase(jsonb)',
      'public.get_my_github_showcase()',
      'public.dismiss_my_github_showcase_prompt()',
      'public.set_my_github_nudges(boolean)',
      'public.disconnect_github()',
      'public.confirm_cv_upload(text,text,boolean)',
      'public.get_my_pending_listing_edit(public.listing_event_kind,uuid)',
      'public.listing_has_pending_edit(public.listing_event_kind,uuid)',
      'public.admin_list_listing_edits()',
      'public.admin_apply_listing_edit(uuid)',
      'public.admin_reject_listing_edit(uuid,text)',
      'public.admin_update_listing(public.listing_event_kind,uuid,jsonb)'
    ]) as sig
  loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') then
      raise exception 'FAIL(E1): anon can EXECUTE %', r.sig;
    end if;
    if not has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception 'FAIL(E2): authenticated cannot EXECUTE %', r.sig;
    end if;
  end loop;

  -- The internal helpers a revision passes through must not be callable
  -- by a member at all — reaching stage_listing_edit or
  -- apply_listing_edit_payload directly bypasses the ownership check.
  for r in
    select unnest(array[
      'public.stage_listing_edit(public.listing_event_kind,uuid,jsonb)',
      'public.apply_listing_edit_payload(public.listing_event_kind,uuid,jsonb)',
      'public.listing_snapshot(public.listing_event_kind,uuid)'
    ]) as sig
  loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') then
      raise exception 'FAIL(E3): anon can EXECUTE internal %', r.sig;
    end if;
    if has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception 'FAIL(E4): authenticated can EXECUTE internal %', r.sig;
    end if;
  end loop;

  -- Every new table is deny-all to anon.
  for r in
    select unnest(array['listing_edits','cvs','cv_profiles','cv_chunks',
                        'member_skills','github_connections','jobs']) as t
  loop
    if has_table_privilege('anon', 'public.' || r.t, 'SELECT') then
      raise exception 'FAIL(E5): anon holds SELECT on %', r.t;
    end if;
  end loop;
end;
$$;



-- ════════════════════════════════════════════════════════════════════
-- F. CONNECTIONS — the adversary is a member with a valid session
--
-- rls_smoke §37 asks "does the handshake work and does it hold". This
-- section asks the other question: what can somebody get out of these
-- RPCs by calling them directly, in states the UI never produces?
--
-- The threat model is EMAIL HARVESTING, and it is not hypothetical
-- paranoia about a closed community. Students sign up with predictable
-- @imperial.ac.uk addresses and have little to lose here. Alumni,
-- mentors and ANGEL INVESTORS pass manual review with PERSONAL
-- addresses — non-guessable, high-value, and exactly the cohort a
-- harvester would target. Every case below exists for those rows.
--
-- The second thread running through this section is ENUMERATION. A
-- refusal that varies with the target's state is an oracle: call it
-- across the directory and read off who blocked you, who exists, and
-- who is worth trying. So several cases here assert that two very
-- different situations produce BYTE-IDENTICAL errors.
-- ════════════════════════════════════════════════════════════════════

set local role postgres;

do $$
declare
  v_ids uuid[] := array(select gen_random_uuid() from generate_series(1,6));
  -- victim  an approved member with an address worth taking
  -- attacker an approved member trying to take it
  -- pending  onboarded but never reviewed
  -- banned   reviewed and rejected
  -- partial  approved but has never completed intake
  -- admin    an admin who is also a party to a connection
  v_keys text[] := array['victim','attacker','pending','banned','partial','cadmin'];
  v_st   text[] := array['approved','approved','pending_review','rejected','approved','approved'];
  v_ver  int[]  := array[2,2,2,2,1,2];
  v_i int;
begin
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);

  for v_i in 1..6 loop
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (v_ids[v_i], 'adv-' || v_keys[v_i] || '@imperial.ac.uk',
            json_build_object('first_name', initcap(v_keys[v_i]), 'surname', 'Edge', 'role', 'student')::jsonb,
            '{"provider":"email"}'::jsonb)
    on conflict do nothing;

    insert into public.profiles (id, role, status, first_name, surname, course, grad_year, profile_version)
    values (v_ids[v_i], 'student', v_st[v_i]::user_status, initcap(v_keys[v_i]), 'Edge',
            'MEng Computing', 2027, v_ver[v_i]::smallint)
    on conflict (id) do update set
      status = excluded.status, profile_version = excluded.profile_version,
      course = excluded.course, grad_year = excluded.grad_year;
  end loop;

  insert into public.admins (user_id)
  values (v_ids[array_position(v_keys,'cadmin')]) on conflict do nothing;

  insert into _ctx (k, v) select 'conn_' || v_keys[i], v_ids[i] from generate_series(1,6) i
  on conflict (k) do update set v = excluded.v;

  -- The blocks below read their fixtures in the DECLARE section, and by
  -- then the transaction-local `authenticated` role has leaked in from
  -- the previous block (set_config is transaction-local, and these tests
  -- switch role deliberately). A temp table is owned by postgres and
  -- carries no grant, so without this every DECLARE fails with
  -- "permission denied for table _ctx" before its body ever runs.
  grant select on _ctx to authenticated;
end;
$$;


-- F1. anon reaches NOTHING. Not the tables, not one RPC.
do $$
declare
  v_victim uuid := (select v from _ctx where k='conn_victim');
  fn text;
  v_n int;
begin
  foreach fn in array array[
    'public.send_connection_request(uuid,text,text)',
    'public.respond_to_connection_request(uuid,boolean,text)',
    'public.withdraw_connection_request(uuid)',
    'public.remove_connection(uuid)',
    'public.block_member(uuid)',
    'public.unblock_member(uuid)',
    'public.report_connection(uuid,text,text)',
    'public.list_my_connections(text,text[],text[],text[],text[],int,int,int,timestamptz,uuid)',
    'public.list_my_pending_requests(int,timestamptz,uuid)',
    'public.list_my_sent_requests(int,timestamptz,uuid)',
    'public.connection_state_with(uuid)',
    'public.my_pending_connection_count()',
    'public.list_my_connection_facets()',
    'public.list_my_connection_graph(text,text[],text[],text[],text[],int,int)',
    'public.my_connection_settings()',
    'public.set_connection_settings(boolean,boolean)',
    'public.my_connection_quota()',
    'public.list_newest_events(int)',
    'public.list_newest_opportunities(int)',
    'public.claim_connection_digests(int)',
    'public.complete_connection_digests(uuid,jsonb)',
    'public.expire_connection_requests()',
    'public.purge_removed_connections()',
    'public.purge_connection_records()',
    'public.cron_connection_digest()',
    'public.connection_log_event(uuid,uuid,uuid,text)',
    'public.connection_assert_can_send(uuid)',
    'public.connection_sender_throttled(uuid)',
    'public.connection_refusal_message()',
    'public.connection_clean_note(text)',
    'public.connection_limit_defaults()'
  ] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'FAIL(F1): anon can execute %', fn;
    end if;
  end loop;

  foreach fn in array array['connections','connection_events','connection_reports'] loop
    if has_table_privilege('anon', 'public.' || fn, 'SELECT')
    or has_table_privilege('anon', 'public.' || fn, 'INSERT')
    or has_table_privilege('anon', 'public.' || fn, 'UPDATE')
    or has_table_privilege('anon', 'public.' || fn, 'DELETE') then
      raise exception 'FAIL(F1): anon holds a table privilege on %', fn;
    end if;
  end loop;
end;
$$;


-- F2. A JWT is not membership. An unreviewed, a banned and an
--     intake-incomplete caller all hold a perfectly valid auth.uid() —
--     GoTrue's banned_until takes up to an hour to invalidate an issued
--     token — and none of them may send.
do $$
declare
  v_victim uuid := (select v from _ctx where k='conn_victim');
  v_pending uuid := (select v from _ctx where k='conn_pending');
  v_banned  uuid := (select v from _ctx where k='conn_banned');
  v_partial uuid := (select v from _ctx where k='conn_partial');
  v_v text;
  v_caller uuid;
begin
  set local role none;
  v_v := public.connection_consent_version();

  foreach v_caller in array array[v_pending, v_banned, v_partial] loop
    perform _set_caller(v_caller);
    begin
      perform public.send_connection_request(v_victim, v_v);
      raise exception 'FAIL(F2): % sent a connection request', v_caller;
    exception when sqlstate '42501' then null;
    end;
  end loop;

  -- And none of them can read a connection list either.
  foreach v_caller in array array[v_pending, v_banned] loop
    perform _set_caller(v_caller);
    if (select count(*) from public.list_my_connections()) <> 0 then
      raise exception 'FAIL(F2): % read a connections list', v_caller;
    end if;
    if public.my_pending_connection_count() <> 0 then
      raise exception 'FAIL(F2): % got a badge count', v_caller;
    end if;
  end loop;
end;
$$;


-- F3. THE ENUMERATION ORACLE. Five very different situations must
--     produce one byte-identical refusal. If any of them differs, a
--     member can walk the directory and read off who blocked them, who
--     is real, and who has paused — which is the reconnaissance step of
--     the harvest this feature is designed to prevent.
do $$
declare
  v_attacker uuid := (select v from _ctx where k='conn_attacker');
  v_victim   uuid := (select v from _ctx where k='conn_victim');
  v_banned   uuid := (select v from _ctx where k='conn_banned');
  v_pending  uuid := (select v from _ctx where k='conn_pending');
  v_ghost    uuid := gen_random_uuid();
  v_v text;
  m_ghost text; m_banned text; m_unreviewed text; m_paused text; m_blocked text; m_cooldown text;
  v_id uuid;
begin
  set local role none;
  v_v := public.connection_consent_version();

  perform _set_caller(v_attacker);
  begin perform public.send_connection_request(v_ghost, v_v);
  exception when others then get stacked diagnostics m_ghost = message_text; end;

  begin perform public.send_connection_request(v_banned, v_v);
  exception when others then get stacked diagnostics m_banned = message_text; end;

  begin perform public.send_connection_request(v_pending, v_v);
  exception when others then get stacked diagnostics m_unreviewed = message_text; end;

  -- paused
  perform _set_caller(v_victim);
  perform public.set_connection_settings(p_open => false);
  perform _set_caller(v_attacker);
  begin perform public.send_connection_request(v_victim, v_v);
  exception when others then get stacked diagnostics m_paused = message_text; end;
  perform _set_caller(v_victim);
  perform public.set_connection_settings(p_open => true);

  -- blocked by the victim
  perform _set_caller(v_victim);
  perform public.block_member(v_attacker);
  perform _set_caller(v_attacker);
  begin perform public.send_connection_request(v_victim, v_v);
  exception when others then get stacked diagnostics m_blocked = message_text; end;
  perform _set_caller(v_victim);
  perform public.unblock_member(v_attacker);

  -- on cooldown after a decline
  perform _set_caller(v_attacker);
  v_id := public.send_connection_request(v_victim, v_v);
  perform _set_caller(v_victim);
  perform public.respond_to_connection_request(v_id, false, null);
  perform _set_caller(v_attacker);
  begin perform public.send_connection_request(v_victim, v_v);
  exception when others then get stacked diagnostics m_cooldown = message_text; end;

  if m_ghost is null then raise exception 'FAIL(F3): a request to a non-existent member SUCCEEDED'; end if;
  if m_ghost is distinct from m_banned
     or m_ghost is distinct from m_unreviewed
     or m_ghost is distinct from m_paused
     or m_ghost is distinct from m_blocked
     or m_ghost is distinct from m_cooldown then
    raise exception 'FAIL(F3): refusals are distinguishable — ghost=[%] banned=[%] unreviewed=[%] paused=[%] blocked=[%] cooldown=[%]',
      m_ghost, m_banned, m_unreviewed, m_paused, m_blocked, m_cooldown;
  end if;

  -- connection_state_with must collapse them the same way.
  perform _set_caller(v_attacker);
  if (select state from public.connection_state_with(v_ghost))   <> 'unavailable'
  or (select state from public.connection_state_with(v_banned))  <> 'unavailable'
  or (select state from public.connection_state_with(v_pending)) <> 'unavailable' then
    raise exception 'FAIL(F3): connection_state_with distinguishes a ghost from a banned member';
  end if;
end;
$$;


-- F4. unblock_member must not become a probe. Calling it on somebody who
--     has NOT blocked you has to be silent — an error saying "they
--     didn't block you" would answer, for every member in the
--     directory, whether they had.
do $$
declare
  v_attacker uuid := (select v from _ctx where k='conn_attacker');
  v_victim   uuid := (select v from _ctx where k='conn_victim');
  v_ghost    uuid := gen_random_uuid();
begin
  perform _set_caller(v_victim);
  perform public.block_member(v_attacker);

  perform _set_caller(v_attacker);
  -- The blocked party must not be able to lift it, and must not be told
  -- that is what happened.
  perform public.unblock_member(v_victim);
  perform public.unblock_member(v_ghost);

  set local role none;
  if not exists (
    select 1 from public.connections
     where least(requester_id,addressee_id) = least(v_victim,v_attacker)
       and greatest(requester_id,addressee_id) = greatest(v_victim,v_attacker)
       and status = 'blocked' and blocked_by = v_victim
  ) then
    raise exception 'FAIL(F4): the blocked party lifted their own block';
  end if;

  perform _set_caller(v_victim);
  perform public.unblock_member(v_attacker);

  -- The victim declined this attacker in F3, so a cooldown was running
  -- underneath the block. Lifting the block must NOT lift that — see
  -- F11. Asserted here as well as there, because this is the shape the
  -- bug actually had: the victim's own unblock silently handing the
  -- attacker a fresh run at them.
  set local role none;
  if not exists (
    select 1 from public.connections
     where least(requester_id,addressee_id) = least(v_victim,v_attacker)
       and greatest(requester_id,addressee_id) = greatest(v_victim,v_attacker)
       and status = 'declined'
       and blocked_by is null
       and cooldown_until > now()
  ) then
    raise exception 'FAIL(F4): unblocking dropped the decline cooldown that was running underneath';
  end if;

  -- Teardown, not an assertion: the sections below need this pair back
  -- at no-relationship, and waiting 21 days is not available to them.
  delete from public.connections
   where least(requester_id,addressee_id) = least(v_victim,v_attacker)
     and greatest(requester_id,addressee_id) = greatest(v_victim,v_attacker);
end;
$$;


-- F5. A NON-PARTY cannot touch somebody else's connection. Every one of
--     these takes a connection id, and a uuid is guessable in exactly
--     the sense that matters: it can be pasted from somewhere else.
do $$
declare
  v_attacker uuid := (select v from _ctx where k='conn_attacker');
  v_victim   uuid := (select v from _ctx where k='conn_victim');
  v_admin    uuid := (select v from _ctx where k='conn_cadmin');
  v_v text;
  v_id uuid;
begin
  set local role none;
  v_v := public.connection_consent_version();

  -- A connection between the victim and the admin. The attacker is not
  -- a party to it.
  perform _set_caller(v_admin);
  v_id := public.send_connection_request(v_victim, v_v, 'A note the attacker must never read.');
  perform _set_caller(v_victim);
  perform public.respond_to_connection_request(v_id, true, v_v);

  perform _set_caller(v_attacker);

  begin
    perform public.respond_to_connection_request(v_id, true, v_v);
    raise exception 'FAIL(F5): a non-party accepted somebody else''s request';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.withdraw_connection_request(v_id);
    raise exception 'FAIL(F5): a non-party withdrew somebody else''s request';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.remove_connection(v_id);
    raise exception 'FAIL(F5): a non-party removed somebody else''s connection';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.report_connection(v_id, 'spam', 'Not mine to report.');
    raise exception 'FAIL(F5): a non-party reported somebody else''s connection';
  exception when sqlstate '22023' then null;
  end;

  -- A non-party cannot probe for the note through a constraint
  -- violation either. An invalid category used to reach the INSERT and
  -- come back as a raw 23514 whose `details` carried the whole failing
  -- row, note_snapshot included; the party check above happened to run
  -- first, so this was never a disclosure — but nothing recorded that
  -- the safety was positional. 20260917000015 validates the category
  -- before anything is read, and this asserts BOTH halves: no 23514
  -- escapes, and a non-party still gets the same 22023 as every other
  -- non-party refusal, so the invalid value reveals nothing either.
  begin
    perform public.report_connection(v_id, 'not-a-category', 'Probing for the note text.');
    raise exception 'FAIL(F5): an invalid report category was accepted';
  exception
    when sqlstate '23514' then
      raise exception 'FAIL(F5): an invalid category escaped as a raw constraint violation';
    when sqlstate '22023' then null;
  end;

  -- And the pair is untouched.
  set local role none;
  if (select status from public.connections where id = v_id) <> 'accepted' then
    raise exception 'FAIL(F5): a non-party changed the connection state';
  end if;

  -- The addresses stayed with the two people who agreed to share them.
  perform _set_caller(v_attacker);
  if exists (select 1 from public.list_my_connections() c where c.id in (v_victim, v_admin)) then
    raise exception 'FAIL(F5): a non-party sees the pair in their own connections';
  end if;
end;
$$;


-- F6. THE CAPS HOLD WITH THE UPSTASH LAYER ABSENT. This is the
--     §31k report_post precedent applied to the thing that actually
--     matters here: the rate limiter lives in TypeScript and a direct
--     PostgREST call never touches it. If the database is not the
--     authority, the cap is decoration.
do $$
declare
  v_attacker uuid := (select v from _ctx where k='conn_attacker');
  v_v text;
  v_t uuid;
  v_i int;
  v_sent int := 0;
  v_msg text;
begin
  set local role none;
  v_v := public.connection_consent_version();
  update public.app_config
     set value = jsonb_build_object('daily_cap', 3, 'weekly_cap', 3)::text
   where key = 'connection_limits';

  -- Fresh targets so nothing else about the pair can be the reason.
  for v_i in 1..6 loop
    perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
    set local role none;
    v_t := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (v_t, 'adv-target' || v_i || '@imperial.ac.uk',
            '{"first_name":"Target","surname":"Edge","role":"student"}'::jsonb,
            '{"provider":"email"}'::jsonb);
    insert into public.profiles (id, role, status, first_name, surname, course, grad_year, profile_version)
    values (v_t, 'student', 'approved', 'Target', 'Edge', 'MEng Computing', 2027, 2)
    on conflict (id) do update set status = 'approved', profile_version = 2,
      course = excluded.course, grad_year = excluded.grad_year;

    perform _set_caller(v_attacker);
    begin
      perform public.send_connection_request(v_t, v_v);
      v_sent := v_sent + 1;
    exception when sqlstate '42501' then
      get stacked diagnostics v_msg = message_text;
    end;
    set local role none;
  end loop;

  if v_sent > 3 then
    raise exception 'FAIL(F6): % requests went through a database cap of 3', v_sent;
  end if;
  if v_msg is null then
    raise exception 'FAIL(F6): the cap never refused anything';
  end if;

  -- Deleting the config row must TIGHTEN to the shipped defaults, never
  -- remove the limit. A cap that disappears when its config row does is
  -- a cap that an accidental DELETE turns off.
  delete from public.app_config where key = 'connection_limits';
  if public.connection_limit('daily_cap') <> 10
  or public.connection_limit('weekly_cap') <> 25
  or public.connection_limit('outstanding_cap') <> 30 then
    raise exception 'FAIL(F6): deleting connection_limits did not fall back to the shipped defaults';
  end if;

  -- And a hostile value in it does the same rather than being cast.
  insert into public.app_config (key, value)
  values ('connection_limits', '{"daily_cap": "999999", "weekly_cap": -1}')
  on conflict (key) do update set value = excluded.value;
  if public.connection_limit('daily_cap') <> 10 or public.connection_limit('weekly_cap') <> 25 then
    raise exception 'FAIL(F6): a hostile connection_limits value was honoured';
  end if;

  update public.app_config set value = public.connection_limit_defaults()::text
   where key = 'connection_limits';
end;
$$;


-- F7. The consent stamp cannot be forged or skipped. It is the Art. 7(1)
--     evidence, so a caller inventing its own version string, or
--     replaying an old one after the copy changes, must be refused —
--     and no accepted row may ever exist without one.
do $$
declare
  v_attacker uuid := (select v from _ctx where k='conn_attacker');
  v_victim   uuid := (select v from _ctx where k='conn_victim');
  v_v text;
  v_id uuid;
  v_n int;
begin
  set local role none;
  v_v := public.connection_consent_version();

  perform _set_caller(v_attacker);
  foreach v_v in array array['', 'null', '2026-09-17 ', 'DROP', '1970-01-01'] loop
    begin
      perform public.send_connection_request(v_victim, v_v);
      raise exception 'FAIL(F7): a forged consent version [%] was accepted', v_v;
    exception when sqlstate '22023' then null;
    end;
  end loop;

  set local role none;
  v_v := public.connection_consent_version();
  perform _set_caller(v_attacker);
  v_id := public.send_connection_request(v_victim, v_v);

  perform _set_caller(v_victim);
  begin
    perform public.respond_to_connection_request(v_id, true, 'not-the-live-version');
    raise exception 'FAIL(F7): an accept stamped a forged consent version';
  exception when sqlstate '22023' then null;
  end;

  -- The CHECK constraint is the backstop, and it must hold even against
  -- a direct write with the RPCs bypassed entirely.
  set local role none;
  begin
    update public.connections set status = 'accepted', decided_at = now(), consent_version = null
     where id = v_id;
    raise exception 'FAIL(F7): an accepted row with no consent_version was written directly';
  exception when check_violation then null;
  end;

  select count(*) into v_n from public.connections
   where status = 'accepted' and consent_version is null;
  if v_n <> 0 then
    raise exception 'FAIL(F7): % accepted rows carry no consent evidence', v_n;
  end if;
end;
$$;


-- F8. Hostile note text. The note is the only attacker-controlled STRING
--     in this feature, it is stored, shown to another member, and
--     snapshotted into a moderation queue an admin reads.
do $$
declare
  v_attacker uuid := (select v from _ctx where k='conn_attacker');
  v_v text;
  v_t uuid := gen_random_uuid();
  v_id uuid;
  v_note text;
begin
  set local role none;
  v_v := public.connection_consent_version();
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_t, 'adv-notetarget@imperial.ac.uk',
          '{"first_name":"Note","surname":"Edge","role":"student"}'::jsonb, '{"provider":"email"}'::jsonb);
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year, profile_version)
  values (v_t, 'student', 'approved', 'Note', 'Edge', 'MEng Computing', 2027, 2)
  on conflict (id) do update set status = 'approved', profile_version = 2,
    course = excluded.course, grad_year = excluded.grad_year;

  perform _set_caller(v_attacker);

  -- Over the limit is refused with a sentence, not a constraint dump.
  begin
    perform public.send_connection_request(v_t, v_v, repeat('a', 301));
    raise exception 'FAIL(F8): a 301-character note was accepted';
  exception when sqlstate '22001' then null;
  end;

  -- 300 unicode CHARACTERS is 300, not 1200 bytes. length() is
  -- character-based and the bound has to be too, or an emoji note is
  -- rejected at a quarter of the stated limit.
  v_id := public.send_connection_request(v_t, v_v, repeat('🙂', 300));
  set local role none;
  if length((select note from public.connections where id = v_id)) <> 300 then
    raise exception 'FAIL(F8): a 300-emoji note was not stored as 300 characters';
  end if;

  -- Control characters are stripped and whitespace normalised, so a note
  -- cannot smuggle newlines or NULs into anything downstream.
  perform _set_caller(v_attacker);
  perform public.withdraw_connection_request(v_id);
  set local role none;
  update public.connections set cooldown_until = now() - interval '1 day' where id = v_id;
  perform _set_caller(v_attacker);
  perform public.send_connection_request(v_t, v_v,
    E'line\tone\r\nline   two' || chr(7) || '   ');

  set local role none;
  select note into v_note from public.connections where id = v_id;
  if v_note <> 'line one line two' then
    raise exception 'FAIL(F8): control characters survived note cleaning: [%]', v_note;
  end if;
  if v_note ~ '[[:cntrl:]]' then
    raise exception 'FAIL(F8): the stored note still contains control characters';
  end if;
end;
$$;


-- F9. An admin who is a PARTY to a reported connection is flagged, and
--     revealing a note is logged before the text is handed over. Admins
--     are members here; the conflict is ordinary, not exotic.
do $$
declare
  v_admin  uuid := (select v from _ctx where k='conn_cadmin');
  v_victim uuid := (select v from _ctx where k='conn_victim');
  v_rid uuid;
  v_cid uuid;
  r record;
  v_before int;
  v_note text;
begin
  -- Read the id as the owner. `authenticated` now has no table grant at
  -- all on public.connections (20260917000001 §4b), so doing this after
  -- the role switch fails with a permission error rather than returning
  -- nothing — which is the lockdown behaving correctly.
  set local role none;
  select c.id into v_cid from public.connections c
   where least(c.requester_id, c.addressee_id)    = least(v_admin, v_victim)
     and greatest(c.requester_id, c.addressee_id) = greatest(v_admin, v_victim);
  if v_cid is null then raise exception 'FAIL(F9): fixture connection missing'; end if;

  perform _set_caller(v_victim);

  -- The PARTY case for 20260917000015, and the one that actually
  -- produced the failing-row dump: a party clears the ownership check,
  -- so before the fix an invalid category carried straight into the
  -- INSERT and PostgREST echoed note_snapshot back in the error. A
  -- curated 22023 is the whole assertion; a 23514 here is the
  -- regression.
  begin
    perform public.report_connection(v_cid, 'not-a-category', 'Reporting the admin.');
    raise exception 'FAIL(F9): a party filed a report with an invalid category';
  exception
    when sqlstate '23514' then
      raise exception 'FAIL(F9): an invalid category escaped as a raw constraint violation';
    when sqlstate '22023' then null;
  end;

  -- Same for a reason the table would have rejected: empty, and far over
  -- the 1000-character ceiling. Both are unreachable through the dialog,
  -- which is exactly why they need asserting at the RPC.
  begin
    perform public.report_connection(v_cid, 'harassment', '   ');
    raise exception 'FAIL(F9): an empty report reason was accepted';
  exception
    when sqlstate '23514' then
      raise exception 'FAIL(F9): an empty reason escaped as a raw constraint violation';
    when sqlstate '22023' then null;
  end;

  begin
    perform public.report_connection(v_cid, 'harassment', repeat('x', 1001));
    raise exception 'FAIL(F9): an over-long report reason was accepted';
  exception
    when sqlstate '23514' then
      raise exception 'FAIL(F9): an over-long reason escaped as a raw constraint violation';
    when sqlstate '22023' then null;
  end;

  -- None of those three may have left a row behind.
  set local role none;
  if exists (select 1 from public.connection_reports where connection_id = v_cid) then
    raise exception 'FAIL(F9): a rejected report was filed anyway';
  end if;

  perform _set_caller(v_victim);
  perform public.report_connection(v_cid, 'harassment', 'Reporting the admin.');

  perform _set_caller(v_admin);
  select * into r from public.admin_list_connection_reports('open') q
   where q.reported_member_id = v_admin;
  if r.id is null then raise exception 'FAIL(F9): the report is not in the queue'; end if;
  if not r.admin_is_party then
    raise exception 'FAIL(F9): an admin who is a party to the reported connection was not flagged';
  end if;
  v_rid := r.id;

  set local role none;
  select count(*) into v_before from public.admin_actions where action = 'reveal_connection_note';

  perform _set_caller(v_admin);
  v_note := public.admin_reveal_connection_note(v_rid);

  set local role none;
  if (select count(*) from public.admin_actions where action = 'reveal_connection_note') <> v_before + 1 then
    raise exception 'FAIL(F9): revealing a note wrote no audit row';
  end if;
end;
$$;


-- F10. The graph payload can never become a bulk address export. This is
--      asserted on the FUNCTION SIGNATURE, not on a sample of rows: a
--      row-level check passes trivially on an empty result, whereas a
--      declared column is there whether or not anyone has connections.
do $$
declare
  v_victim uuid := (select v from _ctx where k='conn_victim');
  v_n int;
  r record;
begin
  select count(*) into v_n
    from pg_proc p, unnest(p.proargnames) as n
   where p.proname in ('list_my_connection_graph', 'list_my_pending_requests',
                       'list_my_sent_requests', 'list_my_connection_facets',
                       'connection_state_with', 'admin_list_connection_reports')
     and n ilike '%email%';
  if v_n <> 0 then
    raise exception 'FAIL(F10): % email-shaped output columns on RPCs that must not carry one', v_n;
  end if;

  -- And the one RPC that DOES return an address returns exactly one per
  -- row — the other party's — never a list.
  select count(*) into v_n
    from pg_proc p, unnest(p.proargnames) as n
   where p.proname = 'list_my_connections' and n ilike '%email%';
  if v_n <> 1 then
    raise exception 'FAIL(F10): list_my_connections declares % email columns, want exactly 1', v_n;
  end if;

  -- The graph must not leak an edge the caller is not part of. It
  -- returns NODES only and no edge list at all, which is what makes that
  -- true by construction rather than by filtering.
  select count(*) into v_n
    from pg_proc p, unnest(p.proargnames) as n
   where p.proname = 'list_my_connection_graph'
     and (n ilike '%source%' or n ilike '%target%' or n ilike '%edge%' or n ilike '%mutual%');
  if v_n <> 0 then
    raise exception 'FAIL(F10): the graph payload declares edge-shaped columns';
  end if;
end;
$$;


-- F11. BLOCK IS NOT A COOLDOWN LAUNDERETTE. The 21-day wait after a
--      decline is the only thing standing between a refused member and
--      an unlimited re-ask, and it used to be erasable in two calls the
--      other party never sees: block (which wiped cooldown_until) then
--      unblock (which deleted the row), leaving send_connection_request
--      with no row to read a cooldown off.
--
--      Both halves are asserted, because over-fixing is its own bug: a
--      block with nothing behind it must STILL vanish completely on
--      unblock, or blocking a stranger becomes permanent.
do $$
declare
  v_x   uuid := gen_random_uuid();
  v_y   uuid := gen_random_uuid();
  v_z   uuid := gen_random_uuid();
  v_v   text;
  v_id  uuid;
  v_cd  timestamptz;
  v_cd2 timestamptz;
  v_st  text;
  v_rs  text;
  v_n   int;
  v_msg text;
  v_ghost_msg text;
  v_generic text;
begin
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  set local role none;
  v_v := public.connection_consent_version();
  -- Captured while unprivileged-role-free: the comparison below happens
  -- inside an exception handler running as a member, who cannot call it.
  v_generic := public.connection_refusal_message();

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_x, 'adv-launder-x@imperial.ac.uk',
          '{"first_name":"Xavier","surname":"Launder","role":"student"}'::jsonb,
          '{"provider":"email"}'::jsonb),
         (v_y, 'adv-launder-y@imperial.ac.uk',
          '{"first_name":"Yara","surname":"Launder","role":"student"}'::jsonb,
          '{"provider":"email"}'::jsonb),
         (v_z, 'adv-launder-z@imperial.ac.uk',
          '{"first_name":"Zed","surname":"Launder","role":"student"}'::jsonb,
          '{"provider":"email"}'::jsonb);

  insert into public.profiles (id, role, status, first_name, surname, course, grad_year, profile_version)
  values (v_x, 'student', 'approved', 'Xavier', 'Launder', 'MEng Computing', 2027, 2),
         (v_y, 'student', 'approved', 'Yara',   'Launder', 'MEng Computing', 2027, 2),
         (v_z, 'student', 'approved', 'Zed',    'Launder', 'MEng Computing', 2027, 2)
  on conflict (id) do update set status = 'approved', profile_version = 2,
    course = excluded.course, grad_year = excluded.grad_year;

  -- ── The attack, step by step ──────────────────────────────────────
  perform _set_caller(v_x);
  v_id := public.send_connection_request(v_y, v_v);
  perform _set_caller(v_y);
  perform public.respond_to_connection_request(v_id, false, null);

  set local role none;
  select cooldown_until, status into v_cd, v_st from public.connections where id = v_id;
  if v_cd is null or v_cd <= now() then
    raise exception 'FAIL(F11): a decline did not leave a live cooldown (status=%, until=%)', v_st, v_cd;
  end if;

  -- X blocks. The cooldown must survive, and the row must remember what
  -- it goes back to.
  perform _set_caller(v_x);
  perform public.block_member(v_y);
  set local role none;
  select status, cooldown_until, unblock_restore_status
    into v_st, v_cd2, v_rs
    from public.connections where id = v_id;
  if v_st <> 'blocked' then
    raise exception 'FAIL(F11): block did not take (status=%)', v_st;
  end if;
  if v_cd2 is distinct from v_cd then
    raise exception 'FAIL(F11): block MOVED the cooldown — was %, now %', v_cd, v_cd2;
  end if;
  if v_rs is distinct from 'declined' then
    raise exception 'FAIL(F11): block did not record the restore status (got %)', v_rs;
  end if;

  -- X unblocks. The row must SURVIVE, back in its cooldown.
  perform _set_caller(v_x);
  perform public.unblock_member(v_y);
  set local role none;
  select count(*) into v_n from public.connections where id = v_id;
  if v_n <> 1 then
    raise exception 'FAIL(F11): unblock DELETED a row that was still serving a cooldown';
  end if;
  select status, cooldown_until, blocked_by, unblock_restore_status
    into v_st, v_cd2, v_id, v_rs
    from public.connections
   where least(requester_id, addressee_id) = least(v_x, v_y)
     and greatest(requester_id, addressee_id) = greatest(v_x, v_y);
  if v_st <> 'declined' or v_cd2 is distinct from v_cd or v_id is not null or v_rs is not null then
    raise exception 'FAIL(F11): unblock restored badly — status=% until=% blocked_by=% restore=%',
      v_st, v_cd2, v_id, v_rs;
  end if;

  -- And the whole point: the re-request is still refused, with the
  -- generic message rather than anything that names a cooldown.
  perform _set_caller(v_x);
  begin
    perform public.send_connection_request(v_y, v_v);
    raise exception 'FAIL(F11): block+unblock LAUNDERED the cooldown — the re-request went through';
  exception
    when sqlstate '42501' then
      get stacked diagnostics v_msg = message_text;
      if v_msg is distinct from v_generic then
        raise exception 'FAIL(F11): the post-unblock refusal is distinguishable: [%]', v_msg;
      end if;
  end;

  -- ── The other half: a block with nothing behind it still vanishes ──
  perform _set_caller(v_x);
  perform public.block_member(v_z);
  perform public.unblock_member(v_z);
  set local role none;
  select count(*) into v_n from public.connections
   where least(requester_id, addressee_id) = least(v_x, v_z)
     and greatest(requester_id, addressee_id) = greatest(v_x, v_z);
  if v_n <> 0 then
    raise exception 'FAIL(F11): unblocking a bare block left a row behind — blocking a stranger is now permanent';
  end if;
  perform _set_caller(v_x);
  perform public.send_connection_request(v_z, v_v);   -- must simply work

  -- ── And blocking a LIVE relationship starts a cooldown of its own ──
  -- Blocking an accepted connection destroys it, which is a removal, so
  -- it carries removal's 21 days. Without this, block+unblock is the
  -- remove-and-instantly-re-request loop under another name.
  set local role none;
  select id into v_id from public.connections
   where least(requester_id, addressee_id) = least(v_x, v_z)
     and greatest(requester_id, addressee_id) = greatest(v_x, v_z);
  perform _set_caller(v_z);
  perform public.respond_to_connection_request(v_id, true, v_v);
  perform _set_caller(v_x);
  perform public.block_member(v_z);
  perform public.unblock_member(v_z);
  set local role none;
  select status, cooldown_until into v_st, v_cd from public.connections
   where least(requester_id, addressee_id) = least(v_x, v_z)
     and greatest(requester_id, addressee_id) = greatest(v_x, v_z);
  if v_st is distinct from 'removed' or v_cd is null or v_cd <= now() then
    raise exception 'FAIL(F11): blocking an accepted connection then unblocking left no cooldown (status=%, until=%)',
      v_st, v_cd;
  end if;

  -- ── F12a. Blocking a ghost must be indistinguishable from blocking a
  --     real member. The insert used to catch only unique_violation, so
  --     a random uuid raised a raw 23503 while a real id returned
  --     quietly — an account-existence oracle, which F3 forbids.
  perform _set_caller(v_x);
  begin
    perform public.block_member(gen_random_uuid());
  exception when others then
    get stacked diagnostics v_ghost_msg = message_text;
  end;
  if v_ghost_msg is not null then
    raise exception 'FAIL(F12a): blocking a non-existent member answered back: [%]', v_ghost_msg;
  end if;
  set local role none;
end;
$$;


-- F12b. BLOCK HAS A DATABASE-SIDE CAP. block does not respond to an
--       existing row — it takes an arbitrary member id and CREATES one
--       from nothing — so it is a write amplifier in the same shape as
--       send, and the TypeScript rate limiter is not in the path of a
--       direct PostgREST call.
do $$
declare
  v_a   uuid := gen_random_uuid();
  v_t   uuid;
  v_i   int;
  v_ok  int := 0;
  v_msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  set local role none;

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v_a, 'adv-blockcap@imperial.ac.uk',
          '{"first_name":"Blocky","surname":"Cap","role":"student"}'::jsonb,
          '{"provider":"email"}'::jsonb);
  insert into public.profiles (id, role, status, first_name, surname, course, grad_year, profile_version)
  values (v_a, 'student', 'approved', 'Blocky', 'Cap', 'MEng Computing', 2027, 2)
  on conflict (id) do update set status = 'approved', profile_version = 2,
    course = excluded.course, grad_year = excluded.grad_year;

  update public.app_config
     set value = (value::jsonb || jsonb_build_object('block_daily_cap', 2))::text
   where key = 'connection_limits';

  for v_i in 1..5 loop
    perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
    set local role none;
    v_t := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (v_t, 'adv-blocktarget' || v_i || '@imperial.ac.uk',
            '{"first_name":"Target","surname":"Block","role":"student"}'::jsonb,
            '{"provider":"email"}'::jsonb);
    insert into public.profiles (id, role, status, first_name, surname, course, grad_year, profile_version)
    values (v_t, 'student', 'approved', 'Target', 'Block', 'MEng Computing', 2027, 2)
    on conflict (id) do update set status = 'approved', profile_version = 2,
      course = excluded.course, grad_year = excluded.grad_year;

    perform _set_caller(v_a);
    begin
      perform public.block_member(v_t);
      v_ok := v_ok + 1;
    exception when sqlstate '42501' then
      get stacked diagnostics v_msg = message_text;
    end;
    set local role none;
  end loop;

  if v_ok > 2 then
    raise exception 'FAIL(F12b): % blocks went through a database cap of 2', v_ok;
  end if;
  if v_msg is null then
    raise exception 'FAIL(F12b): the block cap never refused anything';
  end if;

  -- Deleting the key must fall back to the shipped default, not to no
  -- cap at all — the same discipline every other limit is held to.
  update public.app_config
     set value = ((value::jsonb) - 'block_daily_cap')::text
   where key = 'connection_limits';
  if public.connection_limit('block_daily_cap') <> 20 then
    raise exception 'FAIL(F12b): removing block_daily_cap did not fall back to the shipped default';
  end if;

  update public.app_config set value = public.connection_limit_defaults()::text
   where key = 'connection_limits';
end;
$$;


set local role postgres;
drop function _set_caller(uuid);
drop function _as_service();
rollback;
