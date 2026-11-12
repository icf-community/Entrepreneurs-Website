-- Whole-app concurrency fixes (programme S0, docs/audits/D9-concurrency.md).
--
-- Every fix here was found by server/tests/integration/test_concurrency.py,
-- which forces the interleaving (the first call's transaction holds its
-- row locks while the second runs) and failed on the previous definitions.
-- Each function is recreated from its LATEST definition with one change;
-- signatures, return types, owners and grants are unchanged.
--
--   * approve/reject (listings and members), resolving a report, removing
--     a post, deleting an account: the "is it still pending / does it
--     still exist?" check now locks the row, so two admins acting at once
--     get one decision, one audit row and one email, not two.
--   * confirm_cv_upload / confirm_avatar_upload: the ticket is claimed in
--     one conditional UPDATE. A double confirm queued two paid ingestion
--     jobs from one ticket.
--   * create_post / toggle_post_like: serialised per member (and post),
--     so the duplicate check catches an overlapping double submit and a
--     double tap no longer raises a raw unique violation.
--   * update_event / update_vc_grant / update_opportunity: the listing is
--     locked before its status is read. An edit racing an approval used to
--     read 'pending' and then write straight onto the approved listing,
--     live and unreviewed.
--   * background jobs: one BEFORE INSERT trigger makes "queue unless one is
--     already pending" hold under concurrency for every enqueuer, SQL or
--     worker, instead of seven separate fixes.
--   * approval and resolution metadata: an admin who approved or rejected a
--     listing, or resolved a post or connection report, could not delete
--     their account (or be deleted): the decider column is ON DELETE SET
--     NULL and a CHECK demanded it non-null. A decision keeps its time; the
--     decider may since have left. supabase/tests/rls_smoke.sql scans for
--     the pattern so it cannot come back.

-- ─── Approval metadata survives the approver's account deletion ─────
alter table public.opportunities drop constraint opportunities_approval_metadata;
alter table public.opportunities add constraint opportunities_approval_metadata check (
  (status in ('approved', 'rejected', 'expired') and approved_at is not null)
  or (status = 'pending' and approved_at is null and approved_by is null));
alter table public.events drop constraint events_approval_metadata;
alter table public.events add constraint events_approval_metadata check (
  (status in ('approved', 'rejected', 'expired') and approved_at is not null)
  or (status = 'pending' and approved_at is null and approved_by is null));
alter table public.vcs_grants drop constraint vcs_grants_approval_metadata;
alter table public.vcs_grants add constraint vcs_grants_approval_metadata check (
  (status in ('approved', 'rejected', 'expired') and approved_at is not null)
  or (status = 'pending' and approved_at is null and approved_by is null));
-- Same shape on the two report tables (resolved_by is ON DELETE SET NULL):
-- an admin who resolved a report could not delete their account. Found by
-- a schema scan for every CHECK that requires a SET NULL column.
alter table public.post_reports drop constraint post_reports_resolution;
alter table public.post_reports add constraint post_reports_resolution check (
  (status = 'open' and resolved_at is null and resolved_by is null)
  or (status <> 'open' and resolved_at is not null));
alter table public.connection_reports drop constraint connection_reports_resolution;
alter table public.connection_reports add constraint connection_reports_resolution check (
  (status = 'open' and resolved_at is null and resolved_by is null)
  or (status <> 'open' and resolved_at is not null));

-- approve_event: lock the row before the pending check (a concurrent approve and reject both passed it).
create or replace function public.approve_event(
  p_event_id uuid,
  p_notes    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  select status into v_status from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found: %', p_event_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Event is not pending review (status=%)', v_status;
  end if;

  update public.events
     set status          = 'approved',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = null
   where id = p_event_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'approve_event', 'events', p_event_id, p_notes);
end;
$$;

-- reject_event: lock the row before the pending check (a concurrent approve and reject both passed it).
create or replace function public.reject_event(
  p_event_id uuid,
  p_reason   text
)
returns table(email text, first_name text, title text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Rejection reason is required';
  end if;

  select status into v_status from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found: %', p_event_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Event is not pending review (status=%)', v_status;
  end if;

  update public.events
     set status          = 'rejected',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = p_reason
   where id = p_event_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'reject_event', 'events', p_event_id, p_reason);

  return query
    select au.email::text, p.first_name, e.title
      from public.events e
      join public.profiles p on p.id = e.posted_by
      join auth.users au     on au.id = e.posted_by
     where e.id = p_event_id;
