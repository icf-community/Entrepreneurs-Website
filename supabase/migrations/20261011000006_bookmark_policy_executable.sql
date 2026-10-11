-- Bookmarking a job failed for every member (programme S0, found by
-- e2e/double-submit.spec.ts).
--
-- 20261006000002 gave the bookmark insert policy a call to
-- member_admits_audience(uid, audience), a function members may not
-- execute (it takes an arbitrary member id, so its grant stays revoked).
-- Postgres checks EXECUTE when it plans the policy, whatever the OR
-- short-circuit would have done, so every bookmark insert raised
-- "permission denied" and the UI rolled the star back with an error. No
-- test had asserted a successful bookmark write since that migration.
--
-- viewer_admits_audience(audience) is the same rule for the caller
-- (auth.uid() inside) and is granted to authenticated. rls_smoke now scans
-- every policy for functions its roles cannot execute, and bookmarks a
-- job as a student.
drop policy if exists "opportunity_bookmarks_insert_own" on public.opportunity_bookmarks;
create policy "opportunity_bookmarks_insert_own" on public.opportunity_bookmarks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.opportunities o
                 where o.id = opportunity_bookmarks.opportunity_id
                   and o.status = 'approved'
                   and (o.posted_by = (select auth.uid())
                        or public.viewer_admits_audience(o.eligible_audience))));
