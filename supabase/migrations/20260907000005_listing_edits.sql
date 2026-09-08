-- ════════════════════════════════════════════════════════════════════
-- Foundry · Post-approval listing edits
--
-- Today an approved listing is frozen for everybody. update_event /
-- update_vc_grant / update_opportunity all raise 'Only pending listings
-- can be edited' the moment status <> 'pending' (20260826000001 line 66,
-- 20260529000009 line 56), and there is no admin content-edit RPC at all
-- — tg_listings_protect_status lets an admin change *status*, nothing
-- else. A wrong room number on a live event is unfixable through the UI
-- by the organiser or an admin; the only remedy is raw SQL against prod,
-- which is not a remedy.
--
-- One rule: any edit to an approved listing becomes a proposed revision
-- an admin must approve. Nothing an organiser changes reaches the public
-- page without a human seeing it — including a moved start time or a
-- changed location, which are safeguarding changes even when not one
-- word of the description moved.
--
-- Three properties make that strict rule safe rather than merely strict:
--
--   1. The approved version stays published while the revision waits.
--      `status` is never written by any function here, so an event with
--      300 signups does not vanish from the site because someone fixed a
--      typo. This is the single most important detail in the file.
--   2. Cancelling is immediate and needs no approval — and it already
--      exists. 20260530000001 lets a poster DELETE their own listing at
--      any status, wired to the Delete control in /my-submissions with a
--      confirm. A second "withdraw to expired" path would give members
--      two removal verbs with different semantics for no gain, so the
--      only thing added here is a cleanup trigger that takes any queued
--      revision down with the listing.
--   3. The live page can say a revision is pending — neutral line, no
--      proposed values — via listing_has_pending_edit().
--
-- ─── One table, not two ─────────────────────────────────────────────
-- The plan called for `listing_pending_edits` plus a separate
-- `listing_edit_log`. Rows here are never deleted on review, only moved
-- to applied/rejected/discarded, and `previous` snapshots the row as it
-- stood at apply time — so this one table already IS the before/after
-- audit trail, for the revision path and for direct admin edits alike.
-- Two tables would have been the same facts written twice.
--
-- ─── Payload shape ──────────────────────────────────────────────────
-- `proposed` is jsonb keyed by the update_* parameter names minus their
-- `p_` prefix. It is never applied by dynamic SQL: apply_listing_edit_
-- payload() has one hand-written UPDATE per kind that reads exactly the
-- keys that kind allows, so an extra key in the jsonb reaches no column.
-- That is the control that keeps a member-supplied blob from touching
-- status, approved_by or is_society_event.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Schema ───────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'listing_edit_status') then
    create type public.listing_edit_status as enum
      ('pending', 'applied', 'rejected', 'discarded');
  end if;
end;
$$;

create table if not exists public.listing_edits (
  id            uuid primary key default gen_random_uuid(),
  listing_kind  public.listing_event_kind not null,
  -- Deliberately no FK: listing_id is polymorphic across three tables.
  -- The AFTER DELETE triggers below are what keep it from dangling,
  -- mirroring tg_cleanup_listing_events_for_listing.
  listing_id    uuid not null,
  proposed      jsonb not null,
  -- Snapshot of the live row taken at apply time. Null while pending,
  -- and null forever on a rejected or discarded revision (nothing
  -- changed, so there is no "before" worth recording).
  previous      jsonb,
  proposed_by   uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  status        public.listing_edit_status not null default 'pending',
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  reject_reason text,
  -- A pending revision has not been reviewed; anything else has, even
  -- the trigger-discarded ones (which have a time but no reviewer).
  constraint listing_edits_review_consistency check (
    (status = 'pending') = (reviewed_at is null)
  ),
  constraint listing_edits_reject_reason_consistency check (
    (status = 'rejected') = (reject_reason is not null)
  )
);

-- The rule that a listing has at most one open revision. Enforced here
-- rather than in the RPC so a race between two tabs cannot produce two.
create unique index if not exists listing_edits_one_pending_idx
  on public.listing_edits (listing_kind, listing_id)
  where status = 'pending';

create index if not exists listing_edits_queue_idx
  on public.listing_edits (created_at)
  where status = 'pending';

create index if not exists listing_edits_listing_idx
  on public.listing_edits (listing_kind, listing_id);

create index if not exists listing_edits_proposed_by_idx
  on public.listing_edits (proposed_by);