end;
$$;

-- approve_opportunity: lock the row before the pending check (a concurrent approve and reject both passed it).
create or replace function public.approve_opportunity(
  p_opportunity_id uuid,
  p_notes          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  select status into v_status from public.opportunities where id = p_opportunity_id for update;
  if not found then
    raise exception 'Opportunity not found: %', p_opportunity_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Opportunity is not pending review (status=%)', v_status;
  end if;

  update public.opportunities
     set status          = 'approved',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = null
   where id = p_opportunity_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'approve_opportunity', 'opportunities', p_opportunity_id, p_notes);
end;
$$;

-- reject_opportunity: lock the row before the pending check (a concurrent approve and reject both passed it).
create or replace function public.reject_opportunity(
  p_opportunity_id uuid,
  p_reason         text
)
returns table(email text, first_name text, title text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Rejection reason is required';
  end if;

  select status into v_status from public.opportunities where id = p_opportunity_id for update;
  if not found then
    raise exception 'Opportunity not found: %', p_opportunity_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Opportunity is not pending review (status=%)', v_status;
  end if;

  update public.opportunities
     set status          = 'rejected',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = p_reason
   where id = p_opportunity_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'reject_opportunity', 'opportunities', p_opportunity_id, p_reason);

  return query
    select au.email::text, p.first_name, o.position_name as title
      from public.opportunities o
      join public.profiles p on p.id = o.posted_by
      join auth.users au     on au.id = o.posted_by
     where o.id = p_opportunity_id;
end;
$$;

-- approve_vc_grant: lock the row before the pending check (a concurrent approve and reject both passed it).
create or replace function public.approve_vc_grant(
  p_id    uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  select status into v_status from public.vcs_grants where id = p_id for update;
  if not found then
    raise exception 'VC/grant not found: %', p_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'VC/grant is not pending review (status=%)', v_status;
  end if;

  update public.vcs_grants
     set status          = 'approved',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = null
   where id = p_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'approve_vc_grant', 'vcs_grants', p_id, p_notes);
end;
$$;

-- reject_vc_grant: lock the row before the pending check (a concurrent approve and reject both passed it).
create or replace function public.reject_vc_grant(
  p_id     uuid,
  p_reason text
)
returns table(email text, first_name text, title text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.listing_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Rejection reason is required';
  end if;

  select status into v_status from public.vcs_grants where id = p_id for update;
  if not found then
    raise exception 'VC/grant not found: %', p_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'VC/grant is not pending review (status=%)', v_status;
  end if;

  update public.vcs_grants
     set status          = 'rejected',
         approved_at     = now(),
         approved_by     = v_caller,
         rejected_reason = p_reason
   where id = p_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'reject_vc_grant', 'vcs_grants', p_id, p_reason);

  return query
    select au.email::text, p.first_name, v.name as title
      from public.vcs_grants v
      join public.profiles p on p.id = v.posted_by
      join auth.users au     on au.id = v.posted_by
     where v.id = p_id;
end;
$$;

-- approve_user: lock the profile before the pending check.
create or replace function public.approve_user(
  p_user_id uuid,
  p_notes   text default null
)
returns table (email text, first_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_status public.user_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  select status into v_status from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Profile not found: %', p_user_id;
  end if;
  if v_status <> 'pending_review' then
    raise exception 'User is not pending review (status=%)', v_status;
  end if;

  update public.profiles set status = 'approved' where id = p_user_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'approve_user', 'profiles', p_user_id, p_notes);

  return query
    select u.email::text, p.first_name
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.id = p_user_id;
end;
$$;

