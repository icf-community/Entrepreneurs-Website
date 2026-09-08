-- ════════════════════════════════════════════════════════════════════
-- Foundry · Clear everything down to a single admin account
--
-- RUN IN THE SUPABASE SQL EDITOR, AGAINST PRODUCTION.
-- Section 1 is READ-ONLY. Section 2 DELETES. Section 3 verifies.
--
-- A reusable reset tool, not a one-off script — REDACTED-ADMIN-EMAIL
-- below is a placeholder. Before running, replace every occurrence of it
-- in this file (there are five: three in Section 1, one in Section 2's
-- v_keep_email, and none in Section 3) with the real email of the account
-- you want to survive, in your local copy only — never commit a real
-- email back into this file.
--
-- First used 2026-08-28 to clear 28 committee-pilot accounts before
-- launch. Reusable any time you want to wipe every account except one
-- known admin — e.g. clearing test/pilot data again after further manual
-- testing in production.
--
-- ──────────────────────────────────────────────────────────────────────
-- ⚠ TAKE A BACKUP FIRST — Dashboard → Database → Backups
-- ──────────────────────────────────────────────────────────────────────
-- Nothing below is recoverable. The transaction is all-or-nothing, which
-- protects you from a HALF-cleared database, not from a cleared one.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHY THE ORDER BELOW IS NOT NEGOTIABLE
-- ──────────────────────────────────────────────────────────────────────
--
--   profiles.id            → auth.users    ON DELETE CASCADE
--   events.posted_by       → profiles      ON DELETE RESTRICT
--   opportunities.posted_by→ profiles      ON DELETE RESTRICT
--   vcs_grants.posted_by   → profiles      ON DELETE RESTRICT
--   admin_actions.admin_id → auth.users    ON DELETE RESTRICT
--
-- So `delete from auth.users` does NOT simply cascade. It tries to remove
-- the profile, hits RESTRICT from any listing that person posted, and the
-- whole statement fails. The listings and the audit rows have to go first.
-- This is the exact same ordering already proven in admin_delete_user /
-- admin_delete_graduates / delete_my_account / reject_user — see
-- supabase/migrations/20260529000007_admin_delete_user_rpcs.sql.
--
-- UPDATED 2026-09-08 for the CV matchmaker (cvs, cv_profiles, cv_chunks,
-- member_skills, github_connections, jobs — 20260906000001 / 20260907000001)
-- and post-approval listing edits (listing_edits — 20260907000005).
--
-- Only `jobs` actually needed adding: it carries NO foreign key at all
-- (deliberately — it is a queue, and a job must outlive the row it
-- references long enough to report why it failed), so a full account wipe
-- leaves ingest_cv / scan_github rows pointing at cv_ids and member_ids
-- that no longer exist, which the worker then picks up and fails forever.
-- Everything else in that set cascades from profiles or auth.users and is
-- listed explicitly only so the notices account for it.
--
-- `cv_skills` is the matchmaker's TAXONOMY, not member data — it is kept,
-- for the same reason as skills/sectors. `member_skills.skill_id` points
-- at it; the member rows go, the vocabulary stays.
--
-- Blobs: `cvs.blob_key` is the SAME Azure blob as `profiles.cv_path` (see
-- confirm_cv_upload, 20260906000001:279) and `cvs` has no deletion
-- trigger of its own — so the CV file is removed by
-- profiles_enqueue_media_deletion when the profile goes, exactly as
-- before. Deleting `cvs` first does not orphan anything.
--
-- UPDATED 2026-08-31 for the community feature (posts, post_images,
-- post_reports — added 20260829; post_likes — added 20260831). None of
-- their FKs are RESTRICT (posts.author_id, post_images.post_id and
-- post_likes.post_id/user_id all CASCADE), so they were never a blocker
-- — but they're cleared explicitly below anyway, same as listing_events
-- and opportunity_bookmarks, purely for a clean per-table count in the
-- notices. Deleting posts fires post_images' AFTER DELETE
-- trigger, which queues every image's blob_key in blob_deletion_queue —
-- the same drain cron (frontend/src/app/api/cron/drain-blob-deletions)
-- that handles a normal member's account deletion picks these up and
-- actually removes them from Azure Blob Storage. Nothing here talks to
-- Azure directly.
--
-- KEPT DELIBERATELY:
--   • skills, sectors, app_config — reference data and taxonomy/config,
--     not personal data. The app is broken without them.
--   • post_moderation_log — NOT touched, on purpose. It deliberately
--     carries no foreign key on author_id/post_id (see its own migration,
--     20260829000001, section 6) specifically so that deleting an
--     account cannot also destroy the record of why one of their posts
--     was taken down. Lawful basis: UK GDPR Article 17(3)(e).
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. PREFLIGHT — read this before running section 2 ───────────────
-- Confirms the account you are keeping actually exists and is an admin,
-- and shows the size of what is about to be destroyed.
select 'KEEPING' as scope, u.id::text as detail, u.email as value
  from auth.users u where lower(u.email) = 'REDACTED-ADMIN-EMAIL'
