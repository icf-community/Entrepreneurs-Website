-- ════════════════════════════════════════════════════════════════════
-- Foundry · AI foundations (AI-plan §9, §10, A0.3)
--
-- 1. `ai_private`: a schema PostgREST does not expose (config.toml lists
--    public + graphql_public only). Every AI table and every executor/
--    worker function lives here, so browsers cannot reach them at all
--    (F17). Member-facing RPCs stay in `public` and read these tables as
--    SECURITY DEFINER.
-- 2. `ai_service`: the AI executor's login. NOINHERIT, NOBYPASSRLS, no
--    table grants; EXECUTE on enumerated ai_private functions only
--    (granted in later migrations, next to each function).
-- 3. Feature flags: `ai_enabled` plus one per mode, all OFF, in the
--    existing app_config pattern (connections_enabled, F20).
-- 4. AI operators: a narrower capability than admin. Only an operator can
--    switch AI on or off or change the shared limits (§10.1).
-- 5. Limits (one row) and model prices.
-- 6. The spend ledger: integer microdollars, reserved before every
--    provider call and settled after it, for matching AND ingestion, so
--    the controller-wide daily cap is enforceable (§9, F6).
--
-- Nothing here turns anything on. Flags default off; prices for real
-- models are seeded unconfirmed, and the matching executor refuses an
-- unconfirmed price (the owner confirms them, docs/owner-decisions.md).
-- ════════════════════════════════════════════════════════════════════

create schema if not exists ai_private;
revoke all on schema ai_private from public;

-- New functions in ai_private must not be executable by PUBLIC by
-- default. Each one is granted explicitly to the role that needs it.
alter default privileges in schema ai_private revoke execute on functions from public;
alter default privileges in schema ai_private revoke all on tables from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_service') then
    create role ai_service login noinherit nobypassrls nocreatedb nocreaterole noreplication;
  end if;
end $$;

-- The executor qualifies every call; this only matters for pgvector's
-- operators, which live in `extensions` on a dashboard-enabled project.
alter role ai_service set search_path = ai_private, public, extensions;

grant usage on schema ai_private to ai_service, cv_worker;


-- ─── Feature flags (F20) ────────────────────────────────────────────
insert into public.app_config (key, value) values
  ('ai_enabled', 'false'),
  ('ai_recruiter_enabled', 'false'),
  ('ai_network_enabled', 'false'),
  ('ai_opportunities_enabled', 'false')
on conflict (key) do nothing;

-- A missing row reads as off, like connections_enabled().
create or replace function public.ai_mode_enabled(p_mode text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value = 'true' from public.app_config where key = 'ai_enabled'), false)
     and coalesce((select value = 'true' from public.app_config
                     where key = case p_mode
                                   when 'recruiter'     then 'ai_recruiter_enabled'
                                   when 'network'       then 'ai_network_enabled'
                                   when 'opportunities' then 'ai_opportunities_enabled'
                                 end), false);
$$;

revoke all on function public.ai_mode_enabled(text) from public, anon, authenticated;
grant execute on function public.ai_mode_enabled(text) to authenticated;