-- reject_user: lock the profile first, so an approval that commits meanwhile is seen and the member is not deleted as rejected.
create or replace function public.reject_user(p_user_id uuid, p_reason text)
 RETURNS TABLE(email text, first_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_email  text;
  v_first  text;
  v_status public.user_status;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Rejection reason is required';
  end if;
  if p_user_id = v_caller then
    raise exception 'Cannot reject your own account';
  end if;

  -- Serialise with approve_user and any other decision on this member.
  perform 1 from public.profiles where id = p_user_id for update;

  -- Capture identity + current status before the cascade wipes it.
  select au.email::text, p.first_name, p.status
    into v_email, v_first, v_status
    from auth.users au
    left join public.profiles p on p.id = au.id
   where au.id = p_user_id;

  if v_email is null then
    raise exception 'User not found: %', p_user_id;
  end if;

  -- Hard guard: rejection is for users still under review. Approved
  -- members go through admin_delete_user (which also captures a
  -- reason); already-deleted rows never reach here.
  if v_status is null or v_status <> 'pending_review' then
    raise exception 'User is not pending review (status=%)', v_status;
  end if;

  -- Same blocking-FK cleanup as admin_delete_user. A pending_review
  -- user normally has zero posted listings (post buttons require
  -- approved status), but we include the cleanup for defence against
  -- future flow changes.
  delete from public.opportunities where posted_by = p_user_id;
  delete from public.events        where posted_by = p_user_id;
  delete from public.vcs_grants    where posted_by = p_user_id;
  -- Any admin_actions rows they authored are kept (admin_id → NULL).

  -- Cascades through profile, profile_skills, profile_sectors,
  -- opportunity_bookmarks (FK cascade), and listing_events viewer rows.
  delete from auth.users where id = p_user_id;

  -- Audit row captures the rejection. target_id points at the now-
  -- deleted auth.users uuid; the reason text is the only PII we retain.
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'reject_user', 'auth.users', p_user_id, p_reason);

  return query select v_email, v_first;
end;
$function$;

-- admin_delete_user: lock the account first; a second concurrent delete then finds nothing and says so, instead of auditing and emailing twice.
create or replace function public.admin_delete_user(p_user_id uuid, p_reason text)
 RETURNS TABLE(email text, first_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_email  text;
  v_first  text;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  if p_user_id = v_caller then
    raise exception 'Use the self-service Delete Account flow to delete your own account';
  end if;

  perform 1 from auth.users where id = p_user_id for update;

  -- Capture identity before the cascade wipes it.
  select au.email::text, p.first_name into v_email, v_first
    from auth.users au
    left join public.profiles p on p.id = au.id
   where au.id = p_user_id;

  if v_email is null then
    raise exception 'User not found: %', p_user_id;
  end if;

  -- Same blocking-FK cleanup as delete_my_account.
  delete from public.opportunities where posted_by = p_user_id;
  delete from public.events        where posted_by = p_user_id;
  delete from public.vcs_grants    where posted_by = p_user_id;
  -- The target's own admin_actions rows are kept (admin_id → NULL).

  -- Cascades to profiles, profile_skills, profile_sectors, admins.
  delete from auth.users where id = p_user_id;

  -- Audit. Note this is logged against the deleter, with the deleted
  -- user's id captured in target_id.
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'admin_delete_user', 'auth.users', p_user_id, p_reason);

  return query select v_email, v_first;
end;
$function$;

-- admin_resolve_post_report: lock the report before the open check.
create or replace function public.admin_resolve_post_report(
  p_report_id uuid,
  p_status    text,
  p_note      text default null
)
returns table (email text, first_name text, post_title text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_report public.post_reports%rowtype;
  v_email  text;
  v_first  text;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'Status must be actioned or dismissed' using errcode = '22023';
  end if;

  select * into v_report from public.post_reports where id = p_report_id for update;
  if v_report.id is null then
    raise exception 'Report not found: %', p_report_id;
  end if;
  if v_report.status <> 'open' then
    raise exception 'That report has already been resolved';
  end if;

  update public.post_reports
     set status = p_status, resolved_by = v_caller, resolved_at = now(),
         resolution_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_report_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'admin_resolve_post_report', 'post_reports', p_report_id,
          p_status || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), ''));

  -- reporter_id is nullable (the reporter may have deleted their account
  -- since), so this can legitimately return no address.
  select au.email::text, p.first_name into v_email, v_first
    from auth.users au
    left join public.profiles p on p.id = au.id
   where au.id = v_report.reporter_id;

  return query select v_email, v_first, v_report.post_title_snapshot;
end;
$$;

