-- ════════════════════════════════════════════════════════════════════
-- A per-member daily cap on INGESTION spend (CV extraction, GitHub scans, AI refreshes).
--
-- Until now ingestion was capped only as a whole: ingestion_daily_cap_micro ($5/day, one pot
-- for every member) and the controller cap. spend_reserve computed the per-member total for
-- matching only, so one account could use a large share of the shared pot, and enough
-- accounts could exhaust it for everyone (every member's CV then waits for the next UTC day).
--
-- This adds settings.ingestion_member_daily_cap_micro (default 250000 = $0.25) and refuses an
-- ingestion reservation that would take one member past it, with
-- 'budget_exhausted: ingestion_member_daily'. The worker already turns any budget_exhausted
-- into "deferred to tomorrow" (worker._defer_job_until_tomorrow: the job waits for the next
-- UTC day without using a retry, and the CV shows "Processing is paused for today"), so no
-- Python changes.
--
-- What the number is, honestly: a BACKSTOP, not the main control. The rate limit on CV uploads
-- (5 per member per 24h, frontend/src/lib/ratelimit.ts) is what bounds the common case.
-- Sizing: a CV extraction reserves up to about 5c (8,000 output tokens at $4.50/M plus up to
-- ~1.5c of input at the 60k-character cap) and settles at about 1c for a typical CV; open or
-- post-dispatch-failed ('unknown') rows count at their reservation. Five typical CVs plus a few
-- GitHub scans plus one provider hiccup is about 20c, so $0.25 leaves roughly 2x headroom for a
-- heavy legitimate day while still stopping a member who is somehow generating abnormal cost.
-- A hard CHECK ceiling ($1) sits above it, in the style of 20261026000010.
--
-- Behaviour to know about: if the provider keeps failing AFTER dispatch for one member, each
-- attempt leaves an 'unknown' row at its reservation, so the cap can be reached before the job's
-- 5th attempt; that attempt is then deferred to tomorrow instead of being dead-lettered. A job
-- that trips the cap between its paid extraction and its embeddings repeats the extraction
-- tomorrow. Both match what the global ingestion cap already does.
--
-- Matching is untouched: v_member for matching, member_daily_cap_micro and every other check
-- stay as they were. A reservation with no member (e.g. refresh_job_ai) skips the new check.
--
-- Not changed on purpose: admin_set_ai_limits (signature (int, bigint, bigint, text); a new
-- signature would leave a dead overload). The new cap is changed by a migration or SQL, like
-- the ceilings. The admin overview already returns to_jsonb(settings), so it shows the value.
--
-- Body of spend_reserve is the LIVE definition (20261026000016) with two additions: the
-- v_member_ing aggregate and the new check. Signature, security definer, search_path and
-- grants are unchanged (CREATE OR REPLACE keeps them).
--
-- Prod pre-check: none. A new column with a default; no existing rows are read or changed.
-- Rollback: re-apply spend_reserve from 20261026000016, then
--   alter table ai_private.settings drop constraint settings_ingestion_member_cap_max,
--                                   drop column ingestion_member_daily_cap_micro;
-- ════════════════════════════════════════════════════════════════════

alter table ai_private.settings
  add column if not exists ingestion_member_daily_cap_micro bigint not null default 250000
    check (ingestion_member_daily_cap_micro >= 0);

alter table ai_private.settings
  add constraint settings_ingestion_member_cap_max check (ingestion_member_daily_cap_micro <= 1000000) not valid;
alter table ai_private.settings validate constraint settings_ingestion_member_cap_max;

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
  v_member_ing bigint;
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
         coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching' and s.member_id = p_member), 0),
         coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'ingestion' and s.member_id = p_member), 0)
    into v_purpose, v_total, v_member, v_member_ing
    from ai_private.spend s
   where s.day = v_day;

  if v_total + v_bound > v_cfg.controller_daily_cap_micro then
    raise exception 'budget_exhausted: controller_daily' using errcode = 'P0001';
  end if;
  if p_purpose = 'ingestion' and v_purpose + v_bound > v_cfg.ingestion_daily_cap_micro then
    raise exception 'budget_exhausted: ingestion_daily' using errcode = 'P0001';
  end if;
  if p_purpose = 'ingestion' and p_member is not null
     and v_member_ing + v_bound > v_cfg.ingestion_member_daily_cap_micro then
    raise exception 'budget_exhausted: ingestion_member_daily' using errcode = 'P0001';
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
