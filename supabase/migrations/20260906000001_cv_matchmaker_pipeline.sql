-- ════════════════════════════════════════════════════════════════════
-- Foundry · CV matchmaker — Phase 1 ingest pipeline schema
--
-- cv-matchmaker-spec.md's Data model, for real this time. This extends
-- the existing CV upload path (confirm_cv_upload, 20260901000003 /
-- 20260901000012) rather than replacing it: profiles.cv_path and the
-- old prefillCvSkillsInBackground flow are untouched. confirm_cv_upload
-- gets one small addition at the end of this file — it now also opens a
-- row here and enqueues a job for the new ingest worker to pick up.
--
-- Naming note: the spec calls the ESCO-taxonomy table `skills`, but
-- public.skills already exists (20260527000001) as the plain lookup
-- table behind profile_skills/opportunity_skills — smallserial ids, no
-- embeddings, a completely different mechanism (member-picked tags, not
-- CV-extracted-and-embedded matches). Renamed to `cv_skills` here so the
-- two never collide.
--
-- RLS: deny-all on every table below, same shape as upload_tickets
-- (20260829000001) — no policies at all, reached only through the
-- SECURITY DEFINER RPCs at the bottom. The ingest worker itself never
-- goes through PostgREST/RLS; it holds a direct Postgres connection
-- (server/app/db.py) and does its own reads/writes in plain SQL.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists vector;

-- ─── cvs ───────────────────────────────────────────────────────────
create type public.cv_status as enum (
  'pending', 'extracting', 'embedding', 'ready', 'failed', 'flagged'
);