-- admin_delete_post: lock the post; a second concurrent removal finds it gone (one log row, one email).
create or replace function public.admin_delete_post(p_post_id uuid, p_reason text)
returns table (email text, first_name text, title text, posted_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_post   public.posts%rowtype;
  v_email  text;
  v_first  text;
  v_images smallint;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select * into v_post from public.posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'Post not found: %', p_post_id;
  end if;

  select au.email::text, p.first_name into v_email, v_first
    from auth.users au
    left join public.profiles p on p.id = au.id
   where au.id = v_post.author_id;

  select count(*) into v_images from public.post_images where post_id = p_post_id;

  -- Written BEFORE the delete. The snapshot is the point: "we removed a
  -- post for reason X" without the post is close to worthless the moment
  -- someone appeals, and an appeal is the only time this is ever read.
  insert into public.post_moderation_log (
    post_id, author_id, author_email_snapshot, admin_id, reason,
    title_snapshot, body_snapshot, image_count, posted_at
  )
  values (
    p_post_id, v_post.author_id, v_email, v_caller, trim(p_reason),
    v_post.title, v_post.body, v_images, v_post.created_at
  );

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'admin_delete_post', 'posts', p_post_id, trim(p_reason));

  -- Any open reports about this post are now resolved by definition.
  update public.post_reports
     set status = 'actioned', resolved_by = v_caller, resolved_at = now(),
         resolution_note = 'Post removed by an admin.'
   where post_id = p_post_id and status = 'open';

  delete from public.posts where id = p_post_id;

  return query select v_email, v_first, v_post.title, v_post.created_at;
end;
$$;

-- confirm_avatar_upload: claim the ticket atomically.
create or replace function public.confirm_avatar_upload(p_blob_key text)
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

  -- Claim the ticket in one statement: the WHERE clause is the whole
  -- check, so two overlapping confirms cannot both pass it (S0).
  update public.upload_tickets
     set consumed_at = now()
   where blob_key = p_blob_key
     and user_id = v_caller
     and purpose = 'profile_picture'
     and consumed_at is null;
  if not found then
    raise exception 'That upload ticket is invalid, expired, or already used'
      using errcode = '42501';
  end if;

  -- The GUC lets the protect-avatar-path trigger through for this one
  -- write. Transaction-local (3rd arg = true) and reset before this
  -- function returns, mirroring submit_onboarding's fixed pattern
  -- (20260828000005) — never left raised across statements. The
  -- previous avatar_path (if any) is enqueued for deletion by
  -- profiles_enqueue_media_deletion (20260901000002), not here — one
  -- trigger covering every UPDATE is what stops a future write path
  -- from forgetting to enqueue.
  perform set_config('foundry.media_write', 'true', true);
  update public.profiles set avatar_path = p_blob_key where id = v_caller;
  perform set_config('foundry.media_write', 'false', true);
end;
$$;

-- confirm_cv_upload: claim the ticket atomically (a double confirm queued two paid ingestion jobs).
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
$$;

