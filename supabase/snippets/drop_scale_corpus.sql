-- ════════════════════════════════════════════════════════════════════
-- Foundry · Remove the synthetic scale-test corpus
--
-- The inverse of seed_scale_corpus.sql, which had none. Written
-- 2026-09-09 after the C2 load tests left 2,000 fake members in the
-- local database and there was no way back except reset_to_admin_only,
-- which would also have deleted the real local test accounts.
--
-- ──────────────────────────────────────────────────────────────────────
-- LOCAL ONLY. Do not run this against production.
-- ──────────────────────────────────────────────────────────────────────
-- It is scoped by email marker rather than by "everything except X", so
-- running it in the wrong place is survivable in a way that
-- reset_to_admin_only.sql is not — but production has no reason to
-- contain corpus rows at all, and if it does, that is the thing to
-- investigate rather than delete.
--
-- WHAT IT TOUCHES
-- Only accounts whose email matches '%@scale.invalid' or
-- '%.scale.invalid@%' — the two shapes seed_scale_corpus.sql produces
-- (students are rewritten onto the Imperial domain to satisfy the domain
-- trigger, so the marker moves into the local part). Every other
-- account, and all reference data, is left alone.
--
-- WHY MOST OF THE TABLES BELOW ARE NOT STRICTLY NECESSARY
-- Verified against pg_constraint on 2026-09-09: of everything that
-- points at profiles or auth.users, only FOUR are ON DELETE RESTRICT —
--
--   events.posted_by        → profiles    RESTRICT
--   opportunities.posted_by → profiles    RESTRICT
--   vcs_grants.posted_by    → profiles    RESTRICT
--   admin_actions.admin_id  → auth.users  RESTRICT
--
-- Those four are the ones that would actually abort `delete from
-- auth.users`. Everything else CASCADEs (profiles, cvs, cv_chunks,
-- member_skills, github_connections, posts, likes, bookmarks, …) or
-- SET NULLs (approved_by, reviewed_by, reporter_id). They are deleted
-- explicitly anyway, ahead of the cascade, purely so the notices give a
-- real per-table count of what the corpus was holding.
--
-- THE TWO GENUINE EXCEPTIONS, both easy to miss:
--
--   • `jobs` has NO foreign key at all and no member_id column — the
--     member is inside `payload` as JSON. Nothing cascades it. Corpus
--     rows left behind here are picked up by the worker forever, failing
--     against members that no longer exist.
--   • `cv_profiles` has no member_id either; it hangs off `cvs.cv_id`.
--     It cascades correctly, but only if cvs is deleted — so it is
--     removed via a subquery BEFORE cvs, not after.
--
-- Taxonomy and reference data (skills, sectors, cv_skills, app_config)
-- are never touched.
--
-- Idempotent: running it twice is a no-op the second time.
-- ════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_ids   uuid[];
  v_n     bigint;
  v_admin bigint;
begin
  select coalesce(array_agg(id), '{}')
    into v_ids
    from auth.users
   where email like '%@scale.invalid'
      or email like '%.scale.invalid@%';

  if array_length(v_ids, 1) is null then
    raise notice 'no corpus accounts found — nothing to do';
    return;
  end if;

  -- A corpus account should never be an admin. If one is, something has
  -- gone wrong that deleting rows will not fix.
  select count(*) into v_admin from public.admins where user_id = any(v_ids);
  if v_admin > 0 then
    raise exception 'ABORT: % corpus account(s) are in the admins table — nothing deleted', v_admin;
  end if;

  raise notice 'removing % corpus account(s)', array_length(v_ids, 1);

  delete from public.outbound_email
   where lower(to_address) like '%scale.invalid%';
  get diagnostics v_n = row_count; raise notice '  outbound_email        %', v_n;

  -- No FK, no member_id column — the member is inside the JSON payload.
  delete from public.jobs
   where (payload->>'member_id')::uuid = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  jobs                  %', v_n;

  delete from public.listing_events        where viewer_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  listing_events        %', v_n;

  delete from public.user_listing_actions  where user_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  user_listing_actions  %', v_n;

  delete from public.opportunity_bookmarks where user_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  opportunity_bookmarks %', v_n;

  delete from public.email_change_log      where user_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  email_change_log      %', v_n;

  delete from public.post_reports          where reporter_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  post_reports          %', v_n;

  delete from public.post_likes            where user_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  post_likes            %', v_n;

  delete from public.posts                 where author_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  posts                 %', v_n;

  -- Hangs off cvs.cv_id, not off the member — so it goes before cvs.
  delete from public.cv_profiles
   where cv_id in (select id from public.cvs where member_id = any(v_ids));
  get diagnostics v_n = row_count; raise notice '  cv_profiles           %', v_n;

  delete from public.cv_chunks             where member_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  cv_chunks             %', v_n;

  delete from public.cvs                   where member_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  cvs                   %', v_n;

  delete from public.member_skills         where member_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  member_skills         %', v_n;

  delete from public.github_connections    where member_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  github_connections    %', v_n;

  delete from public.listing_edits         where proposed_by = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  listing_edits         %', v_n;

  -- RESTRICT on admin_id. Should be zero given the admins check above,
  -- but target_id rows are cleared here too so nothing dangles.
  delete from public.admin_actions
   where admin_id = any(v_ids) or target_id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  admin_actions         %', v_n;

  -- RESTRICT on posted_by — these three must precede auth.users.
  delete from public.events                where posted_by = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  events                %', v_n;

  delete from public.opportunities         where posted_by = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  opportunities         %', v_n;

  delete from public.vcs_grants            where posted_by = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  vcs_grants            %', v_n;

  -- profiles cascades from auth.users.
  delete from auth.users where id = any(v_ids);
  get diagnostics v_n = row_count; raise notice '  auth.users            %', v_n;
end $$;

-- Verify: no corpus account survives, and the real accounts do.
do $$
declare
  v_left bigint;
  v_kept bigint;
begin
  select count(*) into v_left from auth.users
   where email like '%@scale.invalid' or email like '%.scale.invalid@%';
  if v_left > 0 then
    raise exception 'ABORT: % corpus account(s) still present — rolling back', v_left;
  end if;

  select count(*) into v_kept from auth.users;
  raise notice 'done — corpus removed, % account(s) remain', v_kept;
end $$;

commit;