-- Deny-all: no policies, so every read and write goes through the
-- SECURITY DEFINER functions below, which carry the real authorisation.
alter table public.listing_edits enable row level security;
revoke all on public.listing_edits from anon, authenticated;

comment on table public.listing_edits is
  'Proposed and historical edits to approved listings. Deny-all RLS; reached only through the listing-edit RPCs.';

-- Existing admin_actions rows record target_table as the real table
-- name ('events', not 'event'), and admin_actions_target_idx is on
-- (target_table, target_id) — so the new rows written below have to use
-- the same vocabulary or they sort into their own private namespace.
create or replace function public.listing_table_name(p_kind public.listing_event_kind)
returns text
language sql
immutable
as $$
  select case p_kind
           when 'event'       then 'events'
           when 'vc_grant'    then 'vcs_grants'
           when 'opportunity' then 'opportunities'
         end;
$$;

-- ─── 2. Snapshot: the live row as an edit payload ────────────────────
-- Used for `previous` at apply time, and for the "current" half of the
-- admin diff view — computed at review time, not at proposal time, so a
-- reviewer always compares against what is actually published now.

create or replace function public.listing_snapshot(
  p_kind       public.listing_event_kind,
  p_listing_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_kind = 'event' then
    select jsonb_build_object(
             'title', e.title,
             'description', e.description,
             'luma_link', e.luma_link,
             'event_at', e.event_at,
             'location', e.location,
             'organiser_name', e.organiser_name,
             'contact_email', e.contact_email,
             'contact_email_visible', e.contact_email_visible)
      into v from public.events e where e.id = p_listing_id;

  elsif p_kind = 'vc_grant' then
    select jsonb_build_object(
             'kind', g.kind,
             'name', g.name,
             'description', g.description,
             'link', g.link,
             'amount', g.amount,
             'deadline', g.deadline,
             'stage', g.stage)
      into v from public.vcs_grants g where g.id = p_listing_id;

  elsif p_kind = 'opportunity' then
    select jsonb_build_object(
             'position_name', o.position_name,
             'company', o.company,
             'pay', o.pay,
             'location_type', o.location_type,
             'location_text', o.location_text,
             'description', o.description,
             'start_month', o.start_month,
             'start_year', o.start_year,
             'application_deadline', o.application_deadline,
             'contact_email', o.contact_email,
             'contact_email_visible', o.contact_email_visible,
             'apply_method', o.apply_method,
             'apply_url', o.apply_url,
             'skill_ids', coalesce((select jsonb_agg(s.skill_id order by s.skill_id)
                                      from public.opportunity_skills s
                                     where s.opportunity_id = o.id), '[]'::jsonb),
             'sector_ids', coalesce((select jsonb_agg(x.sector_id order by x.sector_id)
                                       from public.opportunity_sectors x
                                      where x.opportunity_id = o.id), '[]'::jsonb))
      into v from public.opportunities o where o.id = p_listing_id;
  end if;

  return v;
end;
$$;

-- ─── 3. Apply a payload onto a live row ──────────────────────────────
-- One hand-written UPDATE per kind. No dynamic SQL, no column list
-- derived from the payload's own keys: the set of writable columns is
-- fixed here, which is what stops a crafted payload reaching `status`,
-- `approved_by`, `posted_by` or `is_society_event`.
--
-- The table CHECK constraints still do the content validation (lengths,
-- email and URL formats), which is why stage_listing_edit() dry-runs
-- through this same function rather than re-implementing them.

create or replace function public.apply_listing_edit_payload(
  p_kind       public.listing_event_kind,
  p_listing_id uuid,
  p_payload    jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'event' then
    update public.events
       set title                 = p_payload->>'title',
           description           = p_payload->>'description',
           luma_link             = p_payload->>'luma_link',
           event_at              = (p_payload->>'event_at')::timestamptz,
           location              = p_payload->>'location',
           organiser_name        = p_payload->>'organiser_name',
           contact_email         = p_payload->>'contact_email',
           contact_email_visible = coalesce((p_payload->>'contact_email_visible')::boolean, false)
     where id = p_listing_id;

  elsif p_kind = 'vc_grant' then
    update public.vcs_grants
       set kind        = (p_payload->>'kind')::public.vc_grant_kind,
           name        = p_payload->>'name',
           description = p_payload->>'description',
           link        = p_payload->>'link',
           amount      = p_payload->>'amount',
           deadline    = (p_payload->>'deadline')::date,
           stage       = p_payload->>'stage'
     where id = p_listing_id;

  elsif p_kind = 'opportunity' then
    update public.opportunities
       set position_name         = p_payload->>'position_name',
           company               = p_payload->>'company',
           pay                   = p_payload->>'pay',
           location_type         = (p_payload->>'location_type')::public.location_type,
           location_text         = p_payload->>'location_text',
           description           = p_payload->>'description',
           start_month           = (p_payload->>'start_month')::smallint,
           start_year            = (p_payload->>'start_year')::int,
           application_deadline  = (p_payload->>'application_deadline')::date,
           contact_email         = p_payload->>'contact_email',
           contact_email_visible = coalesce((p_payload->>'contact_email_visible')::boolean, false),
           apply_method          = (p_payload->>'apply_method')::public.apply_method,
           apply_url             = p_payload->>'apply_url'
     where id = p_listing_id;

    -- Same resync update_opportunity does, so the junction tables can
    -- never drift from the parent row.
    delete from public.opportunity_skills  where opportunity_id = p_listing_id;
    delete from public.opportunity_sectors where opportunity_id = p_listing_id;

    insert into public.opportunity_skills (opportunity_id, skill_id)
    select p_listing_id, value::smallint
      from jsonb_array_elements_text(coalesce(p_payload->'skill_ids', '[]'::jsonb))
    on conflict do nothing;

    insert into public.opportunity_sectors (opportunity_id, sector_id)
    select p_listing_id, value::smallint
      from jsonb_array_elements_text(coalesce(p_payload->'sector_ids', '[]'::jsonb))
    on conflict do nothing;
  end if;
end;
$$;

-- ─── 4. Stage a revision ─────────────────────────────────────────────
-- Called only from the three update_* RPCs, which have already proved
-- caller = posted_by. It does not re-check ownership, and it is revoked
-- from every client role — the update_* functions are its only door.
--
-- The dry-run is the point of the inner block. A staged payload sits in
-- jsonb, outside reach of the tables' CHECK constraints, until an admin
-- applies it — so without this, a payload that violates
-- events_description_len would be accepted here and blow up in the
-- admin's face days later. Applying it inside a sub-block and forcing a
-- rollback validates against the real constraints instead of
-- re-implementing them (which would then drift).

create or replace function public.stage_listing_edit(
  p_kind       public.listing_event_kind,
  p_listing_id uuid,
  p_payload    jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
begin
  -- Validate by applying for real and rolling the sub-transaction back.
  -- The 'FDRY1' sqlstate is this function's own private signal, so the
  -- handler cannot swallow a genuine constraint violation: those carry
  -- their own sqlstates and fall through to the caller.
  begin
    perform public.apply_listing_edit_payload(p_kind, p_listing_id, p_payload);
    raise exception 'dry run' using errcode = 'FDRY1';
  exception when sqlstate 'FDRY1' then
    null;
  end;

  insert into public.listing_edits (listing_kind, listing_id, proposed, proposed_by)
  values (p_kind, p_listing_id, p_payload, v_caller)
  on conflict (listing_kind, listing_id) where status = 'pending'
  do update set proposed    = excluded.proposed,
                proposed_by = excluded.proposed_by,
                created_at  = now();
end;
$$;

-- ─── 5. The three member edit RPCs, recreated ────────────────────────
-- Exact existing signatures ([[recreate-function-from-latest]]) — a
-- changed argument list here would leave the old definition behind as a
-- live overload and PostgREST would keep resolving to it.
--
-- The only change in each: the `status <> 'pending'` raise becomes a
-- branch. Pending edits in place exactly as before; approved stages a
-- revision; rejected and expired still raise, because there is nothing
-- published to revise.
--
-- `returns void` is kept on purpose. The caller already knows the
-- listing's status — it loaded the row to render the form — so telling
-- it again would only be a second source of truth to disagree with.

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
    from public.events where id = p_id;
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
    from public.vcs_grants where id = p_id;
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

create or replace function public.update_opportunity(
  p_id                    uuid,
  p_position_name         text,
  p_company               text,
  p_pay                   text,
  p_location_type         location_type,
  p_location_text         text,
  p_description           text,
  p_start_month           smallint,
  p_start_year            int,
  p_application_deadline  date,
  p_contact_email         text,
  p_contact_email_visible boolean,
  p_apply_method          apply_method,
  p_apply_url             text,
  p_skill_ids             smallint[],
  p_sector_ids            smallint[]
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
    from public.opportunities where id = p_id;
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
         apply_url             = p_apply_url
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
$$;

-- ─── 6. Member reads ─────────────────────────────────────────────────

-- Drives the neutral "changes pending review" line on the live listing.
-- Boolean only: no proposed values leak to people who are not the
-- organiser or an admin. Gated on is_approved() because the listing
-- pages themselves are member-only.
create or replace function public.listing_has_pending_edit(
  p_kind       public.listing_event_kind,
  p_listing_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_approved() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return exists (
    select 1 from public.listing_edits
     where listing_kind = p_kind
       and listing_id   = p_listing_id
       and status       = 'pending');
end;
$$;

-- The organiser's own view of their queued revision, for the banner on
-- the edit page and for the diff the proposal notice reports. Owner-
-- scoped: the ownership check is on the listing, not the edit row, so a
-- member can never read somebody else's proposal, and `current_values`
-- is the row they already have full read access to.
drop function if exists public.get_my_pending_listing_edit(public.listing_event_kind, uuid);
create or replace function public.get_my_pending_listing_edit(
  p_kind       public.listing_event_kind,
  p_listing_id uuid
)
returns table (id uuid, proposed jsonb, current_values jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Table aliases are load-bearing: this function's `returns table (id
  -- uuid, ...)` puts an `id` variable in scope, so a bare `where id =
  -- p_listing_id` is ambiguous and fails at runtime.
  if    p_kind = 'event'       then select t.posted_by into v_owner from public.events        t where t.id = p_listing_id;
  elsif p_kind = 'vc_grant'    then select t.posted_by into v_owner from public.vcs_grants    t where t.id = p_listing_id;
  elsif p_kind = 'opportunity' then select t.posted_by into v_owner from public.opportunities t where t.id = p_listing_id;
  end if;

  if v_owner is null or v_owner <> v_caller then
    return;
  end if;

  return query
    select e.id, e.proposed,
           public.listing_snapshot(p_kind, p_listing_id),
           e.created_at
      from public.listing_edits e
     where e.listing_kind = p_kind
       and e.listing_id   = p_listing_id
       and e.status       = 'pending';
end;
$$;

-- ─── 7. Admin review ─────────────────────────────────────────────────

-- The queue. `current` is computed now, not stored at proposal time, so
-- a reviewer always diffs against what is actually published — including
-- when an admin has since edited the listing directly (D4).
create or replace function public.admin_list_listing_edits()
returns table (
  id               uuid,
  listing_kind     public.listing_event_kind,
  listing_id       uuid,
  listing_title    text,
  proposed         jsonb,
  current_values   jsonb,
  proposed_by      uuid,
  proposed_by_name text,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  return query
    select e.id,
           e.listing_kind,
           e.listing_id,
           coalesce(cur.snap->>'title', cur.snap->>'name',
                    cur.snap->>'position_name', '(deleted)')::text,
           e.proposed,
           cur.snap,
           e.proposed_by,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), '')::text,
           e.created_at
      from public.listing_edits e
      cross join lateral (
        select public.listing_snapshot(e.listing_kind, e.listing_id) as snap
      ) cur
      left join public.profiles p on p.id = e.proposed_by
     where e.status = 'pending'
     order by e.created_at;
end;
$$;

-- Apply. Returns the organiser's contact details in the same
-- TABLE(email, first_name, title) shape the reject_* RPCs return, so the
-- notification path in lib/listings can be the one it already uses.
create or replace function public.admin_apply_listing_edit(p_edit_id uuid)
returns table (email text, first_name text, title text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller  uuid := auth.uid();
  v_kind    public.listing_event_kind;
  v_listing uuid;
  v_payload jsonb;
  v_owner   uuid;
  v_status  listing_status;
  v_before  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  -- for update: two admins clicking Approve on the same revision must
  -- not both apply it.
  select e.listing_kind, e.listing_id, e.proposed
    into v_kind, v_listing, v_payload
    from public.listing_edits e
   where e.id = p_edit_id and e.status = 'pending'
     for update;
  if not found then
    raise exception 'That revision has already been reviewed.' using errcode = '42501';
  end if;

  if    v_kind = 'event'       then select t.posted_by, t.status into v_owner, v_status from public.events        t where t.id = v_listing;
  elsif v_kind = 'vc_grant'    then select t.posted_by, t.status into v_owner, v_status from public.vcs_grants    t where t.id = v_listing;
  elsif v_kind = 'opportunity' then select t.posted_by, t.status into v_owner, v_status from public.opportunities t where t.id = v_listing;
  end if;

  -- The listing stopped being published between proposal and review
  -- (expired, or rejected out from under it). Refuse rather than
  -- republish stale content onto a row nobody expects to change.
  --
  -- No discard is written here on purpose: RAISE aborts the transaction,
  -- so any UPDATE in this branch would be rolled back with it. The
  -- unpublish trigger below has already marked the revision discarded —
  -- this branch only catches a row that somehow escaped it.
  if v_status is distinct from 'approved' then
    raise exception 'That listing is no longer published, so the revision cannot be applied.'
      using errcode = '42501';
  end if;

  v_before := public.listing_snapshot(v_kind, v_listing);
  perform public.apply_listing_edit_payload(v_kind, v_listing, v_payload);

  update public.listing_edits
     set status = 'applied', previous = v_before, reviewed_at = now(), reviewed_by = v_caller
   where id = p_edit_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'apply_listing_edit', public.listing_table_name(v_kind), v_listing, p_edit_id::text);

  return query
    select au.email::text,
           p.first_name,
           coalesce(v_before->>'title', v_before->>'name', v_before->>'position_name')::text
      from public.profiles p
      join auth.users au on au.id = p.id
     where p.id = v_owner;
end;
$$;

create or replace function public.admin_reject_listing_edit(
  p_edit_id uuid,
  p_reason  text
)
returns table (email text, first_name text, title text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller  uuid := auth.uid();
  v_kind    public.listing_event_kind;
  v_listing uuid;
  v_owner   uuid;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Rejection reason is required';
  end if;

  select e.listing_kind, e.listing_id into v_kind, v_listing
    from public.listing_edits e
   where e.id = p_edit_id and e.status = 'pending'
     for update;
  if not found then
    raise exception 'That revision has already been reviewed.' using errcode = '42501';
  end if;

  update public.listing_edits
     set status = 'rejected', reject_reason = p_reason,
         reviewed_at = now(), reviewed_by = v_caller
   where id = p_edit_id;

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'reject_listing_edit', public.listing_table_name(v_kind), v_listing, p_reason);

  if    v_kind = 'event'       then select t.posted_by into v_owner from public.events        t where t.id = v_listing;
  elsif v_kind = 'vc_grant'    then select t.posted_by into v_owner from public.vcs_grants    t where t.id = v_listing;
  elsif v_kind = 'opportunity' then select t.posted_by into v_owner from public.opportunities t where t.id = v_listing;
  end if;

  return query
    select au.email::text,
           p.first_name,
           coalesce(public.listing_snapshot(v_kind, v_listing)->>'title',
                    public.listing_snapshot(v_kind, v_listing)->>'name',
                    public.listing_snapshot(v_kind, v_listing)->>'position_name')::text
      from public.profiles p
      join auth.users au on au.id = p.id
     where p.id = v_owner;
end;
$$;

-- The urgent-fix path: an admin should not have to wait on an organiser
-- to propose a correction to a live listing. Logged into the same table
-- as the revision path (status 'applied', proposer = the admin), so the
-- audit trail has one shape.
create or replace function public.admin_update_listing(
  p_kind       public.listing_event_kind,
  p_listing_id uuid,
  p_payload    jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_before jsonb;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;

  v_before := public.listing_snapshot(p_kind, p_listing_id);
  if v_before is null then
    raise exception 'Listing not found.' using errcode = '42501';
  end if;

  perform public.apply_listing_edit_payload(p_kind, p_listing_id, p_payload);

  insert into public.listing_edits (
    listing_kind, listing_id, proposed, previous, proposed_by,
    status, reviewed_by, reviewed_at)
  values (p_kind, p_listing_id, p_payload, v_before, v_caller,
          'applied', v_caller, now());

  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (v_caller, 'admin_update_listing', public.listing_table_name(p_kind), p_listing_id, null);
end;
$$;

-- ─── 8. Lifecycle triggers ───────────────────────────────────────────
-- D4's edge cases, handled where they cannot be forgotten rather than in
-- each of the expiry crons and reject RPCs separately.

create or replace function public.tg_discard_listing_edits_on_unpublish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'approved' and new.status is distinct from 'approved' then
    update public.listing_edits
       set status = 'discarded', reviewed_at = now()
     where listing_kind = TG_ARGV[0]::public.listing_event_kind
       and listing_id   = new.id
       and status       = 'pending';
  end if;
  return new;
end;
$$;

create or replace function public.tg_cleanup_listing_edits_for_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.listing_edits
   where listing_kind = TG_ARGV[0]::public.listing_event_kind
     and listing_id   = OLD.id;
  return OLD;
end;
$$;

drop trigger if exists events_discard_listing_edits on public.events;
create trigger events_discard_listing_edits
  after update of status on public.events
  for each row execute function public.tg_discard_listing_edits_on_unpublish('event');

drop trigger if exists vcs_grants_discard_listing_edits on public.vcs_grants;
create trigger vcs_grants_discard_listing_edits
  after update of status on public.vcs_grants
  for each row execute function public.tg_discard_listing_edits_on_unpublish('vc_grant');

drop trigger if exists opportunities_discard_listing_edits on public.opportunities;
create trigger opportunities_discard_listing_edits
  after update of status on public.opportunities
  for each row execute function public.tg_discard_listing_edits_on_unpublish('opportunity');

drop trigger if exists events_cleanup_listing_edits on public.events;
create trigger events_cleanup_listing_edits
  after delete on public.events
  for each row execute function public.tg_cleanup_listing_edits_for_listing('event');

drop trigger if exists vcs_grants_cleanup_listing_edits on public.vcs_grants;
create trigger vcs_grants_cleanup_listing_edits
  after delete on public.vcs_grants
  for each row execute function public.tg_cleanup_listing_edits_for_listing('vc_grant');

drop trigger if exists opportunities_cleanup_listing_edits on public.opportunities;
create trigger opportunities_cleanup_listing_edits
  after delete on public.opportunities
  for each row execute function public.tg_cleanup_listing_edits_for_listing('opportunity');

-- ─── 9. Grants ───────────────────────────────────────────────────────
-- [[function-grant-default-privileges]]: on Supabase `revoke from public`
-- alone is a no-op, because anon and authenticated hold their own direct
-- grants from the default privileges. Every function has to be revoked
-- from the named roles and then granted back explicitly.

revoke all on function public.listing_table_name(public.listing_event_kind)
  from public, anon, authenticated;
revoke all on function public.listing_snapshot(public.listing_event_kind, uuid)
  from public, anon, authenticated;
revoke all on function public.apply_listing_edit_payload(public.listing_event_kind, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.stage_listing_edit(public.listing_event_kind, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.tg_discard_listing_edits_on_unpublish()
  from public, anon, authenticated;
revoke all on function public.tg_cleanup_listing_edits_for_listing()
  from public, anon, authenticated;

revoke all on function public.listing_has_pending_edit(public.listing_event_kind, uuid)
  from public, anon;
grant execute on function public.listing_has_pending_edit(public.listing_event_kind, uuid)
  to authenticated;

revoke all on function public.get_my_pending_listing_edit(public.listing_event_kind, uuid)
  from public, anon;
grant execute on function public.get_my_pending_listing_edit(public.listing_event_kind, uuid)
  to authenticated;

revoke all on function public.admin_list_listing_edits() from public, anon;
grant execute on function public.admin_list_listing_edits() to authenticated;

revoke all on function public.admin_apply_listing_edit(uuid) from public, anon;
grant execute on function public.admin_apply_listing_edit(uuid) to authenticated;

revoke all on function public.admin_reject_listing_edit(uuid, text) from public, anon;
grant execute on function public.admin_reject_listing_edit(uuid, text) to authenticated;

revoke all on function public.admin_update_listing(public.listing_event_kind, uuid, jsonb)
  from public, anon;
grant execute on function public.admin_update_listing(public.listing_event_kind, uuid, jsonb)
  to authenticated;

-- The three recreated member RPCs keep the grants 20260826000001 and
-- 20260529000009 gave them. `create or replace` preserves grants, but
-- restating them costs nothing and makes this file self-contained.
grant execute on function public.update_event(
  uuid, text, text, text, timestamptz, text, text, text, boolean
) to authenticated;
grant execute on function public.update_vc_grant(
  uuid, vc_grant_kind, text, text, text, text, date, text
) to authenticated;
grant execute on function public.update_opportunity(
  uuid, text, text, text, location_type, text, text, smallint, int, date,
  text, boolean, apply_method, text, smallint[], smallint[]
) to authenticated;
