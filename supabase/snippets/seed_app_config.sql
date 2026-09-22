-- ════════════════════════════════════════════════════════════════════
-- Foundry · Seed public.app_config for a deployed environment
--
-- Run this ONCE per environment, in the Supabase SQL editor, after
-- `supabase db push`. Re-running it is safe — every statement upserts.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHY THIS FILE EXISTS
-- ──────────────────────────────────────────────────────────────────────
-- Three pg_cron jobs reach back into the Next.js app over HTTP, and each
-- one reads its target URL and the shared bearer secret out of
-- `app_config` at call time:
--
--   cron_drain_outbound_email      → drain_email_url            + cron_secret
--   cron_drain_blob_deletions      → drain_blob_deletions_url   + cron_secret
--   cron_github_showcase_nudge     → github_showcase_nudge_url  + cron_secret
--   cron_connection_digest         → connections_digest_url     + cron_secret
--
-- Every one of them handles a missing key the same way:
--
--     raise warning '... not configured in app_config';
--     return;
--
-- That is the right choice for `supabase db reset` (the migration has to
-- apply to a database with no deployment behind it) and a trap for a real
-- deployment. `raise warning` is not an error: the cron job SUCCEEDS, the
-- schedule keeps ticking, nothing lands in Sentry, and the only trace is a
-- line in the Postgres log nobody reads. The feature is simply off, and
-- looks healthy.
--
-- This bit during the pre-launch audit on 2026-09-08:
-- `github_showcase_nudge_url` is a NEW key introduced by
-- 20260907000004_github_showcase.sql. Pushing that migration to an
-- environment without also adding the row leaves the weekly nudge cron
-- running forever and mailing nobody — with the member-facing symptom
-- being "we never told anyone they had new repos worth spotlighting",
-- which nobody would think to report as a bug.
--
-- `connections_digest_url` (20260917000004) is the same shape of new key
-- and has a worse symptom: connection requests pile up unanswered
-- because nobody is ever told they have any, and the senders conclude
-- the community ignores them. Add the row when that migration is pushed.
--
-- ──────────────────────────────────────────────────────────────────────
-- HOW TO USE
-- ──────────────────────────────────────────────────────────────────────
-- Replace the two \set values below, then run the whole file.
--
--   app_url     — the site's public origin, NO trailing slash. Must be the
--                 apex-or-www host that actually serves the app: the apex
--                 307-redirects to www ([[csp]]), and net.http_post does
--                 NOT follow redirects, so getting this wrong makes every
--                 cron call a silent 307 that does nothing.
--   cron_secret — must equal the CRON_SECRET env var set in Vercel. The
--                 routes compare it with a constant-time check and return
--                 401 on a mismatch; a mismatch therefore looks exactly
--                 like a missing key from the database side.
--
-- Verify with the SELECT at the bottom, which reports what is missing
-- rather than what is present.
-- ════════════════════════════════════════════════════════════════════

\set app_url     'https://www.imperialentrepreneurs.com'
\set cron_secret 'REPLACE_WITH_THE_VERCEL_CRON_SECRET'

insert into public.app_config (key, value) values
  ('cron_secret',               :'cron_secret'),
  ('drain_email_url',           :'app_url' || '/api/cron/drain-email'),
  ('drain_blob_deletions_url',  :'app_url' || '/api/cron/drain-blob-deletions'),
  ('github_showcase_nudge_url', :'app_url' || '/api/cron/github-showcase-nudge'),
  ('connections_digest_url',    :'app_url' || '/api/cron/connections-digest')
on conflict (key) do update set value = excluded.value;

-- Feature flags, seeded separately because they are product decisions
-- rather than deployment plumbing, and because unlike the rows above they
-- have sensible defaults that must not be clobbered on a re-run. The
-- migrations seed these too; the entries here exist so a database that
-- somehow lost a row gets it back rather than failing closed forever.
insert into public.app_config (key, value) values ('community_posts_enabled', 'true')
on conflict (key) do nothing;
insert into public.app_config (key, value) values ('connections_enabled', 'true')
on conflict (key) do nothing;

-- ─── Verification ────────────────────────────────────────────────────
-- Lists every key the cron functions look up and whether it is present.
-- Anything reading MISSING is a cron job that will run and silently
-- do nothing.
select
  k.key,
  case when c.key is null then '*** MISSING ***' else 'present' end as state,
  case
    when c.key is null                     then null
    when k.key like '%secret%'             then '(hidden)'
    else c.value
  end as value
from (values
  ('cron_secret'),
  ('drain_email_url'),
  ('drain_blob_deletions_url'),
  ('github_showcase_nudge_url'),
  ('connections_digest_url'),
  ('community_posts_enabled'),
  ('connections_enabled'),
  ('connection_limits'),
  ('connection_consent_version')
) as k(key)
left join public.app_config c on c.key = k.key
order by state, k.key;
