-- Security audit (2026-10-26): fix two confirmed vulnerabilities.
--
-- 1. Committee revoke could demote an independent admin.
-- 2. Direct PostgREST INSERT into opportunities/events/vcs_grants let an
--    approved member forge server-owned columns and skip the app-level
--    Turnstile check and submit rate limit that submit_opportunity /
--    submit_event / the vc_grant equivalent enforce.

-- ─── 1. Committee revoke must only remove committee-granted admin ────
--
-- admin_set_committee's revoke branch did `delete from public.admins
-- where user_id = p_member_id` unconditionally. Any admin could add
-- someone to committee (granting admin) then immediately revoke
-- committee — which deleted the admins row even for someone who was
-- already an independent admin before ever joining committee (the
-- founders account, or anyone onboarded via the documented "insert into
-- admins by email" procedure). The function's own comment claimed this
-- "does not touch anyone made admin outside this flow", which was true
-- of the one-time backfill INSERT but not of this DELETE path.
--
-- Fix: track whether a given admins row was granted *by* committee
-- membership. Only that kind of row is auto-revoked when committee ends.
-- Defaults to false for every existing row (including the backfill from
-- 20260904000004) — the conservative direction, since under-revoking
-- (an ex-committee member stays admin until someone notices) is a much
-- smaller problem than over-revoking (silently stripping an unrelated
-- admin's access).
alter table public.admins
  add column if not exists granted_by_committee boolean not null default false;

create or replace function public.admin_set_committee(
  p_member_id     uuid,
  p_is_committee  boolean,
  p_committee_role text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
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

  select is_committee into v_was_committee from public.profiles where id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = '22023';
  end if;

  update public.profiles
     set is_committee   = p_is_committee,
         committee_role = case when p_is_committee then trim(p_committee_role) else null end
   where id = p_member_id;

  if p_is_committee and not v_was_committee then
    -- ON CONFLICT DO NOTHING: if the row already exists (an independent
    -- admin joining committee), its granted_by_committee stays whatever
    -- it already was — never flipped to true by this branch — so
    -- leaving committee later still won't auto-revoke them.
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
$$;

-- ─── 2. Close the direct-INSERT forgery path on the three listing tables ─
--
-- submit_opportunity / admin_create_opportunity / submit_event /
-- admin_create_event / the vc_grant equivalents are the only code paths
-- the app ever uses to create a listing (lib/listings/registry.ts) — all
-- SECURITY DEFINER RPCs that enforce Turnstile, the submit rate limit,
-- and set creation_source/created_at themselves. They bypass RLS, so
-- they never needed these *_insert_own policies to work.
--
-- What the policies DID allow: any approved member calling
-- `POST /rest/v1/opportunities` (or events/vcs_grants) directly, with
-- posted_by/status/approval columns checked but nothing else. That let a
-- member skip Turnstile and the rate limit entirely, backdate/forward-date
-- created_at, and — on opportunities specifically — forge
-- creation_source = 'admin', which changes how the row is treated by the
-- AI recruiter/matching paths (20261006000002 only trusts
-- creation_source = 'member' rows there). Self-approval was already
-- blocked by the approval-metadata CHECK regardless.
--
-- Dropping these removes the capability outright rather than trying to
-- patch each forgeable column — nothing legitimate used this door.
drop policy if exists opportunities_insert_own on public.opportunities;
drop policy if exists events_insert_own        on public.events;
drop policy if exists vcs_grants_insert_own     on public.vcs_grants;
