-- ════════════════════════════════════════════════════════════════════
-- Adversarial sweep F6 / F7 / F8: the database, not the form, decides what
-- a listing may contain.
--
-- Everything the member-facing write RPCs accept is also reachable by a
-- script holding the anon key and any member JWT, and by the replay of a
-- staged edit. zod in the server actions is a UX layer; the limiter in
-- front of them is fail-open when Upstash is unconfigured. So the rules
-- below live on the tables, where every path (the submit_/update_/
-- admin_create_ RPCs, admin_apply_listing_edit, service-role scripts) goes
-- through them, instead of being copied into a dozen function bodies.
--
-- F6  A member could park unlimited pending listings in the review queue
--     (20 parallel identical submit_opportunity calls stored 20 rows).
--     -> BEFORE INSERT trigger: at most 10 pending per member per kind,
--        serialised per member with an advisory lock so parallel inserts
--        cannot all read "9" and pass.
-- F7  A listing deleted at the same moment a member marked it left an
--     orphan user_listing_actions row (no FK: the table is polymorphic).
--     -> BEFORE INSERT trigger takes FOR SHARE on the listing row, so the
--        insert and a concurrent delete serialise; after the delete
--        commits the row is gone and the insert is refused (P0002).
-- F8  Values that are accepted but nonsensical or hostile:
--       - blank-looking titles (whitespace, zero-width) and oversized
--         contact emails                         -> CHECK constraints
--       - deadlines in the year 9999             -> CHECK constraints
--       - a VC/grant deadline in the past        -> trigger (insert, or an
--         update that changes it; editing something else on an expired
--         listing must keep working, and "no deadline" stays legal)
--       - 10,000 skill ids on one opportunity    -> statement trigger, 50
--
-- PROD PRE-CHECK (run before pushing; every query must return 0 rows or
-- the matching VALIDATE below fails and the migration rolls back):
--   select id from public.opportunities
--    where length(contact_email) > 254 or application_deadline >= '2100-01-01'
--       or regexp_replace(position_name, '[\s​-‍⁠﻿]', '', 'g') = ''
--       or regexp_replace(company,       '[\s​-‍⁠﻿]', '', 'g') = '';
--   select id from public.events
--    where length(contact_email) > 254
--       or regexp_replace(title,          '[\s​-‍⁠﻿]', '', 'g') = ''
--       or regexp_replace(organiser_name, '[\s​-‍⁠﻿]', '', 'g') = '';
--   select id from public.vcs_grants
--    where deadline >= '2100-01-01'
--       or regexp_replace(name, '[\s​-‍⁠﻿]', '', 'g') = '';
--   select opportunity_id from public.opportunity_skills
--    group by 1 having count(*) > 50;           -- informational: the skills trigger only checks new inserts
--   select posted_by, count(*) from public.opportunities where status = 'pending' group by 1 having count(*) > 10;
--                                                -- informational: the cap only checks new inserts
--
-- ROLLBACK: drop the triggers/functions and constraints named below.
-- ════════════════════════════════════════════════════════════════════

-- ─── F8: CHECK constraints ──────────────────────────────────────────
-- "Blank" = nothing left once whitespace and the zero-width characters
-- (ZWSP/ZWNJ/ZWJ, word joiner, BOM) are removed.

alter table public.opportunities
  drop constraint if exists opportunities_contact_email_max,
  drop constraint if exists opportunities_position_name_nonblank,
  drop constraint if exists opportunities_company_nonblank,
  drop constraint if exists opportunities_deadline_sane;
alter table public.opportunities
  add constraint opportunities_contact_email_max check (length(contact_email) <= 254) not valid,
  add constraint opportunities_position_name_nonblank check (regexp_replace(position_name, '[\s​-‍⁠﻿]', '', 'g') <> '') not valid,
  add constraint opportunities_company_nonblank check (regexp_replace(company, '[\s​-‍⁠﻿]', '', 'g') <> '') not valid,
  add constraint opportunities_deadline_sane check (application_deadline < date '2100-01-01') not valid;
alter table public.opportunities validate constraint opportunities_contact_email_max;
alter table public.opportunities validate constraint opportunities_position_name_nonblank;
alter table public.opportunities validate constraint opportunities_company_nonblank;
alter table public.opportunities validate constraint opportunities_deadline_sane;

alter table public.events
  drop constraint if exists events_contact_email_max,
  drop constraint if exists events_title_nonblank,
  drop constraint if exists events_organiser_name_nonblank;