-- create_post: serialise one member's posts, so the duplicate check catches an overlapping double submit.
create or replace function public.create_post(
  p_title  text,
  p_body   text,
  p_images jsonb default '[]'::jsonb
)
returns table (
  id                uuid,
  created_at        timestamptz,
  expires_at        timestamptz,
  author_first_name text,
  author_surname    text,
  author_role       user_role
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller  uuid := auth.uid();
  v_post_id uuid;
  v_count   int;
  v_img     jsonb;
  v_pos     smallint := 0;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Only approved members can post' using errcode = '42501';
  end if;
  if not public.posting_enabled() then
    raise exception 'Community posting is currently disabled' using errcode = '42501';
  end if;

  if jsonb_typeof(p_images) <> 'array' then
    raise exception 'create_post: p_images must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_images) > 2 then
    raise exception 'A post can have at most 2 images' using errcode = '22023';
  end if;

  -- One member's posts are created one at a time (S0): without this the
  -- duplicate check below missed a double submit whose two requests
  -- overlapped, and both were posted.
  perform pg_advisory_xact_lock(hashtextextended('create_post:' || v_caller::text, 0));

  -- Rate backstop. Served by posts_author_feed_idx (author_id first), so
  -- this is an index range scan over one member's last day, not a table
  -- scan. Racy under concurrency — two simultaneous requests can both see
  -- 14 — and that is fine for a backstop whose job is to stop a loop, not
  -- to be exact.
  select count(*) into v_count
    from public.posts p
   where p.author_id = v_caller
     and p.kind = 'member'
     and p.created_at > now() - interval '24 hours';
  if v_count >= 15 then
    raise exception 'You have reached the daily posting limit.' using errcode = '42501';
  end if;

  -- Duplicate suppression. Catches the double-submit (a member clicking
  -- Post twice on a slow connection) and the laziest form of spam, and it
  -- does so without spending a rate-limit token on either.
  --
  -- Every column is table-qualified. `returns table (...)` declares OUT
  -- parameters named id / created_at / expires_at, and an unqualified
  -- reference to one of those inside the body resolves to the parameter
  -- rather than the column — Postgres rejects it as ambiguous at runtime,
  -- not at create time, so it fails on first call rather than on deploy.
  select count(*) into v_count
    from public.posts p
   where p.author_id = v_caller
     and p.kind = 'member'
     and p.title = p_title
     and p.body = p_body
     and p.created_at > now() - interval '24 hours';
  if v_count > 0 then
    raise exception 'You have already posted this in the last 24 hours' using errcode = '23505';
  end if;

  insert into public.posts (author_id, kind, title, body)
  values (v_caller, 'member', p_title, p_body)
  returning posts.id into v_post_id;  -- qualified: `id` is also an OUT param

  for v_img in select * from jsonb_array_elements(p_images)
  loop
    v_pos := v_pos + 1;

    -- Claim the ticket. The WHERE clause is the whole check: it must
    -- exist, belong to this caller, be for this purpose, and be unused.
    -- `not found` after this means at least one of those was false.
    update public.upload_tickets
       set consumed_at = now()
     where blob_key    = v_img->>'blob_key'
       and user_id     = v_caller
       and purpose     = 'post_image'
       and consumed_at is null;
    if not found then
      raise exception 'Image upload is no longer valid — please re-attach it'
        using errcode = '42501';
    end if;

    insert into public.post_images (post_id, blob_key, alt_text, width, height, byte_size, position)
    values (
      v_post_id,
      v_img->>'blob_key',
      v_img->>'alt_text',
      (v_img->>'width')::int,
      (v_img->>'height')::int,
      (v_img->>'byte_size')::int,
      v_pos
    );
  end loop;

  return query
  select p.id, p.created_at, p.expires_at, pr.first_name, pr.surname, pr.role
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
   where p.id = v_post_id;
end;
$$;

-- toggle_post_like: serialise one member's toggles on one post (a double tap raised a raw unique violation).
create or replace function public.toggle_post_like(p_post_id uuid)
returns table (liked boolean, like_count int)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_author uuid;
  v_liked  boolean;
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;

  select author_id into v_author from public.posts
   where id = p_post_id and expires_at > now();
  if v_author is null then
    raise exception 'Post not found';
  end if;
  if v_author = v_caller then
    raise exception 'Cannot like your own post';
  end if;

  -- DB-side floor, same reasoning as create_post's inline count check
  -- (20260830000001): this RPC is directly callable via PostgREST,
  -- bypassing the app's Upstash rate limit entirely. Generous — not
  -- trying to be the real control, just closing the hole a scripted
  -- loop would otherwise find.
  if (select count(*) from public.post_likes
       where user_id = v_caller and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many like actions — try again shortly.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('post_like:' || v_caller::text || ':' || p_post_id::text, 0));

  if exists (select 1 from public.post_likes where post_id = p_post_id and user_id = v_caller) then
    delete from public.post_likes where post_id = p_post_id and user_id = v_caller;
    v_liked := false;
  else
    insert into public.post_likes (post_id, user_id) values (p_post_id, v_caller);
    v_liked := true;
  end if;

  return query select v_liked, (select count(*)::int from public.post_likes where post_id = p_post_id);
end;
$$;

-- update_event: lock the listing, so an edit racing approval is staged for review instead of going live.
create or replace function public.update_event(
  p_id                    uuid,
  p_title                 text,
  p_description           text,
  p_luma_link             text,
  p_event_at              timestamptz,
  p_location              text,
  p_organiser_name        text,
  p_contact_email         text,
  p_contact_email_visible boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_status listing_status;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select posted_by, status into v_owner, v_status
    from public.events where id = p_id
     for update;
  if not found then
    raise exception 'Event not found, or it has been removed.' using errcode = '42501';
  end if;
  if v_owner <> v_caller then
    raise exception 'You can only edit your own listings' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'approved') then
    raise exception 'Only pending or approved listings can be edited' using errcode = '42501';
  end if;

  -- Mirrors update_opportunity's deadline guard. The five-minute grace
  -- matches eventSchema's, so a submission for an imminent event isn't
  -- refused by its own round trip. Applies to a proposed revision too —
  -- an edit that moves an event into the past is wrong whichever path
  -- it takes.
  if p_event_at is null or p_event_at < now() - interval '5 minutes' then
    raise exception 'Event must start in the future';
  end if;

  if v_status = 'approved' then
    perform public.stage_listing_edit('event', p_id, jsonb_build_object(
      'title',                 p_title,
      'description',           p_description,
      'luma_link',             p_luma_link,
      'event_at',              p_event_at,
      'location',              p_location,
      'organiser_name',        p_organiser_name,
      'contact_email',         p_contact_email,
      'contact_email_visible', coalesce(p_contact_email_visible, false)));
    return;
  end if;

  update public.events
     set title                 = p_title,
         description           = p_description,
         luma_link             = p_luma_link,
         event_at              = p_event_at,
         location              = p_location,
         organiser_name        = p_organiser_name,
         contact_email         = p_contact_email,
         contact_email_visible = coalesce(p_contact_email_visible, false)
   where id = p_id;
end;
$$;

-- update_vc_grant: lock the listing, so an edit racing approval is staged for review instead of going live.
create or replace function public.update_vc_grant(
  p_id          uuid,
  p_kind        vc_grant_kind,
  p_name        text,
  p_description text,
  p_link        text,
  p_amount      text,
  p_deadline    date,
  p_stage       text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_status listing_status;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select posted_by, status into v_owner, v_status
    from public.vcs_grants where id = p_id
     for update;
  if not found then
    raise exception 'Listing not found, or it has been removed.' using errcode = '42501';
  end if;
  if v_owner <> v_caller then
    raise exception 'You can only edit your own listings' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'approved') then
    raise exception 'Only pending or approved listings can be edited' using errcode = '42501';
  end if;

  if v_status = 'approved' then
    perform public.stage_listing_edit('vc_grant', p_id, jsonb_build_object(
      'kind',        p_kind,
      'name',        p_name,
      'description', p_description,
      'link',        p_link,
      'amount',      p_amount,
      'deadline',    p_deadline,
      'stage',       p_stage));
    return;
  end if;

  -- No deadline guard here on purpose: a VC/grant deadline is optional
  -- and a rolling-application listing legitimately has none.
  update public.vcs_grants
     set kind        = p_kind,
         name        = p_name,
         description = p_description,
         link        = p_link,
         amount      = p_amount,
         deadline    = p_deadline,
         stage       = p_stage
   where id = p_id;
end;
$$;

-- update_opportunity: lock the listing, so an edit racing approval is staged for review instead of going live.
create or replace function public.update_opportunity(
  p_id uuid, p_position_name text, p_company text, p_pay text, p_location_type location_type,
  p_location_text text, p_description text, p_start_month smallint, p_start_year integer,
  p_application_deadline date, p_contact_email text, p_contact_email_visible boolean,
  p_apply_method apply_method, p_apply_url text, p_skill_ids smallint[], p_sector_ids smallint[],
  p_eligible_audience text)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_status listing_status;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select posted_by, status into v_owner, v_status
    from public.opportunities where id = p_id
     for update;
  if not found then
    raise exception 'Opportunity not found: %', p_id;
  end if;
  if v_owner <> v_caller then
    raise exception 'You can only edit your own listings' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'approved') then
    raise exception 'Only pending or approved listings can be edited' using errcode = '42501';
  end if;

  if p_application_deadline is null or p_application_deadline < current_date then
    raise exception 'Application deadline must be today or later';
  end if;
  perform public.assert_audience(p_eligible_audience);

  -- An approved job's audience changes only through the reviewed edit,
  -- which publishes it atomically with the rest (§7.2).
  if v_status = 'approved' then
    perform public.stage_listing_edit('opportunity', p_id, jsonb_build_object(
      'position_name',         p_position_name,
      'company',               p_company,
      'pay',                   p_pay,
      'location_type',         p_location_type,
      'location_text',         p_location_text,
      'description',           p_description,
      'start_month',           p_start_month,
      'start_year',            p_start_year,
      'application_deadline',  p_application_deadline,
      'contact_email',         p_contact_email,
      'contact_email_visible', coalesce(p_contact_email_visible, false),
      'apply_method',          p_apply_method,
      'apply_url',             p_apply_url,
      'eligible_audience',     p_eligible_audience,
      'skill_ids',             to_jsonb(coalesce(p_skill_ids,  '{}'::smallint[])),
      'sector_ids',            to_jsonb(coalesce(p_sector_ids, '{}'::smallint[]))));
    return;
  end if;

  update public.opportunities
     set position_name         = p_position_name,
         company               = p_company,
         pay                   = p_pay,
         location_type         = p_location_type,
         location_text         = p_location_text,
         description           = p_description,
         start_month           = p_start_month,
         start_year            = p_start_year,
         application_deadline  = p_application_deadline,
         contact_email         = p_contact_email,
         contact_email_visible = coalesce(p_contact_email_visible, false),
         apply_method          = p_apply_method,
         apply_url             = p_apply_url,
         eligible_audience     = p_eligible_audience
   where id = p_id;

  delete from public.opportunity_skills  where opportunity_id = p_id;
  delete from public.opportunity_sectors where opportunity_id = p_id;

  if p_skill_ids is not null and array_length(p_skill_ids, 1) > 0 then
    insert into public.opportunity_skills (opportunity_id, skill_id)
    select p_id, unnest(p_skill_ids) on conflict do nothing;
  end if;

  if p_sector_ids is not null and array_length(p_sector_ids, 1) > 0 then
    insert into public.opportunity_sectors (opportunity_id, sector_id)
    select p_id, unnest(p_sector_ids) on conflict do nothing;
  end if;
