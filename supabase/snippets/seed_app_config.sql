-- ════════════════════════════════════════════════════════════════════
-- Foundry · Seed public.app_config for a deployed environment
--
-- Run this ONCE per environment, in the Supabase SQL editor, after
-- `supabase db push`. Re-running it is safe — every statement upserts.
--
-- ──────────────────────────────────────────────────────────────────────
-- WHY THIS FILE EXISTS
-- ──────────────────────────────────────────────────────────────────────
-- Four pg_cron jobs reach back into the Next.js app over HTTP, and each
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
-- Replace the two values marked EDIT THESE TWO below, then run the
-- whole file. Plain SQL on purpose: the Supabase web SQL Editor does not
-- understand psql's `\set` / `:'var'`, which this file used to rely on.
-- The insert refuses to run while the secret is still the placeholder.
--
-- CAREFUL: this OVERWRITES cron_secret, which every cron above shares. A
-- value that differs from Vercel's CRON_SECRET silently stops ALL of them,
-- including the email drain. If the environment is already seeded and you
-- only need a missing URL row, add just that row instead, e.g.:
--
--   insert into public.app_config (key, value)
--   select 'connections_digest_url',
--          replace(value, '/api/cron/drain-email', '/api/cron/connections-digest')
--     from public.app_config where key = 'drain_email_url'
--   on conflict (key) do nothing;
--
--   app_url     — the site's public origin, NO trailing slash. Must be the
--                 apex-or-www host that actually serves the app: the apex
--                 307-redirects to www ([[csp]]), and net.http_post does
--                 NOT follow redirects, so getting this wrong makes every
--                 cron call a silent 307 that does nothing.
--   cron_secret — must equal the CRON_SECRET env var set in Vercel. The
--                 routes compare it with a constant-time check and return
--                 403 on a mismatch; a mismatch therefore looks exactly
--                 like a missing key from the database side.
--
-- Verify with the SELECT at the bottom, which reports what is missing
-- rather than what is present.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  -- ▼▼ EDIT THESE TWO ▼▼
  v_app_url     text := 'https://www.imperialentrepreneurs.com';
  v_cron_secret text := 'REPLACE_WITH_THE_VERCEL_CRON_SECRET';
  -- ▲▲ ─────────────── ▲▲
begin
  if v_cron_secret = 'REPLACE_WITH_THE_VERCEL_CRON_SECRET' or btrim(v_cron_secret) = '' then
    raise exception 'Set v_cron_secret to the Vercel CRON_SECRET first — nothing was written';
  end if;
  if v_app_url !~ '^https://[^/]+$' then
    raise exception 'v_app_url must be https://host with no path and no trailing slash (got %)', v_app_url;
  end if;

  insert into public.app_config (key, value) values
    ('cron_secret',               v_cron_secret),
    ('drain_email_url',           v_app_url || '/api/cron/drain-email'),
    ('drain_blob_deletions_url',  v_app_url || '/api/cron/drain-blob-deletions'),
    ('github_showcase_nudge_url', v_app_url || '/api/cron/github-showcase-nudge'),
    ('connections_digest_url',    v_app_url || '/api/cron/connections-digest')
  on conflict (key) do update set value = excluded.value;
end $$;

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