alter table public.events
  add constraint events_contact_email_max check (length(contact_email) <= 254) not valid,
  add constraint events_title_nonblank check (regexp_replace(title, '[\s​-‍⁠﻿]', '', 'g') <> '') not valid,
  add constraint events_organiser_name_nonblank check (regexp_replace(organiser_name, '[\s​-‍⁠﻿]', '', 'g') <> '') not valid;
alter table public.events validate constraint events_contact_email_max;
alter table public.events validate constraint events_title_nonblank;
alter table public.events validate constraint events_organiser_name_nonblank;

alter table public.vcs_grants
  drop constraint if exists vcs_grants_name_nonblank,
  drop constraint if exists vcs_grants_deadline_sane;
alter table public.vcs_grants
  add constraint vcs_grants_name_nonblank check (regexp_replace(name, '[\s​-‍⁠﻿]', '', 'g') <> '') not valid,
  add constraint vcs_grants_deadline_sane check (deadline < date '2100-01-01') not valid;
alter table public.vcs_grants validate constraint vcs_grants_name_nonblank;
alter table public.vcs_grants validate constraint vcs_grants_deadline_sane;

-- ─── F8: VC/grant deadline must not be in the past ──────────────────
-- Only when it is being SET: an insert, or an update that changes it.
-- Editing the description of a listing whose deadline has since passed
-- must not start failing, and a NULL deadline (rolling applications) is
-- legitimate.
create or replace function public.tg_vcs_grants_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deadline is not null
     and new.deadline < current_date
     and (tg_op = 'INSERT' or new.deadline is distinct from old.deadline) then
    raise exception 'The deadline must be today or later.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_vcs_grants_deadline() from public, anon, authenticated;

drop trigger if exists vcs_grants_deadline on public.vcs_grants;
create trigger vcs_grants_deadline
  before insert or update of deadline on public.vcs_grants
  for each row execute function public.tg_vcs_grants_deadline();

-- ─── F8: at most 50 skills on an opportunity ────────────────────────
create or replace function public.tg_cap_opportunity_skills()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.opportunity_skills os
     where os.opportunity_id in (select opportunity_id from new_rows)
     group by os.opportunity_id
    having count(*) > 50
  ) then
    raise exception 'Choose at most 50 skills.' using errcode = '22023';
  end if;
  return null;
end;
$$;
revoke all on function public.tg_cap_opportunity_skills() from public, anon, authenticated;

drop trigger if exists opportunity_skills_cap on public.opportunity_skills;
create trigger opportunity_skills_cap
  after insert on public.opportunity_skills
  referencing new table as new_rows
  for each statement execute function public.tg_cap_opportunity_skills();

-- ─── F6: at most 10 pending listings per member per kind ────────────
-- SECURITY DEFINER so the count is not filtered by the caller's RLS view.
-- The advisory lock is taken in its own statement, so the count that
-- follows runs on a fresh snapshot and sees the rows a parallel
-- transaction committed while this one waited.
create or replace function public.tg_cap_pending_listings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('pending_listings:' || tg_table_name || ':' || new.posted_by::text, 0));
  execute format('select count(*) from public.%I where posted_by = $1 and status = ''pending''', tg_table_name)
    into v_pending using new.posted_by;
  if v_pending >= 10 then
    raise exception 'You already have 10 submissions waiting for review. Wait for a decision, or withdraw one, before adding another.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_cap_pending_listings() from public, anon, authenticated;

drop trigger if exists opportunities_cap_pending on public.opportunities;
create trigger opportunities_cap_pending
  before insert on public.opportunities
  for each row when (new.status = 'pending') execute function public.tg_cap_pending_listings();

drop trigger if exists events_cap_pending on public.events;
create trigger events_cap_pending
  before insert on public.events
  for each row when (new.status = 'pending') execute function public.tg_cap_pending_listings();

drop trigger if exists vcs_grants_cap_pending on public.vcs_grants;
create trigger vcs_grants_cap_pending
  before insert on public.vcs_grants
  for each row when (new.status = 'pending') execute function public.tg_cap_pending_listings();

-- ─── F7: no action row for a listing that is gone ───────────────────
create or replace function public.tg_user_listing_actions_listing_exists()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.listing_kind = 'opportunity' then
    perform 1 from public.opportunities where id = new.listing_id for share;
  elsif new.listing_kind = 'event' then
    perform 1 from public.events where id = new.listing_id for share;
  else
    perform 1 from public.vcs_grants where id = new.listing_id for share;
  end if;
  if not found then
    raise exception 'Listing not found or not approved' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_user_listing_actions_listing_exists() from public, anon, authenticated;

drop trigger if exists user_listing_actions_listing_exists on public.user_listing_actions;
create trigger user_listing_actions_listing_exists
  before insert on public.user_listing_actions
  for each row execute function public.tg_user_listing_actions_listing_exists();