create table public.cvs (
  id                  uuid        primary key default gen_random_uuid(),
  member_id           uuid        not null references public.profiles(id) on delete cascade,
  blob_key            text        not null,
  original_filename   text,
  mime_type           text,
  raw_text            text,
  raw_text_hash       text,
  status              public.cv_status not null default 'pending',
  failure_reason      text,
  -- Exactly one true per member, enforced by update_cv_currency below
  -- (never by a constraint — a partial unique index on (member_id) where
  -- is_current would fight the cascade's own multi-row UPDATE mid-flight).
  is_current          boolean     not null default false,
  created_at          timestamptz not null default now()
);

create index cvs_member_idx        on public.cvs (member_id);
create index cvs_member_hash_idx   on public.cvs (member_id, raw_text_hash) where raw_text_hash is not null;
create index cvs_member_current_idx on public.cvs (member_id) where is_current;

alter table public.cvs enable row level security;

-- ─── cv_profiles ───────────────────────────────────────────────────
create table public.cv_profiles (
  id             uuid        primary key default gen_random_uuid(),
  cv_id          uuid        not null unique references public.cvs(id) on delete cascade,
  -- Denormalised from cvs.is_current, kept in lockstep by
  -- update_cv_currency — see cv-matchmaker-spec.md's "CV replacement"
  -- section (added here per the spec's own audit fix; the first draft
  -- of this table omitted it).
  is_current     boolean     not null default false,
  profile        jsonb       not null,
  summary        text        not null,
  model_name     text        not null,
  prompt_version text        not null,
  created_at     timestamptz not null default now()
);

create index cv_profiles_current_idx on public.cv_profiles (cv_id) where is_current;

alter table public.cv_profiles enable row level security;

-- ─── cv_chunks ─────────────────────────────────────────────────────
create type public.cv_chunk_type as enum ('role', 'project', 'education', 'skills', 'summary');

create table public.cv_chunks (
  id              uuid        primary key default gen_random_uuid(),
  cv_id           uuid        not null references public.cvs(id) on delete cascade,
  -- Denormalised for filter performance on the (future) query path —
  -- see the spec's illustrative retrieval query.
  member_id       uuid        not null references public.profiles(id) on delete cascade,
  is_current      boolean     not null default false,
  chunk_type      public.cv_chunk_type not null,
  content         text        not null,
  embedding       vector(1536) not null,
  embedding_model text        not null,
  content_tsv     tsvector    generated always as (to_tsvector('english', content)) stored,
  created_at      timestamptz not null default now()
);

create index cv_chunks_member_current_idx on public.cv_chunks (member_id, is_current);
create index cv_chunks_tsv_idx on public.cv_chunks using gin (content_tsv);
-- HNSW/ivfflat on embedding deliberately deferred, per the spec: at the
-- scale a few hundred CVs implies, a sequential scan is fine, and an
-- index tuned before there's real data to measure against is a guess.

alter table public.cv_chunks enable row level security;

-- ─── cv_skills (ESCO taxonomy, embedded) ────────────────────────────
create table public.cv_skills (
  id             uuid        primary key default gen_random_uuid(),
  canonical_name text        not null unique,
  esco_uri       text,
  embedding      vector(1536) not null,
  created_at     timestamptz not null default now()
);

alter table public.cv_skills enable row level security;

-- ─── member_skills ───────────────────────────────────────────────────
-- No cv_id on purpose — see the spec's "CV replacement" section. Because
-- of that, a currency change (fresh processing OR the hash-match
-- reactivation path) always does a full delete-and-reinsert for the
-- member, never a diff.
create table public.member_skills (
  id         uuid        primary key default gen_random_uuid(),
  member_id  uuid        not null references public.profiles(id) on delete cascade,
  skill_id   uuid        references public.cv_skills(id) on delete set null,
  raw_text   text        not null,
  confidence real,
  created_at timestamptz not null default now()
);

create index member_skills_member_idx on public.member_skills (member_id);

alter table public.member_skills enable row level security;

-- ─── jobs (ingest worker queue) ──────────────────────────────────────
-- cv-matchmaker-spec.md's "Job queue" section: a jobs table + polling
-- worker, run as a process separate from the request-serving gateway
-- (server/app/worker.py, `python -m app.worker` — a different process
-- from uvicorn/gunicorn running main.py). FOR UPDATE SKIP LOCKED is what
-- makes polling safe if more than one worker process is ever run.
create type public.job_status as enum ('pending', 'running', 'done', 'failed', 'dead');

create table public.jobs (
  id              uuid        primary key default gen_random_uuid(),
  kind            text        not null,
  payload         jsonb       not null,
  status          public.job_status not null default 'pending',
  attempts        int         not null default 0,
  max_attempts    int         not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The worker's poll query is `where status = 'pending' and next_attempt_at
-- <= now() order by created_at limit 1 for update skip locked`.
create index jobs_poll_idx on public.jobs (status, next_attempt_at);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.tg_set_updated_at();

alter table public.jobs enable row level security;
-- No policies anywhere above: every one of these six tables is deny-all
-- to PostgREST. The worker's direct Postgres connection is unaffected —
-- RLS and these GRANT/REVOKE statements only govern the authenticated/
-- anon roles PostgREST connects as.
revoke all on public.cvs, public.cv_profiles, public.cv_chunks,
  public.cv_skills, public.member_skills, public.jobs
  from public, anon, authenticated;

-- ─── update_cv_currency ──────────────────────────────────────────────
-- Flips is_current across cvs/cv_profiles/cv_chunks together, in one
-- transaction, for every CV belonging to the member who owns p_cv_id.
-- Called by the worker at the end of chunk_and_embed, and again on the
-- sanitisation hash-match short-circuit path (reactivating a previously
-- -ready CV without re-running extraction/embedding).
--
-- member_skills is NOT touched here — it has no cv_id to join through
-- (see above), so its full delete-and-reinsert is done by the worker
-- itself, in the same database transaction as this call, once it has
-- the actual skill matches to insert.
create or replace function public.update_cv_currency(p_cv_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  select member_id into v_member_id from public.cvs where id = p_cv_id;
  if v_member_id is null then
    raise exception 'No such cv: %', p_cv_id using errcode = '22023';
  end if;

  update public.cvs
     set is_current = (id = p_cv_id)
   where member_id = v_member_id
     and is_current != (id = p_cv_id);

  update public.cv_profiles cp
     set is_current = (cp.cv_id = p_cv_id)
    from public.cvs c
   where c.id = cp.cv_id
     and c.member_id = v_member_id
     and cp.is_current != (cp.cv_id = p_cv_id);

  update public.cv_chunks cc
     set is_current = (cc.cv_id = p_cv_id)
   where cc.member_id = v_member_id
     and cc.is_current != (cc.cv_id = p_cv_id);
end;
$$;

revoke execute on function public.update_cv_currency(uuid) from public, anon, authenticated;

-- ─── confirm_cv_upload: also open a cvs row and enqueue ingestion ────
-- Same signature as 20260901000012's version (which this replaces), and
-- every existing line of it is unchanged — this only adds the two
-- inserts at the end. The old prefillCvSkillsInBackground path (via
-- cv_suggested_skill_ids) keeps running exactly as it does today,
-- side by side with the new pipeline, until it is deliberately retired.
create or replace function public.confirm_cv_upload(
  p_blob_key text,
  p_filename text,
  p_consent  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_name   text;
  v_cv_id  uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.upload_tickets
     where blob_key = p_blob_key
       and user_id = v_caller
       and purpose = 'cv'
       and consumed_at is null
  ) then
    raise exception 'That upload ticket is invalid, expired, or already used'
      using errcode = '42501';
  end if;

  update public.upload_tickets
     set consumed_at = now()
   where blob_key = p_blob_key;

  v_name := nullif(trim(coalesce(p_filename, '')), '');
  if v_name is not null and length(v_name) > 255 then
    v_name := left(v_name, 255);
  end if;

  -- The previous cv_path (if any) is enqueued for deletion by
  -- profiles_enqueue_media_deletion (20260901000002), not here.
  perform set_config('foundry.media_write', 'true', true);
  update public.profiles
     set cv_path                 = p_blob_key,
         cv_uploaded_at          = now(),
         cv_original_filename    = v_name,
         cv_parse_consent        = coalesce(p_consent, false),
         cv_parse_consent_at     = case when p_consent then now() else null end,
         cv_suggested_skill_ids  = null
   where id = v_caller;
  perform set_config('foundry.media_write', 'false', true);

  -- Gated on the same consent tick as the older suggestion flow above —
  -- the privacy policy (section 2a) promises CV text is only read if this
  -- box is ticked, so the ingest pipeline must honour it too, not just the
  -- deterministic prefill. See cv-matchmaker-phase1-shipped's follow-up:
  -- until the policy copy is rewritten to disclose OpenAI as a
  -- sub-processor, an unconsented upload must never reach it.
  if p_consent then
    insert into public.cvs (member_id, blob_key, original_filename)
    values (v_caller, p_blob_key, v_name)
    returning id into v_cv_id;

    insert into public.jobs (kind, payload)
    values ('ingest_cv', jsonb_build_object('cv_id', v_cv_id));
  end if;
end;
$$;

revoke execute on function public.confirm_cv_upload(text, text, boolean) from public, anon;
grant  execute on function public.confirm_cv_upload(text, text, boolean) to authenticated;

-- ─── get_my_cv_status ────────────────────────────────────────────────
-- Backs the "processing..." dialog. Deliberately the member's MOST
-- RECENT cvs row, not the is_current one — is_current only flips true
-- once chunk_and_embed finishes, so while a CV is pending/extracting/
-- embedding (or has failed/been flagged), it is never is_current, and a
-- member watching the dialog for the file they just uploaded needs that
-- row's status, not their previous CV's.
create or replace function public.get_my_cv_status()
returns table (status public.cv_status, failure_reason text)
language sql
stable
security definer
set search_path = public
as $$
  select status, failure_reason
    from public.cvs
   where member_id = auth.uid()
   order by created_at desc
   limit 1;
$$;

revoke execute on function public.get_my_cv_status() from public, anon;
grant  execute on function public.get_my_cv_status() to authenticated;

-- ─── get_my_cv_profile ───────────────────────────────────────────────
-- The generated summary + matched skills for the dialog's "ready" state.
-- Only ever the CURRENT cv (is_current = true) — once ready, that's the
-- same row get_my_cv_status was just describing.
create or replace function public.get_my_cv_profile()
returns table (summary text, skills text[])
language sql
stable
security definer
set search_path = public
as $$
  select cp.summary,
         coalesce(
           (select array_agg(coalesce(cs.canonical_name, ms.raw_text) order by ms.confidence desc nulls last)
              from public.member_skills ms
              left join public.cv_skills cs on cs.id = ms.skill_id
             where ms.member_id = c.member_id),
           '{}'
         )
    from public.cvs c
    join public.cv_profiles cp on cp.cv_id = c.id
   where c.member_id = auth.uid()
     and c.is_current = true
   limit 1;
$$;

revoke execute on function public.get_my_cv_profile() from public, anon;
grant  execute on function public.get_my_cv_profile() to authenticated;