end;
$function$;

-- ─── One pending background job per kind and target ─────────────────
-- Every enqueuer already meant "unless one is pending" (20260908000002),
-- but checked with NOT EXISTS, which two overlapping transactions both
-- pass. The advisory lock serialises enqueues for one target; the check
-- after it runs on a fresh snapshot (a volatile PL/pgSQL statement under
-- READ COMMITTED), so it sees the job the other transaction committed.
-- Skipping, not raising: the caller wanted the work queued, and it is.
-- Only 'pending' is deduplicated, so a change made while a job is running
-- still queues one more run (the worker's version checks make it cheap).
create or replace function public.tg_jobs_one_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text := coalesce(new.payload->>'member_id', new.payload->>'opportunity_id');
begin
  if new.status <> 'pending' or v_target is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('job_enqueue:' || new.kind || ':' || v_target, 0));
  if exists (select 1 from public.jobs j
              where j.kind = new.kind and j.status = 'pending'
                and coalesce(j.payload->>'member_id', j.payload->>'opportunity_id') = v_target) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_one_pending on public.jobs;
create trigger jobs_one_pending
  before insert on public.jobs
  for each row
  when (new.kind in ('refresh_member_ai', 'refresh_job_ai', 'refresh_github_summary', 'scan_github'))
  execute function public.tg_jobs_one_pending();

