-- ════════════════════════════════════════════════════════════════════
-- Foundry · Concurrency hardening (pre-launch write-path audit)
--
-- Findings this closes (reproduced first by server/tests/integration/
-- test_worker_races.py and test_concurrency.py, see docs/audits/D10-concurrency-second-pass.md):
--
--   F1/F2/F7  The CV worker publishes after a slow LLM call without asking
--             whether the member still wants that CV. A removed CV came back
--             (profile, chunks, skills); an older upload finishing late became
--             current. `worker_cv_wanted` is the question; remove_my_cv and
--             confirm_cv_upload take the same per-member lock, so a publish and a
--             removal always serialise.
--   F3        disconnect_github deleted the skills and then the connection row, so a
--             scan publishing in between wrote the skills back. The row goes first
--             now: its delete waits for an in-flight publish, then the skills go.
--   F5/F6     issue_upload_ticket (60 outstanding), report_post and report_connection
--             (10 a day) counted and then inserted with no lock, so a parallel burst
--             passed the cap together. A per-member advisory lock, in the same key
--             style as create_post and the submit_* functions, closes it.
--   F8        admin_set_committee read the old flag without a row lock: a grant and a
--             revoke at once could leave an admin whose committee flag is off.
--   F10       set_cv_suggested_skills now says which CV the suggestions were parsed
--             from and writes only if that is still the member's CV and parsing is
--             still consented to. The key is optional, so a frontend deployed before
--             this migration (it sends only the skills) keeps working.
--
-- Every function below is recreated from its latest definition with the same
-- signature (20260901000008 / 20260830000001 / 20260917000015 / 20260912000001 /
-- 20261011000001 / 20260911000001 / 20261026000005 / 20260901000012), so grants are
-- kept and no dead overload is left behind. The one signature that changes,
-- set_cv_suggested_skills, drops the old one in the same migration.
--
-- Pre-check: none (no data changes, no constraints added).
-- Deploy order: this migration BEFORE the worker image that calls worker_cv_wanted.
-- Rollback: re-apply the listed earlier definitions; drop worker_cv_wanted; recreate
-- set_cv_suggested_skills(smallint[]).
-- ════════════════════════════════════════════════════════════════════

-- ─── F5: outstanding upload tickets ─────────────────────────────────
create or replace function public.issue_upload_ticket(p_purpose text default 'post_image'::text)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller uuid := auth.uid();
  v_key    text;
  v_open   int;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can upload' using errcode = '42501';
  end if;
  if p_purpose not in ('post_image', 'profile_picture', 'cv') then
    raise exception 'Unsupported upload purpose: %', p_purpose using errcode = '22023';
  end if;
  -- The community kill switch governs post images only. A CV or avatar
  -- upload has nothing to do with whether the feed is currently open.
  if p_purpose = 'post_image' and not public.posting_enabled() then
    raise exception 'Community posting is currently disabled' using errcode = '42501';
  end if;
  -- One caller at a time past this point, so the count below includes the
  -- ticket a concurrent call is about to insert.
  perform pg_advisory_xact_lock(hashtextextended('issue_upload_ticket:' || v_caller::text, 0));
  -- Outstanding, not issued-per-hour — see 20260830000001. Kept as one
  -- shared ceiling across all three purposes: a member holds at most one
  -- unconsumed avatar ticket and one CV ticket at a time in the normal
  -- flow, so this cannot be approached by the new purposes alone.
  select count(*) into v_open
    from public.upload_tickets t
   where t.user_id = v_caller
     and t.consumed_at is null;
  if v_open >= 60 then
    raise exception 'Too many uploads in progress. Finish or discard one first.'
      using errcode = '42501';
  end if;
  v_key := gen_random_uuid()::text || case p_purpose
    when 'cv' then '.cv'
    else '.webp'
  end;
  insert into public.upload_tickets (blob_key, user_id, purpose)
  values (v_key, v_caller, p_purpose);
  return v_key;
end;
$function$;

-- ─── F6: daily report caps ──────────────────────────────────────────
create or replace function public.report_post(p_post_id uuid, p_category text, p_reason text)
returns table(filed boolean, post_title text)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller   uuid := auth.uid();
  v_title    text;
  v_author   uuid;
  v_count    int;
  v_inserted boolean := false;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can report posts' using errcode = '42501';
  end if;

  -- Serialise one reporter's calls so the count below sees the report a
  -- concurrent call is about to file.
  perform pg_advisory_xact_lock(hashtextextended('report_post:' || v_caller::text, 0));

  -- Backstop against report-bombing driven straight at the RPC. The unique
  -- index already stops repeat reports of the SAME post; this is what stops
  -- one member working through everyone else's.
  select count(*) into v_count
    from public.post_reports r
   where r.reporter_id = v_caller
     and r.created_at > now() - interval '24 hours';
  if v_count >= 10 then
    raise exception 'You have reported several posts today. Please email us if something urgent needs attention.'
      using errcode = '42501';
  end if;

  select title, author_id into v_title, v_author from public.posts where id = p_post_id;
  if v_title is null then
    raise exception 'Post not found — it may have already been deleted';
  end if;
  if v_author = v_caller then
    raise exception 'You cannot report your own post';
  end if;

  insert into public.post_reports (post_id, post_title_snapshot, reporter_id, category, reason)
  values (p_post_id, v_title, v_caller, p_category, trim(p_reason))
  on conflict do nothing;

  -- FOUND after an INSERT ... ON CONFLICT DO NOTHING is false when the
  -- conflict fired. That is the whole signal: true means this is news.
  get diagnostics v_count = row_count;
  v_inserted := v_count > 0;

  -- The title comes from the database, never from the caller. It lands in a
  -- moderator's inbox, and a client-supplied one would let a reporter
  -- describe someone else's post however they liked.
  return query select v_inserted, v_title;
