-- ════════════════════════════════════════════════════════════════════
-- Foundry · Second-pass hardening (concurrency audit D10, addendum)
--
-- Found by the second, read-only sweep and re-verified against the code before any
-- of it was written (docs/audits/D10-concurrency-second-pass.md). Tests:
-- server/tests/integration/test_concurrency.py and test_worker_races.py.
--
--   A1   A banned member could delete their account and sign up again with the same
--        Imperial email; students are auto-approved. A one-way hash of the email is
--        now kept when an account with status 'rejected' is deleted, and signing up
--        with it lands in the normal review queue instead of auto-approval. Deletion
--        itself is never refused. Kept 12 months, like the other moderation records.
--   A3   Removing a CV, or replacing it, left the full extracted text, chunks and
--        embeddings in Postgres indefinitely. Removal now deletes every CV row of the
--        member (profile and chunks cascade); a finished upload deletes the ones it
--        supersedes. The current CV, and the one a hash match reuses, are kept.
--   A4   purge_stale_upload_tickets queued deletions with no container, so they went to
--        the post-images default: orphaned CV and avatar blobs were never deleted. A
--        trigger on upload_tickets now queues an unconsumed ticket's blob with the
--        container its purpose names, for the purge AND for the cascade when an
--        account is deleted (which queued nothing at all before).
--   A8   Events and opportunities could be given a past date by a direct PostgREST
--        update (only the RPCs checked). A trigger now refuses it for members.
--   A9   create_post checked approval before its lock, so a post could land just after
--        a ban had purged the member's posts. It now takes a share lock on the profile
--        row: a concurrent ban waits for the post (and then purges it), or the post is
--        refused.
--   A11  The core-skill cap (3) counted without a lock, so concurrent direct inserts passed
--        together. (The opportunity-skill cap (50) already holds: the edit-version trigger
--        takes the parent row's lock before the statement-level count. Pinned by a test.)
--   A13  ai_create_draft_handoff had no per-member cap behind the app-layer bucket.
--   A14  The only administrator could delete their own account, leaving none.
--
-- Every function is recreated from its latest definition with the same signature, so
-- grants are kept and no dead overload is left behind.
--
-- Pre-check: none (new table, new triggers, no constraints added to existing data).
-- Deploy order: after 20261026000018, BEFORE the worker image (worker_purge_superseded_cvs).
-- Rollback: re-apply the earlier definitions; drop the new triggers, functions and table.
-- ════════════════════════════════════════════════════════════════════

-- ─── A1: ban evasion by delete and re-signup ────────────────────────
create table public.banned_email_hashes (
  email_hash text primary key,
  banned_at  timestamptz not null default now()
);
alter table public.banned_email_hashes enable row level security;
revoke all on table public.banned_email_hashes from public, anon, authenticated;

-- One-way, lower-cased, trimmed; the prefix keeps these hashes distinct from any other
-- sha256 of an email held elsewhere. The table is unreachable by members and anon.
create or replace function public.email_ban_hash(p_email text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select encode(extensions.digest('foundry-email-ban:v1:' || lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex');
$$;
revoke all on function public.email_ban_hash(text) from public, anon, authenticated;

-- BEFORE delete, because the profile (and so the status) is already gone by the time the
-- AFTER trigger that stamps the id tombstone runs: the cascade fires first.
create or replace function public.tg_ban_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.email is not null
     and exists (select 1 from public.profiles p where p.id = old.id and p.status = 'rejected') then
    insert into public.banned_email_hashes (email_hash)
    values (public.email_ban_hash(old.email))
    on conflict (email_hash) do update set banned_at = now();
  end if;
  return old;
end;
$$;
revoke all on function public.tg_ban_tombstone() from public, anon, authenticated;

create trigger on_auth_user_deleted_ban_tombstone
  before delete on auth.users
  for each row execute function public.tg_ban_tombstone();

create or replace function public.purge_banned_email_hashes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.banned_email_hashes where banned_at < now() - interval '12 months';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_banned_email_hashes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-banned-email-hashes-daily', '50 2 * * *', 'select public.purge_banned_email_hashes();');
  end if;
end $$;

-- Latest definition is 20260901000006; the only change is the student branch of v_new_status.
create or replace function public.submit_onboarding(
  p_course text, p_grad_year integer, p_linkedin_url text, p_github_url text, p_portfolio_url text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller       uuid := auth.uid();
  v_role         user_role;
  v_status       user_status;
  v_new_status   user_status;
  v_current_year int := extract(year from now())::int;
  v_course       text;
  v_linkedin     text;
  v_github       text;
  v_portfolio    text;
  v_needs_year   boolean;
  v_banned       boolean;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select role, status into v_role, v_status
    from public.profiles where id = v_caller;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_onboarding' then
    raise exception 'Onboarding already submitted' using errcode = '22023';
  end if;
  if v_role = 'student' and not public.is_imperial_email(
       (select email from auth.users where id = v_caller)) then
    raise exception 'Student accounts must use an @imperial.ac.uk or @ic.ac.uk email address.'
      using errcode = '42501';
  end if;
  v_course    := nullif(trim(coalesce(p_course,        '')), '');
  v_linkedin  := nullif(trim(coalesce(p_linkedin_url,  '')), '');
  v_github    := nullif(trim(coalesce(p_github_url,    '')), '');
  v_portfolio := nullif(trim(coalesce(p_portfolio_url, '')), '');
  if v_course is null then
    raise exception 'Course is required';
  end if;
  v_needs_year := v_role in ('student', 'recent_grad', 'alum');
  if v_needs_year and p_grad_year is null then
    raise exception 'Graduation year is required';
  end if;
  if v_role = 'student' and p_grad_year < v_current_year + 1 then
    raise exception 'Students must set an expected graduation year of % or later', v_current_year + 1
      using errcode = '22023';
  end if;
  if v_role in ('recent_grad', 'alum') and p_grad_year > v_current_year then
    raise exception 'Graduation year cannot be in the future once you have graduated'
      using errcode = '22023';
  end if;
  if v_role <> 'student' and v_linkedin is null then
    raise exception 'A LinkedIn URL is required for accounts without an Imperial email address';
  end if;
  -- An address whose previous account was banned does not get the instant approval: it waits in
  -- the same review queue as everyone else who is not auto-approved.
  select exists (
    select 1 from public.banned_email_hashes b
     where b.email_hash = public.email_ban_hash((select email from auth.users where id = v_caller))
  ) into v_banned;
  v_new_status := case
    when v_role = 'student' and not v_banned then 'approved'::user_status
    else 'pending_review'::user_status
  end;
  perform set_config('foundry.onboarding_submission', 'true', true);
  update public.profiles
     set course        = v_course,
         grad_year     = case when v_needs_year then p_grad_year else null end,
         linkedin_url  = v_linkedin,
         github_url    = v_github,
         portfolio_url = v_portfolio,
         status        = v_new_status
   where id = v_caller;
  perform set_config('foundry.onboarding_submission', 'false', true);
end;
$function$;

-- ─── A3: CV data is deleted when the CV is ──────────────────────────
-- Removal: every CV row of the member goes (cv_profiles and cv_chunks cascade, and
-- ai_source_cvs rebuilds the AI projection without it). Queued ingest jobs for those
-- rows are dropped; one already running finds its row gone and stops.
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
  delete from public.jobs
   where kind = 'ingest_cv' and status = 'pending'
     and (payload->>'cv_id')::uuid in (select id from public.cvs where member_id = v_caller);
  delete from public.cvs where member_id = v_caller;
  delete from public.member_skills where member_id = v_caller and source = 'cv';
end;
$function$;

-- Replacement: once a new upload has been published, the rows it supersedes are deleted.
-- Kept: the CV the profile points at, and the one currently marked current (they differ
-- only after a hash match, which reuses an earlier row's extraction). The worker's login
-- cannot delete CVs, hence a definer function granted to it alone.
create or replace function public.worker_purge_superseded_cvs(p_cv_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member uuid;
  v_path   text;
  v_n      integer;
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select member_id into v_member from public.cvs where id = p_cv_id;
  if v_member is null then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member_cv:' || v_member::text, 0));
  select cv_path into v_path from public.profiles where id = v_member;
  delete from public.cvs c
   where c.member_id = v_member
     and c.id <> p_cv_id
     and not c.is_current
     and c.blob_key is distinct from v_path;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.worker_purge_superseded_cvs(uuid) from public, anon, authenticated;
grant execute on function public.worker_purge_superseded_cvs(uuid) to cv_worker;

-- ─── A4: orphaned upload blobs go to the right container ────────────
create or replace function public.tg_enqueue_unconsumed_ticket_blob()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.blob_deletion_queue (blob_key, container)
  values (old.blob_key,
          case old.purpose when 'cv' then 'member-cvs' when 'profile_picture' then 'profile-pictures' else 'post-images' end);
  return old;
end;
$$;
revoke all on function public.tg_enqueue_unconsumed_ticket_blob() from public, anon, authenticated;

-- Fires for the purge below AND for the cascade when an account is deleted. A consumed
-- ticket's blob belongs to a post, profile or CV row, which queue it themselves.
create trigger upload_tickets_enqueue_orphan
  before delete on public.upload_tickets
  for each row when (old.consumed_at is null)
  execute function public.tg_enqueue_unconsumed_ticket_blob();

create or replace function public.purge_stale_upload_tickets()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  -- Queuing the blobs is the trigger's job now (container-aware).
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
    returning 1
  )
  select count(*) into v_count from deleted;
  delete from public.upload_tickets
   where consumed_at is not null
     and consumed_at < now() - interval '24 hours';
  return v_count;
end;
$function$;

-- ─── A8: no past dates through a direct update ──────────────────────
create or replace function public.tg_events_event_at_future()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Members and anonymous callers only: the RPCs (definer) and admin tools apply their own rules.
  if current_user in ('authenticated', 'anon')
     and new.event_at is distinct from old.event_at
     and new.event_at < now() - interval '5 minutes' then
    raise exception 'The event must be in the future.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_events_event_at_future() from public, anon, authenticated;
create trigger events_event_at_future
  before update of event_at on public.events
  for each row execute function public.tg_events_event_at_future();

create or replace function public.tg_opportunities_deadline_future()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.application_deadline is distinct from old.application_deadline
     and new.application_deadline < current_date then
    raise exception 'The application deadline must be today or later.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_opportunities_deadline_future() from public, anon, authenticated;
create trigger opportunities_deadline_future
  before update of application_deadline on public.opportunities
  for each row execute function public.tg_opportunities_deadline_future();

-- ─── A9: a post cannot land after the author's ban ──────────────────
create or replace function public.create_post(p_title text, p_body text, p_images jsonb default '[]'::jsonb)
returns table(id uuid, created_at timestamp with time zone, expires_at timestamp with time zone,
              author_first_name text, author_surname text, author_role user_role)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
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
  perform pg_advisory_xact_lock(hashtextextended('create_post:' || v_caller::text, 0));
  -- Approval again, now holding a share lock on the profile row. A ban is an UPDATE of that row
  -- (and purges the member's posts when it commits): it waits for this post to commit and then
  -- purges it, or it has already committed and this finds the member no longer approved.
  if not public.is_admin() then
    perform 1 from public.profiles pr where pr.id = v_caller and pr.status = 'approved' for share;
    if not found then
      raise exception 'Only approved members can post' using errcode = '42501';
    end if;
  end if;
  select count(*) into v_count
    from public.posts p
   where p.author_id = v_caller
     and p.kind = 'member'
     and p.created_at > now() - interval '24 hours';
  if v_count >= 15 then
    raise exception 'You have reached the daily posting limit.' using errcode = '42501';
  end if;
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
  returning posts.id into v_post_id;
  for v_img in select * from jsonb_array_elements(p_images)
  loop
    v_pos := v_pos + 1;
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
$function$;

-- ─── A11: the core-skill cap is serialised ──────────────────────────
create or replace function public.tg_profile_skills_cap_core()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
begin
  if new.is_core then
    -- One writer at a time per profile, so the count sees the core skill a concurrent insert is adding.
    perform pg_advisory_xact_lock(hashtextextended('profile_core_skills:' || new.profile_id::text, 0));
    select count(*) into v_count
      from public.profile_skills
     where profile_id = new.profile_id
       and is_core
       and skill_id <> new.skill_id;
    if v_count >= 3 then
      raise exception 'At most 3 core skills are allowed' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

-- ─── A13: draft handoffs are capped per member ──────────────────────
create or replace function public.ai_create_draft_handoff(p_mode text, p_filters jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'ai_private'
as $function$
declare
  v_id uuid;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_mode not in ('network', 'opportunities') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filters) <> 'object' or length(p_filters::text) > 2000 then
    raise exception 'invalid_filters' using errcode = '22023';
  end if;
  -- Rows are purged an hour after creation and consumed within ten minutes, so more than 20 live ones
  -- is not a person hopping to the composer.
  perform pg_advisory_xact_lock(hashtextextended('ai_draft_handoff:' || auth.uid()::text, 0));
  if (select count(*) from ai_private.draft_handoffs where owner_id = auth.uid()) >= 20 then
    raise exception 'too_many_handoffs' using errcode = '42501';
  end if;
  insert into ai_private.draft_handoffs (owner_id, mode, filters)
  values (auth.uid(), p_mode, p_filters)
  returning id into v_id;
  return v_id;
end;
$function$;

-- ─── A14: the last administrator cannot delete themselves ───────────
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  -- Taken first, before any row lock, so the lock order stays the same for everyone. Two
  -- administrators deleting themselves at once are serialised and the second sees the first gone.
  if exists (select 1 from public.admins where user_id = v_caller) then
    perform pg_advisory_xact_lock(hashtextextended('admin_roster', 0));
    if not exists (select 1 from public.admins where user_id <> v_caller) then
      raise exception 'You are the only administrator. Add another before deleting your account.'
        using errcode = '42501';
    end if;
  end if;
  perform 1 from public.connections c
   where c.requester_id = v_caller or c.addressee_id = v_caller
   order by c.id
     for update;
  perform 1 from public.profiles where id = v_caller for update;
  delete from public.opportunities where posted_by = v_caller;
  delete from public.events        where posted_by = v_caller;
  delete from public.vcs_grants    where posted_by = v_caller;
  delete from auth.users where id = v_caller;
end;
$function$;