revoke all on function public.tg_jobs_one_pending() from public, anon, authenticated;

-- ─── Grants (unchanged; restated per the project convention) ────────
revoke execute on function public.approve_event(uuid, text)          from public, anon;
revoke execute on function public.reject_event(uuid, text)           from public, anon;
revoke execute on function public.approve_opportunity(uuid, text)    from public, anon;
revoke execute on function public.reject_opportunity(uuid, text)     from public, anon;
revoke execute on function public.approve_vc_grant(uuid, text)       from public, anon;
revoke execute on function public.reject_vc_grant(uuid, text)        from public, anon;
revoke execute on function public.approve_user(uuid, text)           from public, anon;
revoke execute on function public.reject_user(uuid, text)            from public, anon;
revoke execute on function public.admin_delete_user(uuid, text)      from public, anon;
revoke execute on function public.admin_resolve_post_report(uuid, text, text) from public, anon;
revoke execute on function public.admin_delete_post(uuid, text)      from public, anon;
revoke execute on function public.confirm_avatar_upload(text)        from public, anon;
revoke execute on function public.confirm_cv_upload(text, text, boolean) from public, anon;
revoke execute on function public.create_post(text, text, jsonb)     from public, anon;
revoke execute on function public.toggle_post_like(uuid)             from public, anon;
revoke execute on function public.update_event(uuid, text, text, text, timestamptz, text, text, text, boolean) from public, anon;
revoke execute on function public.update_vc_grant(uuid, vc_grant_kind, text, text, text, text, date, text) from public, anon;
revoke execute on function public.update_opportunity(uuid, text, text, text, location_type, text, text, smallint, integer, date, text, boolean, apply_method, text, smallint[], smallint[], text) from public, anon;