end;
$function$;

create or replace function public.report_connection(p_id uuid, p_category text, p_reason text)
returns table(filed boolean, reported_name text, category text)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.connections%rowtype;
  v_other  uuid;
  v_count  int;
  v_filed  boolean;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can report' using errcode = '42501';
  end if;

  -- Both checks are BEFORE the row is read, so an invalid category can
  -- never reach the insert and never provoke a failing-row dump. The
  -- list is the table's CHECK constraint restated; if one changes the
  -- other has to, and the rls_smoke assertion holds them together.
  if p_category is null or p_category not in
       ('harassment', 'spam', 'impersonation', 'illegal', 'hate', 'sexual', 'other') then
    raise exception 'Choose a reason from the list.' using errcode = '22023';
  end if;

  if length(v_reason) < 1 or length(v_reason) > 1000 then
    raise exception 'Tell us what happened, in 1000 characters or fewer.' using errcode = '22023';
  end if;

  select * into v_row
    from public.connections c
   where c.id = p_id
     and (c.requester_id = v_caller or c.addressee_id = v_caller);

  if v_row.id is null then
    raise exception 'That request no longer exists.' using errcode = '22023';
  end if;

  v_other := case when v_row.requester_id = v_caller then v_row.addressee_id else v_row.requester_id end;

  -- Serialise one reporter's calls so the count below sees the report a
  -- concurrent call is about to file.
  perform pg_advisory_xact_lock(hashtextextended('report_connection:' || v_caller::text, 0));

  -- Backstop against report-bombing aimed straight at the RPC. The
  -- unique index already stops repeat reports of the SAME connection;
  -- this is what stops one member working through everyone who has ever
  -- written to them. Mirrors the hardened report_post (20260830000001).
  select count(*) into v_count
    from public.connection_reports r
   where r.reporter_id = v_caller
     and r.created_at > now() - interval '24 hours';

  if v_count >= 10 then
    raise exception 'You''ve filed several reports recently. Please give us time to review them.'
      using errcode = '42501';
  end if;

  insert into public.connection_reports
    (connection_id, reporter_id, reported_member_id, category, reason, note_snapshot)
  values (p_id, v_caller, v_other, p_category, v_reason, v_row.note)
  on conflict do nothing;

  -- `found` after an INSERT is whether a row went in, and it is read
  -- IMMEDIATELY: the SELECT below would clobber it, which is the
  -- plpgsql trap this codebase has already been bitten by.
  v_filed := found;

  -- Logged whether or not the insert was a duplicate, so the silent
  -- idempotency above does not also silently swallow the audit trail.
  -- Note the event is 'reported', NOT 'report_upheld' — filing a report
  -- is not itself a reputation signal, or reporting would be a weapon.
  -- Only an admin upholding it writes the signal row.
  perform public.connection_log_event(p_id, v_caller, v_other, 'reported');

  return query
    select v_filed,
           trim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.surname, '')),
           p_category
      from public.profiles p
     where p.id = v_other;

  -- A member whose account vanished between the connection read and here
  -- leaves the join empty. The report is filed and committed regardless,
  -- so the caller gets a row saying so rather than nothing at all.
  if not found then
    return query select v_filed, ''::text, p_category;
  end if;
end;
$function$;