union all
select 'KEEPING · is in admins table',
       (exists (select 1 from public.admins a
                 join auth.users u on u.id = a.user_id
                where lower(u.email) = 'REDACTED-ADMIN-EMAIL'))::text, ''
union all
select 'KEEPING · profile status',
       coalesce((select p.status::text from public.profiles p
                  join auth.users u on u.id = p.id
                 where lower(u.email) = 'REDACTED-ADMIN-EMAIL'), 'NO PROFILE ROW'), ''
union all
select 'DELETING · auth users',   count(*)::text, '' from auth.users
  where lower(email) <> 'REDACTED-ADMIN-EMAIL'
union all
select 'DELETING · profiles',     count(*)::text, '' from public.profiles p
  join auth.users u on u.id = p.id where lower(u.email) <> 'REDACTED-ADMIN-EMAIL'
union all
select 'DELETING · events',        count(*)::text, '' from public.events
union all
select 'DELETING · opportunities', count(*)::text, '' from public.opportunities
union all
select 'DELETING · vcs_grants',    count(*)::text, '' from public.vcs_grants
union all
select 'DELETING · admin_actions', count(*)::text, '' from public.admin_actions
union all
select 'DELETING · outbound_email',count(*)::text, '' from public.outbound_email
union all
select 'DELETING · posts',         count(*)::text, '' from public.posts
union all
select 'DELETING · post_images',   count(*)::text, '' from public.post_images
union all
select 'DELETING · post_reports',  count(*)::text, '' from public.post_reports
union all
select 'DELETING · post_likes',    count(*)::text, '' from public.post_likes
union all
select 'DELETING · listing_edits', count(*)::text, '' from public.listing_edits
union all
select 'DELETING · cvs',           count(*)::text, '' from public.cvs
union all
select 'DELETING · cv_profiles',   count(*)::text, '' from public.cv_profiles
union all
select 'DELETING · cv_chunks',     count(*)::text, '' from public.cv_chunks
union all
select 'DELETING · member_skills', count(*)::text, '' from public.member_skills
union all
select 'DELETING · github_connections', count(*)::text, '' from public.github_connections
union all
select 'DELETING · jobs',          count(*)::text, '' from public.jobs
union all
select 'KEEPING · cv_skills (taxonomy)', count(*)::text, '' from public.cv_skills
union all
select 'KEEPING · skills',         count(*)::text, '' from public.skills
union all
select 'KEEPING · sectors',        count(*)::text, '' from public.sectors
union all
select 'KEEPING · app_config',     count(*)::text, '' from public.app_config
union all
select 'KEEPING · post_moderation_log (compliance retention, untouched)',
       count(*)::text, '' from public.post_moderation_log;


-- ════════════════════════════════════════════════════════════════════
-- 2. THE CLEAR-DOWN. Destructive. Run as ONE statement.
--
-- Wrapped in a DO block so it is a single transaction: if any step
-- fails, every step rolls back and you are left where you started
-- rather than half-cleared.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_keep_email constant text := 'REDACTED-ADMIN-EMAIL';
  v_keep_id    uuid;
  v_n          int;