-- ─── AI operators ───────────────────────────────────────────────────
-- Granted by SQL only, like admins (docs/owner-decisions.md). An operator
-- must also be an admin; is_ai_operator() checks both.
create table ai_private.operators (
  member_id  uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table ai_private.operators enable row level security;

create or replace function public.is_ai_operator()
returns boolean
language sql
stable
security definer
set search_path = public, ai_private
as $$
  select public.is_admin()
     and exists (select 1 from ai_private.operators o where o.member_id = (select auth.uid()));
$$;

revoke all on function public.is_ai_operator() from public, anon, authenticated;
grant execute on function public.is_ai_operator() to authenticated;


-- ─── Limits (one row, operator-controlled, §10.1) ───────────────────
-- Defaults are the Launch tunables appendix. The active-turn ceiling's
-- hard maximum is 50 until a staging capacity review raises it.
create table ai_private.settings (
  id                          smallint primary key default 1 check (id = 1),
  active_turn_ceiling         int    not null default 20  check (active_turn_ceiling between 1 and 50),
  provider_request_ceiling    int    not null default 40  check (provider_request_ceiling between 1 and 200),
  queue_capacity              int    not null default 200 check (queue_capacity between 1 and 1000),
  max_queue_wait_seconds      int    not null default 120 check (max_queue_wait_seconds between 10 and 600),
  turn_deadline_seconds       int    not null default 45  check (turn_deadline_seconds between 10 and 120),
  attempt_timeout_seconds     int    not null default 20  check (attempt_timeout_seconds between 5 and 60),
  matching_daily_cap_micro    bigint not null default 5000000   check (matching_daily_cap_micro >= 0),
  matching_monthly_cap_micro  bigint not null default 150000000 check (matching_monthly_cap_micro >= 0),
  ingestion_daily_cap_micro   bigint not null default 5000000   check (ingestion_daily_cap_micro >= 0),
  controller_daily_cap_micro  bigint not null default 20000000  check (controller_daily_cap_micro >= 0),
  member_daily_cap_micro      bigint not null default 500000    check (member_daily_cap_micro >= 0),
  previous                    jsonb,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.profiles(id) on delete set null,
  reason                      text check (reason is null or length(reason) <= 300)
);
insert into ai_private.settings (id) values (1) on conflict do nothing;
alter table ai_private.settings enable row level security;


-- ─── Model prices ───────────────────────────────────────────────────
-- Microdollars per million tokens. `confirmed` is the owner's check
-- against the provider's pricing page; the matching executor refuses an
-- unconfirmed model. The seeded real prices are deliberately pessimistic
-- placeholders. `fake-*` rows exist for the local fake provider, which
-- refuses to run against anything but a local database.
create table ai_private.model_prices (
  model                  text primary key check (length(model) <= 80),
  input_micro_per_mtok   bigint not null check (input_micro_per_mtok >= 0),
  output_micro_per_mtok  bigint not null check (output_micro_per_mtok >= 0),
  price_version          int    not null default 1,
  confirmed              boolean not null default false,
  updated_at             timestamptz not null default now()
);
alter table ai_private.model_prices enable row level security;

insert into ai_private.model_prices (model, input_micro_per_mtok, output_micro_per_mtok, confirmed) values
  ('gpt-5.4-mini',            750000,   4500000, false),
  ('gpt-5.4',                 2500000,  15000000, false),
  ('text-embedding-3-small',  20000,    0,       false),
  ('omni-moderation-latest',  0,        0,       true),
  ('fake-mini',               1000000,  4000000, true),
  ('fake-large',              2000000,  8000000, true),
  ('fake-embedding',          20000,    0,       true)
on conflict (model) do nothing;


-- ─── Spend ledger (§9) ──────────────────────────────────────────────
create table ai_private.spend (
  id                 uuid primary key default gen_random_uuid(),
  day                date not null default ((now() at time zone 'utc')::date),
  created_at         timestamptz not null default now(),
  purpose            text not null check (purpose in ('matching', 'ingestion')),
  mode               text check (mode in ('recruiter', 'network', 'opportunities')),
  member_id          uuid references public.profiles(id) on delete set null,
  turn_id            uuid,
  job_id             uuid,
  stage              text not null check (length(stage) between 1 and 40),
  model              text not null references ai_private.model_prices(model),
  price_version      int  not null,
  max_input_tokens   int  not null check (max_input_tokens between 1 and 400000),
  max_output_tokens  int  not null check (max_output_tokens between 0 and 32000),
  reserved_micro     bigint not null check (reserved_micro >= 0),
  settled_micro      bigint check (settled_micro is null or settled_micro >= 0),
  input_tokens       int,
  output_tokens      int,
  status             text not null default 'reserved'
                     check (status in ('reserved', 'settled', 'released', 'unknown')),
  settled_at         timestamptz
);
create index spend_day_purpose_idx on ai_private.spend (day, purpose);
create index spend_member_day_idx  on ai_private.spend (member_id, day) where member_id is not null;
create index spend_open_idx        on ai_private.spend (created_at) where status in ('reserved', 'unknown');
alter table ai_private.spend enable row level security;

-- What a row counts against the caps. A reservation counts at its upper
-- bound until settled; an unknown attempt (crash, timeout after the
-- provider may have billed) counts at its upper bound for good.
create or replace function ai_private.spend_charged(s ai_private.spend)
returns bigint
language sql
immutable
as $$
  select case s.status
           when 'settled'  then coalesce(s.settled_micro, s.reserved_micro)
           when 'released' then 0
           else s.reserved_micro
         end;
$$;

create or replace function ai_private.spend_reserve(
  p_purpose    text,
  p_mode       text,
  p_member     uuid,
  p_turn       uuid,
  p_job        uuid,
  p_stage      text,
  p_model      text,
  p_max_in     int,
  p_max_out    int
)
returns uuid
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_price   ai_private.model_prices;
  v_cfg     ai_private.settings;
  v_bound   bigint;
  v_day     date := (now() at time zone 'utc')::date;
  v_purpose bigint;
  v_total   bigint;
  v_month   bigint;
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
    select coalesce(sum(ai_private.spend_charged(s)), 0) into v_month
      from ai_private.spend s
     where s.purpose = 'matching' and s.day >= date_trunc('month', v_day)::date;
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
$$;

-- Idempotent: settling twice changes nothing, and a later attempt's row
-- is never touched (each attempt has its own reservation id).
create or replace function ai_private.spend_settle(p_id uuid, p_input_tokens int, p_output_tokens int)
returns bigint
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_row   ai_private.spend;
  v_price ai_private.model_prices;
  v_cost  bigint;
begin
  select * into v_row from ai_private.spend where id = p_id for update;
  if not found then
    raise exception 'unknown_reservation' using errcode = 'P0001';
  end if;
  if v_row.status in ('settled', 'released') then
    return ai_private.spend_charged(v_row);
  end if;

  select * into v_price from ai_private.model_prices where model = v_row.model;
  v_cost := ceil((greatest(coalesce(p_input_tokens, 0), 0)::numeric * v_price.input_micro_per_mtok
                 + greatest(coalesce(p_output_tokens, 0), 0)::numeric * v_price.output_micro_per_mtok) / 1000000);

  update ai_private.spend
     set status = 'settled', settled_micro = v_cost, input_tokens = p_input_tokens,
         output_tokens = p_output_tokens, settled_at = now()
   where id = p_id;
  return v_cost;
end;
$$;

-- Only for work that demonstrably never reached the provider. Anything
-- dispatched goes to spend_mark_unknown instead and keeps its reservation.
create or replace function ai_private.spend_release(p_id uuid)
returns void
language sql
security definer
set search_path = ai_private, public
as $$
  update ai_private.spend set status = 'released', settled_micro = 0, settled_at = now()
   where id = p_id and status = 'reserved';
$$;

create or replace function ai_private.spend_mark_unknown(p_id uuid)
returns void
language sql
security definer
set search_path = ai_private, public
as $$
  update ai_private.spend set status = 'unknown' where id = p_id and status = 'reserved';
$$;


-- ─── Ingestion metering for the CV worker (F6) ──────────────────────
-- The worker reserves before each OpenAI call and settles after it, so
-- ingestion counts against its own daily cap and the controller total.
create or replace function ai_private.worker_reserve(
  p_job uuid, p_member uuid, p_stage text, p_model text, p_max_in int, p_max_out int
)
returns uuid
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return ai_private.spend_reserve('ingestion', null, p_member, null, p_job, p_stage, p_model, p_max_in, p_max_out);
end;
$$;

create or replace function ai_private.worker_settle(p_id uuid, p_input_tokens int, p_output_tokens int)
returns bigint
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return ai_private.spend_settle(p_id, p_input_tokens, p_output_tokens);
end;
$$;

create or replace function ai_private.worker_abandon(p_id uuid, p_dispatched boolean)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_dispatched then
    perform ai_private.spend_mark_unknown(p_id);
  else
    perform ai_private.spend_release(p_id);
  end if;
end;
$$;

revoke all on function ai_private.spend_charged(ai_private.spend) from public;
revoke all on function ai_private.spend_reserve(text, text, uuid, uuid, uuid, text, text, int, int) from public;
revoke all on function ai_private.spend_settle(uuid, int, int) from public;
revoke all on function ai_private.spend_release(uuid) from public;
revoke all on function ai_private.spend_mark_unknown(uuid) from public;
revoke all on function ai_private.worker_reserve(uuid, uuid, text, text, int, int) from public;
revoke all on function ai_private.worker_settle(uuid, int, int) from public;
revoke all on function ai_private.worker_abandon(uuid, boolean) from public;
grant execute on function ai_private.worker_reserve(uuid, uuid, text, text, int, int) to cv_worker;
grant execute on function ai_private.worker_settle(uuid, int, int) to cv_worker;
grant execute on function ai_private.worker_abandon(uuid, boolean) to cv_worker;


-- ─── Direct identifiers for the outbound privacy boundary (§3) ───────
-- The worker removes the member's own names, email and handles from CV
-- and GitHub text before any provider call. It has no access to
-- profiles or auth.users (F25), so it gets exactly these fields here.
create or replace function ai_private.worker_member_identifiers(p_member uuid)
returns table (first_name text, surname text, preferred_name text, email text,
               linkedin_url text, github_url text, portfolio_url text, github_username text)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
    select p.first_name, p.surname, p.preferred_name, u.email::text,
           p.linkedin_url, p.github_url, p.portfolio_url, g.github_username
      from public.profiles p
      left join auth.users u on u.id = p.id
      left join public.github_connections g on g.member_id = p.id
     where p.id = p_member;
end;
$$;

revoke all on function ai_private.worker_member_identifiers(uuid) from public;
grant execute on function ai_private.worker_member_identifiers(uuid) to cv_worker;


-- ─── Version-aware dedupe (§3): which outbound policy built a profile ─
-- A CV whose text hash matches an earlier upload is reused only when the
-- earlier profile was built under the current extractor AND privacy
-- policy; older rows are reprocessed instead of reactivated.
alter table public.cv_profiles add column if not exists policy_version text;
grant select (policy_version), insert (policy_version) on public.cv_profiles to cv_worker;


-- ─── Tables are not for the API roles ────────────────────────────────
revoke all on all tables in schema ai_private from public, anon, authenticated;