-- ─── Showcase nudges are claimed when read ──────────────────────────
-- The weekly route read the due members, queued their emails, then marked
-- them. Two overlapping runs (the cron tick and a manual run, or a retried
-- invocation) read the same members and emailed them twice. Reading now
-- claims: the rows are locked (skip locked) and stamped in the same
-- statement, so a concurrent run gets a disjoint set. The route's own
-- mark_github_showcase_nudged call afterwards is a harmless re-stamp.
-- Same signature and grants; now volatile, since it writes.
create or replace function public.due_github_showcase_nudges(p_limit int default 50)
returns table (member_id uuid, email text, first_name text, new_repos text[])
language sql
volatile
security definer
set search_path = public, auth
as $$
  with due as (
    select gc.member_id
      from public.github_connections gc
      join public.profiles p on p.id = gc.member_id
      join auth.users     au on au.id = gc.member_id
     where gc.scan_status = 'ready'
       and gc.showcase_nudges_enabled
       and gc.available_repos is not null
       -- Only members who can actually act on it.
       and p.status = 'approved'
       and au.email is not null
       and (gc.showcase_nudged_at is null or gc.showcase_nudged_at < now() - interval '30 days')
       and exists (
         select 1
           from jsonb_array_elements(gc.available_repos) as elem
          where not (elem->>'name' = any(coalesce(gc.showcase_seen_repos, '{}'::text[])))
       )
     order by gc.last_scanned_at
     limit greatest(coalesce(p_limit, 50), 0)
       for update of gc skip locked
  ),
  claimed as (
    update public.github_connections gc
       set showcase_nudged_at = now()
      from due
     where gc.member_id = due.member_id
    returning gc.member_id, gc.available_repos, gc.showcase_seen_repos
  )
  select
    c.member_id,
    au.email::text,
    p.first_name,
    (
      select array_agg(elem->>'name')
        from jsonb_array_elements(c.available_repos) as elem
       where not (elem->>'name' = any(coalesce(c.showcase_seen_repos, '{}'::text[])))
    )
  from claimed c
  join public.profiles p on p.id = c.member_id
  join auth.users     au on au.id = c.member_id;
$$;

revoke execute on function public.due_github_showcase_nudges(int) from public, anon, authenticated;

-- ─── Scheduled ticket purge: overlap-safe ────────────────────────────
-- purge_stale_upload_tickets: delete, then queue (overlapping runs queued every blob twice).
create or replace function public.purge_stale_upload_tickets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Delete first, queue what was deleted (S0). The other order let two
  -- overlapping runs both read the same abandoned tickets and queue every
  -- blob twice; now the second run's DELETE waits on the first, finds the
  -- rows gone and queues nothing.
  with deleted as (
    delete from public.upload_tickets t
     where t.blob_key in (
       select blob_key from public.upload_tickets
        where consumed_at is null
          and issued_at < now() - interval '24 hours'
        order by issued_at
        limit 5000
     )
       and t.consumed_at is null
    returning t.blob_key
  ),
  queued as (
    insert into public.blob_deletion_queue (blob_key)
    select blob_key from deleted
    returning 1
  )
  select count(*) into v_count from queued;

  delete from public.upload_tickets
   where consumed_at is not null
     and consumed_at < now() - interval '24 hours';

  return v_count;
end;
$$;
revoke execute on function public.purge_stale_upload_tickets() from public, anon, authenticated;