begin
  -- The trigger-guarded columns and the admin RPCs read auth.role(). The
  -- SQL editor carries no JWT, so it is set here. Transaction-local.
  perform set_config('request.jwt.claims',
    json_build_object('role','service_role')::text, true);

  -- ── The guard that makes this safe to run ──────────────────────────
  -- If the address is wrong or absent, this aborts BEFORE deleting
  -- anything, rather than clearing the database down to nobody.
  select id into v_keep_id from auth.users where lower(email) = v_keep_email;
  if v_keep_id is null then
    raise exception 'ABORT: no account found for % — nothing deleted', v_keep_email;
  end if;
  if (select count(*) from auth.users where lower(email) = v_keep_email) > 1 then
    raise exception 'ABORT: % is not unique — nothing deleted', v_keep_email;
  end if;
  raise notice 'keeping % (%)', v_keep_email, v_keep_id;

  -- ── Operational + engagement tables ────────────────────────────────
  -- No FK blocks these, and they reference rows that are about to vanish.
  delete from public.outbound_email;        get diagnostics v_n = row_count;
    raise notice 'deleted % outbound_email', v_n;
  delete from public.listing_events;        get diagnostics v_n = row_count;
    raise notice 'deleted % listing_events', v_n;
  delete from public.user_listing_actions;  get diagnostics v_n = row_count;
    raise notice 'deleted % user_listing_actions', v_n;
  delete from public.opportunity_bookmarks; get diagnostics v_n = row_count;
    raise notice 'deleted % opportunity_bookmarks', v_n;
  delete from public.email_change_log;      get diagnostics v_n = row_count;
    raise notice 'deleted % email_change_log', v_n;

  -- Community feature (added 20260829, likes added 20260831). post_reports
  -- and post_likes have no RESTRICT either but are cleared explicitly,
  -- same reasoning as the rest of this block — post_likes would cascade
  -- away with posts regardless (references both posts and auth.users),
  -- this just keeps the notice accounting complete. Deleting posts
  -- cascades to post_images and fires its AFTER DELETE trigger, which
  -- queues each blob_key in blob_deletion_queue for the drain cron to
  -- actually remove from Azure Blob Storage — nothing here talks to
  -- Azure directly. post_moderation_log is deliberately NOT cleared; see
  -- the header comment.
  delete from public.post_reports;          get diagnostics v_n = row_count;
    raise notice 'deleted % post_reports', v_n;
  delete from public.post_likes;            get diagnostics v_n = row_count;
    raise notice 'deleted % post_likes', v_n;
  delete from public.posts;                 get diagnostics v_n = row_count;
    raise notice 'deleted % posts (and their post_images, cascaded)', v_n;

  -- ── CV matchmaker pipeline (20260906000001, 20260907000001) ────────
  -- Children first, purely so the notices report real numbers: cv_chunks
  -- and cv_profiles both cascade from cvs, and cvs/member_skills/
  -- github_connections all cascade from profiles, so any of these left
  -- out would still vanish with the account — silently, and uncounted.
  --
  -- `jobs` is the one that genuinely must be here. It has no foreign key
  -- to anything, so it survives the account wipe and the worker keeps
  -- claiming rows whose cv_id and member_id no longer resolve.
  delete from public.cv_chunks;             get diagnostics v_n = row_count;
    raise notice 'deleted % cv_chunks', v_n;
  delete from public.cv_profiles;           get diagnostics v_n = row_count;
    raise notice 'deleted % cv_profiles', v_n;
  delete from public.cvs;                   get diagnostics v_n = row_count;
    raise notice 'deleted % cvs', v_n;
  delete from public.member_skills;         get diagnostics v_n = row_count;
    raise notice 'deleted % member_skills', v_n;
  delete from public.github_connections;    get diagnostics v_n = row_count;
    raise notice 'deleted % github_connections (encrypted tokens included)', v_n;
  delete from public.jobs;                  get diagnostics v_n = row_count;
    raise notice 'deleted % jobs', v_n;

  -- ── Proposed listing revisions (20260907000005) ────────────────────
  -- listing_edits.listing_id is polymorphic and carries no FK, so the
  -- AFTER DELETE triggers on the three listing tables are what normally
  -- clean these up. Deleting them here first means those triggers find
  -- nothing rather than doing the work uncounted.
  delete from public.listing_edits;         get diagnostics v_n = row_count;
    raise notice 'deleted % listing_edits', v_n;

  -- admin_actions.admin_id is RESTRICT against auth.users. Clearing it
  -- here is what lets any non-surviving admin be removed below.
  delete from public.admin_actions;         get diagnostics v_n = row_count;
    raise notice 'deleted % admin_actions', v_n;

  -- ── Listings ───────────────────────────────────────────────────────
  -- MUST precede the profile deletion: posted_by is RESTRICT, so a single
  -- listing left behind blocks its author's removal and fails the lot.
  -- opportunity_skills / opportunity_sectors cascade from opportunities.
  delete from public.events;                get diagnostics v_n = row_count;
    raise notice 'deleted % events', v_n;
  delete from public.opportunities;         get diagnostics v_n = row_count;
    raise notice 'deleted % opportunities', v_n;
  delete from public.vcs_grants;            get diagnostics v_n = row_count;
    raise notice 'deleted % vcs_grants', v_n;

  -- ── The accounts ───────────────────────────────────────────────────
  -- profiles, profile_skills, profile_sectors, admins, upload_tickets,
  -- and the auth-schema rows (identities, sessions, one_time_tokens) all
  -- cascade from here. posts/post_images were already cleared above.
  delete from auth.users where id <> v_keep_id;
  get diagnostics v_n = row_count;
  raise notice 'deleted % auth users', v_n;

  -- ── The kept account's own test uploads ────────────────────────────
  -- The account survives; the files it uploaded while testing do not.
  -- Its cvs/github_connections rows were already cleared above, so
  -- leaving cv_path set would leave the profile claiming a CV the
  -- pipeline no longer has a row for. Nulling these fires
  -- profiles_enqueue_media_deletion's UPDATE branch, which queues both
  -- blobs for the drain cron — this is the only place in the script that
  -- removes a file belonging to the surviving account, so it is separate
  -- and explicit rather than folded into the deletes above.
  --
  -- The trigger guarding these two columns
  -- (tg_profiles_protect_avatar_path) returns early for service_role,
  -- which the set_config at the top of this block has already claimed.
  update public.profiles
     set avatar_path          = null,
         cv_path              = null,
         cv_uploaded_at       = null,
         cv_original_filename = null,
         cv_suggested_skill_ids = null
   where id = v_keep_id
     and (avatar_path is not null or cv_path is not null);
  get diagnostics v_n = row_count;
  raise notice 'cleared media pointers on the kept account (% row)', v_n;

  -- ── Post-conditions, checked before the transaction is allowed to end ─
  if not exists (select 1 from auth.users where id = v_keep_id) then
    raise exception 'ABORT: the account being kept was deleted — rolling back';
  end if;
  if not exists (select 1 from public.admins where user_id = v_keep_id) then
    raise exception 'ABORT: % is no longer in the admins table — rolling back', v_keep_email;
  end if;
  if (select count(*) from auth.users) <> 1 then
    raise exception 'ABORT: expected exactly 1 account, found % — rolling back',
      (select count(*) from auth.users);
  end if;
  if (select count(*) from public.skills) = 0
     or (select count(*) from public.sectors) = 0 then
    raise exception 'ABORT: taxonomy was emptied — rolling back';
  end if;

  raise notice 'done — database cleared to % only', v_keep_email;
