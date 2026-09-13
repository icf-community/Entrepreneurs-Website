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

set local role postgres;
drop function _set_caller(uuid);
drop function _as_service();
rollback;
