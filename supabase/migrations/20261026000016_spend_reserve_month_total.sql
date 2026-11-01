-- ════════════════════════════════════════════════════════════════════
-- spend_reserve: make the monthly-cap check O(1) instead of a scan of the month.
--
-- Every provider call reserves spend first (ai_private.spend_reserve), one at a
-- time behind a global advisory lock. For matching calls it summed EVERY matching
-- row of the calendar month to enforce the monthly cap. Measured with a month-end
-- ledger at launch scale (600k matching rows, about 20k a day for a month): 205 ms
-- per reservation, inside the lock, growing linearly all month. That caps the whole
-- system at about 5 reservations a second (a turn makes 3 to 14), and the slowest
-- day is the last of the month, which a start-of-month load test never sees.
--
-- Fix: ai_private.spend_closed_days holds one total per (day, purpose) for days
-- before today. The reservation fills any missing day once (a day that still has an
-- open reservation is left out and summed live, so nothing settled late is missed),
-- then month-to-date = cached closed days + any open days + today's live sum, which
-- the function already computes. Cost per reservation: at most one day's rows once a
-- day, plus a read of at most 31 small rows.
--
-- The cap arithmetic is unchanged (test_matching_monthly_cap_boundary pins it at the
-- N-1 / N boundary with this month's earlier spend in the ledger).
--
-- cron_rollup_spend also deletes closed-day rows past the 45-day window.
--
-- Body is the LIVE definition (the result of every earlier migration) with the
-- month block replaced. Signature, security definer, search_path and grants are
-- unchanged (CREATE OR REPLACE keeps them).
--
-- Prod pre-check: none, no data is touched; the cache fills itself.
-- Rollback: re-apply spend_reserve from 20261011000003 (or the latest earlier
--           definition) and drop table ai_private.spend_closed_days.
-- ════════════════════════════════════════════════════════════════════

create table if not exists ai_private.spend_closed_days (
  day            date   not null,
  purpose        text   not null check (purpose in ('matching', 'ingestion')),
  charged_micro  bigint not null check (charged_micro >= 0),
  closed_at      timestamptz not null default now(),
  primary key (purpose, day)
);
alter table ai_private.spend_closed_days enable row level security;
revoke all on ai_private.spend_closed_days from public, anon, authenticated;

CREATE OR REPLACE FUNCTION ai_private.spend_reserve(p_purpose text, p_mode text, p_member uuid, p_turn uuid, p_job uuid, p_stage text, p_model text, p_max_in integer, p_max_out integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ai_private', 'public'
AS $function$
declare
  v_price   ai_private.model_prices;
  v_cfg     ai_private.settings;
  v_bound   bigint;
  v_day     date := (now() at time zone 'utc')::date;
  v_purpose bigint;
  v_total   bigint;
  v_month   bigint;
  v_closed  bigint;
  v_open    bigint := 0;
  v_m_start date := date_trunc('month', v_day)::date;
  d         date;
  d_sum     bigint;
  d_open    boolean;
  v_member  bigint;
  v_id      uuid;
begin
  -- One reservation at a time across every replica: two concurrent checks
  -- must not both see the same headroom. Held only for this transaction.
  perform pg_advisory_xact_lock(hashtext('ai_private.spend'));

  select * into v_price from ai_private.model_prices where model = p_model;
  if not found then
    raise exception 'unknown_model: %', p_model using errcode = 'P0001';
  end if;
  if p_purpose = 'matching' and not v_price.confirmed then
    raise exception 'unconfirmed_price: %', p_model using errcode = 'P0001';
  end if;
  if p_max_in is null or p_max_in < 1 or p_max_out is null or p_max_out < 0 then
    raise exception 'invalid_bounds' using errcode = 'P0001';
  end if;

  -- Round up: a microdollar short is a cap overrun.
  v_bound := ceil((p_max_in::numeric * v_price.input_micro_per_mtok
                  + p_max_out::numeric * v_price.output_micro_per_mtok) / 1000000);

  select * into v_cfg from ai_private.settings where id = 1;

  select coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = p_purpose), 0),
         coalesce(sum(ai_private.spend_charged(s)), 0),
         coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching' and s.member_id = p_member), 0)
    into v_purpose, v_total, v_member
    from ai_private.spend s
   where s.day = v_day;

  if v_total + v_bound > v_cfg.controller_daily_cap_micro then
    raise exception 'budget_exhausted: controller_daily' using errcode = 'P0001';
  end if;
  if p_purpose = 'ingestion' and v_purpose + v_bound > v_cfg.ingestion_daily_cap_micro then
    raise exception 'budget_exhausted: ingestion_daily' using errcode = 'P0001';
  end if;
  if p_purpose = 'matching' then
    if v_purpose + v_bound > v_cfg.matching_daily_cap_micro then
      raise exception 'budget_exhausted: matching_daily' using errcode = 'P0001';
    end if;
    if p_member is not null and v_member + v_bound > v_cfg.member_daily_cap_micro then
      raise exception 'budget_exhausted: member_daily' using errcode = 'P0001';
    end if;
    -- Month to date WITHOUT scanning the month. Every day before today is summed once into
    -- spend_closed_days (we hold the ledger lock, so there is no race on the insert) and read back
    -- from there; only today's rows (v_purpose, summed above) are live. A day that still has an
    -- open reservation is not cached yet and is summed live, so a late settle is never missed.
    -- The scan this replaced took ~200 ms per reservation at 600k rows (a month at launch scale),
    -- inside the lock, and grew all month.
    for d in select g::date from generate_series(v_m_start::timestamp, (v_day - 1)::timestamp, interval '1 day') g
              where not exists (select 1 from ai_private.spend_closed_days c where c.purpose = 'matching' and c.day = g::date)
    loop
      select coalesce(sum(ai_private.spend_charged(s)), 0), coalesce(bool_or(s.status = 'reserved'), false)
        into d_sum, d_open
        from ai_private.spend s
       where s.purpose = 'matching' and s.day = d;
      if d_open then
        v_open := v_open + d_sum;
      else
        insert into ai_private.spend_closed_days (day, purpose, charged_micro) values (d, 'matching', d_sum)
          on conflict do nothing;
      end if;
    end loop;
    select coalesce(sum(c.charged_micro), 0) into v_closed
      from ai_private.spend_closed_days c
     where c.purpose = 'matching' and c.day >= v_m_start and c.day < v_day;
    v_month := v_closed + v_open + v_purpose;
    if v_month + v_bound > v_cfg.matching_monthly_cap_micro then
      raise exception 'budget_exhausted: matching_monthly' using errcode = 'P0001';
    end if;
  end if;

  insert into ai_private.spend (purpose, mode, member_id, turn_id, job_id, stage, model, price_version,
                                max_input_tokens, max_output_tokens, reserved_micro)
  values (p_purpose, p_mode, p_member, p_turn, p_job, p_stage, p_model, v_price.price_version,
          p_max_in, p_max_out, v_bound)
  returning id into v_id;
  return v_id;
end;
$function$;


-- The rollup also drops closed-day rows outside the 45-day window (the month check never reads
-- more than 31 days back). Body is 20261026000014's with that one statement added.
create or replace function ai_private.cron_rollup_spend()
returns integer
language plpgsql
security definer
set search_path = ai_private, public
as $fn$
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
  delete from ai_private.spend_closed_days where day < v_cutoff;
  return v_moved;
end;
$fn$;
revoke all on function ai_private.cron_rollup_spend() from public;
