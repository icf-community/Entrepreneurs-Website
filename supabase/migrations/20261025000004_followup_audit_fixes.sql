-- Follow-up security audit fix (2026-10-25), findings F3 and F5 from the
-- re-audit of the same-day security remediation (20261025000001-3).
--
-- F3: 84886a6 (20261025000003) added an is_approved() check to the RPC
-- path for editing an already-APPROVED listing (update_event/
-- update_opportunity/update_vc_grant), but a banned member can still
-- directly PATCH their own still-PENDING listing via PostgREST — the
-- *_update_own RLS policies (and opportunity_skills/sectors_modify_own)
-- check ownership and status='pending' but never is_approved(). Reproduced:
-- a banned member's direct PATCH of their own pending opportunity returned
-- 204 and the edit stuck, even though the update_opportunity RPC correctly
-- rejects the same caller.
--
-- F5: confirm_github_connected is security definer, granted to
-- authenticated, and takes the caller's claimed GitHub identity and OAuth
-- access token as plain arguments with no verification that they came from
-- a real completed OAuth exchange — any member can call it directly with
-- an arbitrary github_user_id/username/token. This bypasses the app's own
-- githubConnect rate-limit bucket (enforced only at the Next.js layer) and
-- can set profiles.github_url once with a fabricated username. Fix: take
-- the member id as an explicit parameter instead of auth.uid(), require
-- the caller to be service_role, and move the one real call site
-- (frontend/src/app/auth/github-connect/callback/route.ts) onto the
-- service-role client — that route already independently verifies the
-- signed-in member via supabase.auth.getUser() before this call, so this
-- is the same authorization check, just no longer re-derivable by a
-- caller who skips the app and calls PostgREST directly.

-- ─── F3: pending-listing RLS policies must also require is_approved() ─
drop policy if exists opportunities_update_own on public.opportunities;
create policy opportunities_update_own on public.opportunities
  for update to authenticated
  using (posted_by = auth.uid() and status = 'pending' and public.is_approved())
  with check (posted_by = auth.uid() and status = 'pending' and public.is_approved());

drop policy if exists events_update_own on public.events;
create policy events_update_own on public.events
  for update to authenticated
  using (posted_by = auth.uid() and status = 'pending' and public.is_approved())
  with check (posted_by = auth.uid() and status = 'pending' and public.is_approved());

drop policy if exists vcs_grants_update_own on public.vcs_grants;
create policy vcs_grants_update_own on public.vcs_grants
  for update to authenticated
  using (posted_by = auth.uid() and status = 'pending' and public.is_approved())
  with check (posted_by = auth.uid() and status = 'pending' and public.is_approved());

drop policy if exists opportunity_skills_modify_own on public.opportunity_skills;
create policy opportunity_skills_modify_own on public.opportunity_skills
  for all to authenticated
  using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and o.posted_by = auth.uid()
        and o.status = 'pending'
        and public.is_approved()
    )
  )
  with check (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and o.posted_by = auth.uid()
        and o.status = 'pending'
        and public.is_approved()
    )
  );

drop policy if exists opportunity_sectors_modify_own on public.opportunity_sectors;
create policy opportunity_sectors_modify_own on public.opportunity_sectors
  for all to authenticated
  using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and o.posted_by = auth.uid()
        and o.status = 'pending'
        and public.is_approved()
    )
  )
  with check (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and o.posted_by = auth.uid()
        and o.status = 'pending'
        and public.is_approved()
    )
  );

-- ─── F5: confirm_github_connected must not trust a caller-supplied
-- identity/token with no verified binding to a real OAuth exchange ─────
-- Recreated from 20260911000003 (the latest definition) with one
-- structural change: v_caller comes from a new p_member_id parameter
-- instead of auth.uid(), and the function now requires service_role.
-- Every other line is unchanged.
drop function if exists public.confirm_github_connected(bigint, text, text, text);

create or replace function public.confirm_github_connected(
  p_member_id       uuid,
  p_github_user_id  bigint,
  p_github_username text,
  p_access_token    text,
  p_encryption_key  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := p_member_id;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.github_connections (
    member_id, github_user_id, github_username, access_token_encrypted,
    scan_status, scan_failure_reason, connected_at
  )
  values (
    v_caller, p_github_user_id, p_github_username,
    -- SCHEMA-QUALIFIED, and it must stay that way — see 20260908000002's
    -- header for why an unqualified call here breaks every connection.
    extensions.pgp_sym_encrypt(p_access_token, p_encryption_key),
    'pending', null, now()
  )
  on conflict (member_id) do update
    set github_user_id         = excluded.github_user_id,
        github_username        = excluded.github_username,
        access_token_encrypted = excluded.access_token_encrypted,
        scan_status            = 'pending',
        scan_failure_reason    = null,
        connected_at           = now();

  update public.profiles
     set github_url = 'https://github.com/' || p_github_username
   where id = v_caller
     and github_url is null;

  -- Guarded against duplicate pending jobs and the per-member LLM budget
  -- (20260908000002), and the ingestion kill switch (20260911000003).
  insert into public.jobs (kind, payload)
  select 'scan_github', jsonb_build_object('member_id', v_caller)
   where public.github_cv_ingestion_enabled()
     and public.llm_job_budget_available(v_caller)
     and not exists (
       select 1 from public.jobs j
        where j.kind = 'scan_github'
          and j.status = 'pending'
          and (j.payload->>'member_id')::uuid = v_caller
     );
end;
$$;

revoke execute on function public.confirm_github_connected(uuid, bigint, text, text, text) from public, anon, authenticated;
grant  execute on function public.confirm_github_connected(uuid, bigint, text, text, text) to service_role;