-- ─── F1/F2/F7: is this CV still the member's CV? ────────────────────
-- Called by the worker as the first statement of a publish transaction and
-- before it spends anything. The lock is held to the end of that transaction,
-- so remove_my_cv / confirm_cv_upload (which take the same lock) wait for a
-- publish in progress and a publish waits for them. True iff the profile still
-- points at this CV's blob: a removed CV (cv_path null) and a replaced one
-- (cv_path is a newer blob) both read false.
create or replace function public.worker_cv_wanted(p_cv_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member uuid;
  v_key    text;
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select member_id, blob_key into v_member, v_key from public.cvs where id = p_cv_id;
  if v_member is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member_cv:' || v_member::text, 0));
  return exists (select 1 from public.profiles p where p.id = v_member and p.cv_path = v_key);
end;
$function$;

revoke all on function public.worker_cv_wanted(uuid) from public, anon, authenticated;
grant execute on function public.worker_cv_wanted(uuid) to cv_worker;

create or replace function public.remove_my_cv()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_role   text;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  -- Same lock the worker takes before it publishes (worker_cv_wanted).
  perform pg_advisory_xact_lock(hashtextextended('member_cv:' || v_caller::text, 0));
  select role into v_role from public.profiles where id = v_caller;
  if v_role = 'student' then
    raise exception 'CVs are required for students and cannot be removed — upload a replacement instead'
      using errcode = '42501';
  end if;
  perform set_config('foundry.media_write', 'true', true);
  update public.profiles
     set cv_path                 = null,
         cv_uploaded_at          = null,
         cv_original_filename    = null,
         cv_parse_consent        = false,
         cv_parse_consent_at     = null,
         cv_suggested_skill_ids  = null
   where id = v_caller;
  perform set_config('foundry.media_write', 'false', true);
  update public.cvs set is_current = false where member_id = v_caller and is_current;
  update public.cv_profiles cp
     set is_current = false
    from public.cvs c
   where c.id = cp.cv_id and c.member_id = v_caller and cp.is_current;
  update public.cv_chunks set is_current = false where member_id = v_caller and is_current;
  delete from public.member_skills where member_id = v_caller and source = 'cv';
end;
$function$;

create or replace function public.confirm_cv_upload(p_blob_key text, p_filename text, p_consent boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_name   text;
  v_cv_id  uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  -- Same lock the worker takes before it publishes (worker_cv_wanted), taken
  -- first so the lock order is always: member CV lock, then rows.
  perform pg_advisory_xact_lock(hashtextextended('member_cv:' || v_caller::text, 0));
  -- Claim the ticket in one statement: the WHERE clause is the whole
  -- check, so two overlapping confirms cannot both pass it (S0).
  update public.upload_tickets
     set consumed_at = now()
   where blob_key = p_blob_key
     and user_id = v_caller
     and purpose = 'cv'
     and consumed_at is null;
  if not found then
    raise exception 'That upload ticket is invalid, expired, or already used'
      using errcode = '42501';
  end if;
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
$function$;

-- ─── F10: suggestions say which CV they came from ───────────────────
drop function public.set_cv_suggested_skills(smallint[]);

create function public.set_cv_suggested_skills(p_skill_ids smallint[], p_blob_key text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  -- The page parses the file after it has already answered, which takes
  -- seconds. By then the member may have replaced or removed the CV, or
  -- withdrawn consent; with a key given, only the CV that was parsed may
  -- write. A null key (a page deployed before this migration) keeps the old
  -- behaviour.
  update public.profiles
     set cv_suggested_skill_ids = p_skill_ids
   where id = v_caller
     and (p_blob_key is null or (cv_path = p_blob_key and cv_parse_consent));
end;
$function$;

revoke all on function public.set_cv_suggested_skills(smallint[], text) from public, anon;
grant execute on function public.set_cv_suggested_skills(smallint[], text) to authenticated, service_role;

-- ─── F3: disconnect, connection row first ───────────────────────────
create or replace function public.disconnect_github()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  -- The connection row goes FIRST. A scan publishes its skills in a
  -- transaction that holds this row (for update), so this delete waits for
  -- it to finish and the skills deleted next include the ones it just wrote.
  -- The other way round, a scan could write them back after they were deleted.
  delete from public.github_connections where member_id = v_caller;
  delete from public.member_skills where member_id = v_caller and source = 'github';
  insert into public.jobs (kind, payload)
  values ('refresh_github_summary', jsonb_build_object('member_id', v_caller));
end;
$function$;

-- ─── F8: committee flag, row lock on the read ───────────────────────
create or replace function public.admin_set_committee(p_member_id uuid, p_is_committee boolean, p_committee_role text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller uuid := auth.uid();
  v_was_committee boolean;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_is_committee and coalesce(trim(p_committee_role), '') = '' then
    raise exception 'A committee role is required' using errcode = '22023';
  end if;
  -- Locked: a grant and a revoke at the same moment must each see the
  -- other's result, or the admins row and the flag can end up disagreeing.
  select is_committee into v_was_committee from public.profiles where id = p_member_id for update;
  if not found then
    raise exception 'Member not found' using errcode = '22023';
  end if;
  update public.profiles
     set is_committee   = p_is_committee,
         committee_role = case when p_is_committee then trim(p_committee_role) else null end
   where id = p_member_id;
  if p_is_committee and not v_was_committee then
    insert into public.admins (user_id, granted_by_committee) values (p_member_id, true)
      on conflict (user_id) do nothing;
    insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
      values (v_caller, 'grant_committee_admin', 'admins', p_member_id, null);
  elsif v_was_committee and not p_is_committee then
    delete from public.admins where user_id = p_member_id and granted_by_committee;
    insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
      values (v_caller, 'revoke_committee_admin', 'admins', p_member_id, null);
  end if;
end;
$function$;
