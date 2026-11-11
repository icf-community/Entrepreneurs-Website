-- ════════════════════════════════════════════════════════════════════
-- Foundry · Release preflight: will the pending migrations apply cleanly?
--
-- READ-ONLY. Paste into the Supabase SQL editor on PRODUCTION before
-- `supabase db push` of the release branch. Every row in part 1 must be 0:
-- 20261026000006 and 20261026000007 add CHECK constraints and VALIDATE
-- them in the same migration with no cleanup step, so a single existing
-- row that breaks one makes the push stop partway through.
--
-- Part 2 is not a blocker. It sizes the audience cutover (20261006000002):
-- every existing job is backfilled to eligible_audience = 'both'
-- (20261111000002), so it stays visible, and every existing member starts
-- with no education status, so sees no audience-restricted job until they
-- answer the prompt.
--
-- Uses only columns that exist BEFORE the release, so it runs on today's
-- schema.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Blockers (all must be 0) ───────────────────────────────────
select 'opportunities: blank position_name'  as check, count(*) from public.opportunities where regexp_replace(position_name, '[\s\u200B-\u200D\u2060\uFEFF]', '', 'g') = ''
union all select 'opportunities: blank company',       count(*) from public.opportunities where regexp_replace(company, '[\s\u200B-\u200D\u2060\uFEFF]', '', 'g') = ''
union all select 'opportunities: contact_email > 254', count(*) from public.opportunities where length(contact_email) > 254
union all select 'opportunities: deadline >= 2100',    count(*) from public.opportunities where application_deadline >= date '2100-01-01'
union all select 'events: blank title',                count(*) from public.events where regexp_replace(title, '[\s\u200B-\u200D\u2060\uFEFF]', '', 'g') = ''
union all select 'events: blank organiser_name',       count(*) from public.events where regexp_replace(organiser_name, '[\s\u200B-\u200D\u2060\uFEFF]', '', 'g') = ''
union all select 'events: contact_email > 254',        count(*) from public.events where length(contact_email) > 254
union all select 'events: event_at outside 1970–2100', count(*) from public.events
                                                        where not (event_at > timestamptz '1970-01-01' and event_at < timestamptz '2100-01-01')
union all select 'vcs_grants: blank name',             count(*) from public.vcs_grants where regexp_replace(name, '[\s\u200B-\u200D\u2060\uFEFF]', '', 'g') = ''
union all select 'vcs_grants: deadline >= 2100',       count(*) from public.vcs_grants where deadline >= date '2100-01-01';

-- ─── 2. Audience cutover impact (informational) ────────────────────
select 'existing jobs that will be backfilled to audience = both' as impact, count(*)
  from public.opportunities
union all
select 'approved non-admin members who will be asked their education status', count(*)
  from public.profiles p where p.status = 'approved'
   and not exists (select 1 from public.admins a where a.user_id = p.id);
