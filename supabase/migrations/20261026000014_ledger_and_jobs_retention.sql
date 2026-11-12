-- ════════════════════════════════════════════════════════════════════
-- Retention for the two tables that grew without bound.
--
-- The data-layer growth review (tasks/e2e-adversarial-sweep.md, "Scalability:
-- data layer") listed every table that accumulates rows over time against the
-- tables something deletes from. Everything is purged or bounded by the member
-- count except two:
--
--   ai_private.spend   one row per provider call (a turn is 1 to ~8 calls, plus
--                      one per embedded chunk). The money caps bound DOLLARS, and
--                      an embedding costs a millionth of a dollar, so they do not
--                      bound ROWS: the per-member turn limits do, at up to
--                      40 turns/member/day. Worst case at 2,000 members that is
--                      hundreds of thousands of rows a day and tens of millions a
--                      year, in a table three of whose indexes the cap checks use.
--   public.jobs        one row per CV ingest, GitHub scan and AI refresh, kept
--                      forever once 'done' or 'dead'.
--
-- 1. ai_private.spend_daily + ai_private.cron_rollup_spend()
--    Rows older than 45 days (the monthly cap reads the current calendar month,
--    at most 31 days back; every reader of spend looks at today or this month) are
--    summed into one row per (day, purpose, mode, stage, model) and deleted. No
--    member id is kept: per-member history older than 45 days is not needed for
--    any cap, and not keeping it is the better answer for a deleted account.
--    Only settled / released / unknown rows move; open reservations are the
--    reaper's. Totals are preserved exactly (charged_micro applies the same rule as
--    ai_private.spend_charged(), which the caps and the dashboard use).
-- 2. public.purge_finished_jobs()
--    'done' jobs after 30 days, 'dead' jobs after 90 (kept longer for diagnosis).
--
-- Both run nightly under pg_cron. Both are SECURITY DEFINER with a pinned
-- search_path and no grant to any API role.
--
-- Prod pre-check: none, no existing rows are touched until they pass the age.
-- Rollback: select cron.unschedule('ai-spend-rollup'), cron.unschedule('purge-finished-jobs-daily');
--           drop function ai_private.cron_rollup_spend(), public.purge_finished_jobs();
--           (spend_daily can stay; it holds only totals already removed from spend.)
-- ════════════════════════════════════════════════════════════════════

create table if not exists ai_private.spend_daily (
  day            date    not null,
  purpose        text    not null check (purpose in ('matching', 'ingestion')),
  mode           text             check (mode in ('recruiter', 'network', 'opportunities')),
  stage          text    not null,
  model          text    not null,
  calls          integer not null check (calls >= 0),
  charged_micro  bigint  not null check (charged_micro >= 0),
  input_tokens   bigint  not null default 0,
  output_tokens  bigint  not null default 0,
  rolled_at      timestamptz not null default now()
);
create unique index if not exists spend_daily_key
  on ai_private.spend_daily (day, purpose, (coalesce(mode, '')), stage, model);
alter table ai_private.spend_daily enable row level security;
revoke all on ai_private.spend_daily from public, anon, authenticated;

create or replace function ai_private.cron_rollup_spend()
returns integer
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_cutoff date := (now() at time zone 'utc')::date - 45;
  v_moved  integer;
begin
  with moved as (
    delete from ai_private.spend s
     where s.day < v_cutoff and s.status in ('settled', 'released', 'unknown')
    returning s.*
  ), summed as (
    select m.day, m.purpose, m.mode, m.stage, m.model,
           count(*)::integer                           as calls,
           -- Same rule as ai_private.spend_charged(): settled -> settled_micro, released -> 0,
           -- otherwise (unknown) the reservation. Inlined because a CTE row is not an ai_private.spend.
           coalesce(sum(case m.status when 'settled'  then coalesce(m.settled_micro, m.reserved_micro)
                                      when 'released' then 0
                                      else m.reserved_micro end), 0)::bigint as charged_micro,
           coalesce(sum(m.input_tokens), 0)::bigint    as input_tokens,
           coalesce(sum(m.output_tokens), 0)::bigint   as output_tokens
      from moved m
     group by m.day, m.purpose, m.mode, m.stage, m.model
  ), upserted as (
    insert into ai_private.spend_daily (day, purpose, mode, stage, model, calls, charged_micro, input_tokens, output_tokens)
    select day, purpose, mode, stage, model, calls, charged_micro, input_tokens, output_tokens from summed
    on conflict (day, purpose, (coalesce(mode, '')), stage, model) do update
      set calls         = ai_private.spend_daily.calls + excluded.calls,
          charged_micro = ai_private.spend_daily.charged_micro + excluded.charged_micro,
          input_tokens  = ai_private.spend_daily.input_tokens + excluded.input_tokens,
          output_tokens = ai_private.spend_daily.output_tokens + excluded.output_tokens,
          rolled_at     = now()
    returning 1
  )
  select coalesce(sum(calls), 0)::integer into v_moved from summed;
  return v_moved;
end;
$$;
revoke all on function ai_private.cron_rollup_spend() from public;

create or replace function public.purge_finished_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  delete from public.jobs
   where (status = 'done' and updated_at < now() - interval '30 days')
      or (status = 'dead' and updated_at < now() - interval '90 days');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_finished_jobs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('ai-spend-rollup', 'purge-finished-jobs-daily');
    perform cron.schedule('ai-spend-rollup', '23 3 * * *', 'select ai_private.cron_rollup_spend()');
    perform cron.schedule('purge-finished-jobs-daily', '20 2 * * *', 'select public.purge_finished_jobs()');
  end if;
end $$;