end;
$$;


-- ─── 3. VERIFY ───────────────────────────────────────────────────────
select 'auth users'    as table_name, count(*)::text as rows from auth.users
union all select 'profiles',      count(*)::text from public.profiles
union all select 'admins',        count(*)::text from public.admins
union all select 'events',        count(*)::text from public.events
union all select 'opportunities', count(*)::text from public.opportunities
union all select 'vcs_grants',    count(*)::text from public.vcs_grants
union all select 'posts',                count(*)::text from public.posts
union all select 'post_likes',           count(*)::text from public.post_likes
union all select 'post_images',          count(*)::text from public.post_images
union all select 'post_reports',         count(*)::text from public.post_reports
union all select 'listing_edits',        count(*)::text from public.listing_edits
union all select 'cvs',                  count(*)::text from public.cvs
union all select 'cv_profiles',          count(*)::text from public.cv_profiles
union all select 'cv_chunks',            count(*)::text from public.cv_chunks
union all select 'member_skills',        count(*)::text from public.member_skills
union all select 'github_connections',   count(*)::text from public.github_connections
union all select 'jobs',                 count(*)::text from public.jobs
union all select 'blob_deletion_queue (pending)',
  count(*)::text from public.blob_deletion_queue where deleted_at is null
union all select 'cv_skills (kept, taxonomy)', count(*)::text from public.cv_skills
union all select 'skills (kept)',       count(*)::text from public.skills
union all select 'sectors (kept)',      count(*)::text from public.sectors
union all select 'app_config (kept)',   count(*)::text from public.app_config
union all select 'post_moderation_log (kept, compliance retention)',
  count(*)::text from public.post_moderation_log
union all select 'surviving email',
  coalesce((select email from auth.users limit 1), '— NONE —');
