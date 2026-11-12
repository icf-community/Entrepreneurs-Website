-- ════════════════════════════════════════════════════════════════════
-- Foundry · AI consent, concept dictionary and search projections
-- (AI-plan §1, §5.1, §6, §7, A0.3–A0.4)
--
-- Consent. Being found by recruiters, being found by members building a
-- network, and letting recruiters see quoted CV lines are three separate
-- choices, all OFF by default (owner, 2026-09-25). Withdrawing one deletes
-- that purpose's projection and cached assessments in the same
-- transaction; result reads re-check consent too, so withdrawal is an
-- immediate read deny, not a TTL.
--
-- Concepts. A reviewed, versioned dictionary of tools, methods, areas and
-- interests with exact aliases. `part_of` lets demonstrated PyTorch
-- support Deep Learning; `related_to` (PyTorch ~ TensorFlow) is partial
-- credit and never satisfies an exact requirement. Holds no member data.
--
-- Projections. The existing CV worker (F26) builds one row per member and
-- purpose ('recruiter', 'network', 'self') plus minimised evidence items,
-- and one row per approved job, from a versioned source snapshot. A
-- trigger on every source table bumps the member's version and queues a
-- refresh; the worker promotes its result only if the version and consent
-- epoch it read are still current (compare-and-swap), so a job that
-- started before a withdrawal can never restore data afterwards.
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. Member AI settings and consent audit ────────────────────────
create table ai_private.member_settings (
  member_id               uuid primary key references public.profiles(id) on delete cascade,
  recruiter_discoverable  boolean not null default false,
  network_discoverable    boolean not null default false,
  evidence_sharing        boolean not null default false,
  use_chat_memory         boolean not null default true,
  network_offers          text[]  not null default '{}' check (cardinality(network_offers) <= 10),
  network_seeks           text[]  not null default '{}' check (cardinality(network_seeks) <= 10),
  pref_role_types         text[]  not null default '{}'
    check (pref_role_types <@ array['internship', 'placement', 'graduate', 'part_time', 'full_time', 'contract', 'cofounder']),
  pref_location_types     text[]  not null default '{}'
    check (pref_location_types <@ array['remote', 'hybrid', 'onsite']),
  consent_version         text check (consent_version is null or length(consent_version) <= 40),
  consent_epoch           int  not null default 0,
  updated_at              timestamptz not null default now()
);
alter table ai_private.member_settings enable row level security;

create table ai_private.consent_events (
  id               bigserial primary key,
  member_id        uuid not null references public.profiles(id) on delete cascade,
  choice           text not null check (choice in ('recruiter_discoverable', 'network_discoverable', 'evidence_sharing')),
  granted          boolean not null,
  consent_version  text,
  created_at       timestamptz not null default now()
);
create index consent_events_member_idx on ai_private.consent_events (member_id, created_at desc);
alter table ai_private.consent_events enable row level security;


-- ─── 2. Concept dictionary ──────────────────────────────────────────
create table ai_private.concepts (
  slug                text primary key check (slug ~ '^[a-z0-9][a-z0-9_.+#-]{0,47}$'),
  label               text not null check (length(label) between 1 and 60),
  kind                text not null check (kind in ('tool', 'method', 'area', 'interest', 'language')),
  aliases             text[] not null default '{}',
  -- Short or common-word aliases ('go', 'r', 'c', 'rust') only count with
  -- a technical neighbour; the matcher enforces it.
  ambiguous           boolean not null default false,
  dictionary_version  int not null default 1
);
alter table ai_private.concepts enable row level security;

create table ai_private.concept_relations (
  from_slug  text not null references ai_private.concepts(slug) on delete cascade,
  to_slug    text not null references ai_private.concepts(slug) on delete cascade,
  relation   text not null check (relation in ('related_to', 'part_of')),
  weight     numeric(3, 2) not null default 0.5 check (weight > 0 and weight <= 1),
  primary key (from_slug, to_slug, relation),
  check (from_slug <> to_slug)
);
alter table ai_private.concept_relations enable row level security;

-- Labels for chips and pickers. Nonpersonal; approved members only.
create or replace function public.ai_list_concepts(p_kinds text[] default null)
returns table (slug text, label text, kind text)
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  return query
    select c.slug, c.label, c.kind from ai_private.concepts c
     where p_kinds is null or c.kind = any(p_kinds)
     order by c.label
     limit 1000;
end;
$$;
revoke all on function public.ai_list_concepts(text[]) from public, anon, authenticated;
grant execute on function public.ai_list_concepts(text[]) to authenticated;


-- ─── 3. Projections and evidence ────────────────────────────────────
create table ai_private.member_source_versions (
  member_id   uuid primary key references public.profiles(id) on delete cascade,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now()
);
alter table ai_private.member_source_versions enable row level security;

create table ai_private.member_docs (
  member_id        uuid not null references public.profiles(id) on delete cascade,
  purpose          text not null check (purpose in ('recruiter', 'network', 'self')),
  source_version   bigint not null,
  consent_epoch    int not null,
  policy_version   text not null check (length(policy_version) <= 40),
  projection_hash  text not null check (length(projection_hash) = 64),
  concepts         text[] not null default '{}',
  features         jsonb not null default '{}'::jsonb,
  body             text not null check (length(body) <= 6000),
  tsv              tsvector generated always as (to_tsvector('simple', body)) stored,
  embedding        vector(1536),
  embedding_model  text,
  updated_at       timestamptz not null default now(),
  primary key (member_id, purpose)
);
create index member_docs_concepts_idx  on ai_private.member_docs using gin (concepts);
create index member_docs_tsv_idx       on ai_private.member_docs using gin (tsv);
create index member_docs_purpose_idx   on ai_private.member_docs (purpose);
create index member_docs_embedding_idx on ai_private.member_docs using hnsw (embedding vector_cosine_ops);
alter table ai_private.member_docs enable row level security;

-- Immutable, minimised source spans. The assessor may only cite these
-- ids, and the server checks each one belongs to that candidate (§7).
-- `from_cv` lines are quotable to a recruiter only with evidence sharing.
create table ai_private.member_evidence (
  id              bigserial primary key,
  member_id       uuid not null references public.profiles(id) on delete cascade,
  purpose         text not null check (purpose in ('recruiter', 'network', 'self')),
  source_version  bigint not null,
  source_kind     text not null check (source_kind in (
                    'skill_tag', 'sector_tag', 'interest', 'intent', 'offer', 'seek', 'bio_focus',
                    'bio_hobbies', 'course', 'cv_skill', 'cv_project', 'cv_role', 'cv_education',
                    'github_language', 'github_repo')),
  concept_slugs   text[] not null default '{}',
  text            text not null check (length(text) between 1 and 300),
  polarity        text not null default 'positive' check (polarity in ('positive', 'negative', 'aspirational')),
  from_cv         boolean not null default false
);
create index member_evidence_member_idx on ai_private.member_evidence (member_id, purpose);
alter table ai_private.member_evidence enable row level security;

create table ai_private.job_docs (
  opportunity_id   uuid primary key references public.opportunities(id) on delete cascade,
  content_version  int not null,
  concepts         text[] not null default '{}',
  body             text not null check (length(body) <= 6000),
  tsv              tsvector generated always as (to_tsvector('simple', body)) stored,
  embedding        vector(1536),
  embedding_model  text,
  updated_at       timestamptz not null default now()
);
create index job_docs_concepts_idx  on ai_private.job_docs using gin (concepts);
create index job_docs_tsv_idx       on ai_private.job_docs using gin (tsv);
create index job_docs_embedding_idx on ai_private.job_docs using hnsw (embedding vector_cosine_ops);
alter table ai_private.job_docs enable row level security;

-- Parsed requirements need the poster's confirmation before they define
-- a recruiter search (§14.3). A content edit sends them back to pending.
create table ai_private.job_requirements (
  opportunity_id   uuid primary key references public.opportunities(id) on delete cascade,
  content_version  int not null,
  status           text not null check (status in ('pending', 'parsed', 'confirmed', 'failed')),
  parsed           jsonb,
  confirmed        jsonb,
  role_level       text check (role_level in ('internship', 'entry', 'experienced', 'lead', 'unspecified')),
  confirmed_by     uuid references public.profiles(id) on delete set null,
  confirmed_at     timestamptz,
  model            text,
  prompt_version   text,
  failure          text check (failure is null or length(failure) <= 200),
  updated_at       timestamptz not null default now()
);
alter table ai_private.job_requirements enable row level security;


-- ─── 4. Dirty marking and refresh queue ─────────────────────────────
-- Bumps the member's source version and queues one refresh. Queues only
-- while AI is switched on; turning it on runs a backfill
-- (ai_private.enqueue_ai_backfill), so nothing is embedded for a feature
-- that is off.
create or replace function ai_private.bump_member_source(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  -- Null, or a cascade from an account deletion: nothing left to bump.
  if p_member is null or not exists (select 1 from public.profiles where id = p_member) then
    return;
  end if;
  insert into ai_private.member_source_versions as v (member_id, version)
  values (p_member, 1)
  on conflict (member_id) do update set version = v.version + 1, updated_at = now();

  if coalesce((select value = 'true' from public.app_config where key = 'ai_enabled'), false) then
    insert into public.jobs (kind, payload)
    select 'refresh_member_ai', jsonb_build_object('member_id', p_member)
     where not exists (
       select 1 from public.jobs j
        where j.kind = 'refresh_member_ai' and j.status = 'pending'
          and (j.payload->>'member_id')::uuid = p_member);
  end if;
end;
$$;

create or replace function ai_private.queue_job_refresh(p_opportunity uuid)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if coalesce((select value = 'true' from public.app_config where key = 'ai_enabled'), false) then
    insert into public.jobs (kind, payload)
    select 'refresh_job_ai', jsonb_build_object('opportunity_id', p_opportunity)
     where not exists (
       select 1 from public.jobs j
        where j.kind = 'refresh_job_ai' and j.status = 'pending'
          and (j.payload->>'opportunity_id')::uuid = p_opportunity);
  end if;
end;
$$;

-- One generic row trigger: the member id is in a named column.
create or replace function ai_private.tg_bump_member_source()
returns trigger
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_col  text := tg_argv[0];
  v_new  uuid;
  v_old  uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := (to_jsonb(new) ->> v_col)::uuid;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := (to_jsonb(old) ->> v_col)::uuid;
  end if;
  perform ai_private.bump_member_source(v_new);
  if v_old is distinct from v_new then
    perform ai_private.bump_member_source(v_old);
  end if;
  return null;
end;
$$;

create trigger ai_source_profiles
  after update of status, role, course, grad_year, bio, bio_focus, bio_hobbies, working_on, is_committee,
                  current_focus, availability_hours, open_to_connections, first_name, surname, preferred_name,
                  cv_parse_consent
  on public.profiles
  for each row execute function ai_private.tg_bump_member_source('id');
create trigger ai_source_profile_skills  after insert or update or delete on public.profile_skills
  for each row execute function ai_private.tg_bump_member_source('profile_id');
create trigger ai_source_profile_sectors after insert or update or delete on public.profile_sectors
  for each row execute function ai_private.tg_bump_member_source('profile_id');
create trigger ai_source_profile_interests after insert or update or delete on public.profile_interests
  for each row execute function ai_private.tg_bump_member_source('profile_id');
create trigger ai_source_profile_intents after insert or update or delete on public.profile_intents
  for each row execute function ai_private.tg_bump_member_source('profile_id');
create trigger ai_source_cvs after update of status, is_current or delete on public.cvs
  for each row execute function ai_private.tg_bump_member_source('member_id');
create trigger ai_source_member_skills after insert or delete on public.member_skills
  for each row execute function ai_private.tg_bump_member_source('member_id');
create trigger ai_source_github after insert or update of github_signal, showcase_repos, scan_status or delete
  on public.github_connections
  for each row execute function ai_private.tg_bump_member_source('member_id');
create trigger ai_source_education after insert or update on public.member_education
  for each row execute function ai_private.tg_bump_member_source('member_id');

-- cv_profiles carries a cv id, not a member id.
create or replace function ai_private.tg_bump_from_cv_profile()
returns trigger
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  perform ai_private.bump_member_source((select c.member_id from public.cvs c where c.id = new.cv_id));
  return null;
end;
$$;
create trigger ai_source_cv_profiles after insert or update of profile, summary on public.cv_profiles
  for each row execute function ai_private.tg_bump_from_cv_profile();

-- Jobs: refresh on approval and on any content or audience change.
create or replace function ai_private.tg_job_source()
returns trigger
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT'
          or old.status is distinct from new.status
          or old.content_version is distinct from new.content_version
          or old.audience_version is distinct from new.audience_version) then
    perform ai_private.queue_job_refresh(new.id);
  end if;
  -- A content edit invalidates confirmed requirements until the poster
  -- confirms the new version (§5).
  if tg_op = 'UPDATE' and old.content_version is distinct from new.content_version then
    update ai_private.job_requirements
       set status = 'pending', updated_at = now()
     where opportunity_id = new.id and content_version <> new.content_version;
  end if;
  return null;
end;
$$;
create trigger ai_source_opportunities after insert or update of status, content_version, audience_version
  on public.opportunities
  for each row execute function ai_private.tg_job_source();

revoke all on function ai_private.bump_member_source(uuid) from public;
revoke all on function ai_private.queue_job_refresh(uuid) from public;
revoke all on function ai_private.tg_bump_member_source() from public;
revoke all on function ai_private.tg_bump_from_cv_profile() from public;
revoke all on function ai_private.tg_job_source() from public;

-- Run when AI is switched on: queue a refresh for every approved member
-- and every open approved job. Bounded per call; the operator action
-- calls it until it returns 0.
create or replace function ai_private.enqueue_ai_backfill(p_limit int default 5000)
returns int
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_n int := 0;
  v_m int := 0;
begin
  insert into public.jobs (kind, payload)
  select 'refresh_member_ai', jsonb_build_object('member_id', p.id)
    from public.profiles p
   where p.status = 'approved'
     and not exists (select 1 from ai_private.member_docs d
                      where d.member_id = p.id and d.purpose = 'self'
                        and d.source_version = coalesce((select v.version from ai_private.member_source_versions v
                                                           where v.member_id = p.id), 0))
     and not exists (select 1 from public.jobs j
                      where j.kind = 'refresh_member_ai' and j.status in ('pending', 'running')
                        and (j.payload->>'member_id')::uuid = p.id)
   limit greatest(1, least(p_limit, 5000));
  get diagnostics v_n = row_count;

  insert into public.jobs (kind, payload)
  select 'refresh_job_ai', jsonb_build_object('opportunity_id', o.id)
    from public.opportunities o
   where o.status = 'approved' and o.application_deadline >= current_date
     and not exists (select 1 from ai_private.job_docs d
                      where d.opportunity_id = o.id and d.content_version = o.content_version)
     and not exists (select 1 from public.jobs j
                      where j.kind = 'refresh_job_ai' and j.status in ('pending', 'running')
                        and (j.payload->>'opportunity_id')::uuid = o.id)
   limit greatest(1, least(p_limit, 5000));
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;
revoke all on function ai_private.enqueue_ai_backfill(int) from public;


-- ─── 5. Member settings RPCs ────────────────────────────────────────
create or replace function public.get_my_ai_settings()
returns table (recruiter_discoverable boolean, network_discoverable boolean, evidence_sharing boolean,
               use_chat_memory boolean, network_offers text[], network_seeks text[],
               pref_role_types text[], pref_location_types text[], consent_version text,
               updated_at timestamptz)
language sql
stable
security definer
set search_path = public, ai_private
as $$
  select coalesce(s.recruiter_discoverable, false), coalesce(s.network_discoverable, false),
         coalesce(s.evidence_sharing, false), coalesce(s.use_chat_memory, true),
         coalesce(s.network_offers, '{}'), coalesce(s.network_seeks, '{}'),
         coalesce(s.pref_role_types, '{}'), coalesce(s.pref_location_types, '{}'),
         s.consent_version, s.updated_at
    from (select 1) one
    left join ai_private.member_settings s on s.member_id = (select auth.uid());
$$;

create or replace function public.set_my_ai_settings(
  p_recruiter_discoverable boolean,
  p_network_discoverable   boolean,
  p_evidence_sharing       boolean,
  p_use_chat_memory        boolean,
  p_network_offers         text[],
  p_network_seeks          text[],
  p_pref_role_types        text[],
  p_pref_location_types    text[],
  p_consent_version        text
)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_old  ai_private.member_settings;
  v_bump boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_consent_version is null or length(p_consent_version) > 40 then
    raise exception 'Missing consent version' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_network_offers, '{}') || coalesce(p_network_seeks, '{}')) s
              where not exists (select 1 from ai_private.concepts c where c.slug = s)) then
    raise exception 'Unknown topic' using errcode = '22023';
  end if;

  select * into v_old from ai_private.member_settings where member_id = v_uid for update;
  v_bump := v_old.member_id is null
         or v_old.recruiter_discoverable is distinct from p_recruiter_discoverable
         or v_old.network_discoverable   is distinct from p_network_discoverable
         or v_old.evidence_sharing       is distinct from p_evidence_sharing;

  insert into ai_private.member_settings as s (
    member_id, recruiter_discoverable, network_discoverable, evidence_sharing, use_chat_memory,
    network_offers, network_seeks, pref_role_types, pref_location_types, consent_version, consent_epoch)
  values (v_uid, coalesce(p_recruiter_discoverable, false), coalesce(p_network_discoverable, false),
          coalesce(p_evidence_sharing, false), coalesce(p_use_chat_memory, true),
          coalesce(p_network_offers, '{}'), coalesce(p_network_seeks, '{}'),
          coalesce(p_pref_role_types, '{}'), coalesce(p_pref_location_types, '{}'),
          p_consent_version, 1)
  on conflict (member_id) do update
     set recruiter_discoverable = excluded.recruiter_discoverable,
         network_discoverable   = excluded.network_discoverable,
         evidence_sharing       = excluded.evidence_sharing,
         use_chat_memory        = excluded.use_chat_memory,
         network_offers         = excluded.network_offers,
         network_seeks          = excluded.network_seeks,
         pref_role_types        = excluded.pref_role_types,
         pref_location_types    = excluded.pref_location_types,
         consent_version        = excluded.consent_version,
         consent_epoch          = s.consent_epoch + case when v_bump then 1 else 0 end,
         updated_at             = now();

  insert into ai_private.consent_events (member_id, choice, granted, consent_version)
  select v_uid, c.choice, c.granted, p_consent_version
    from (values ('recruiter_discoverable', coalesce(p_recruiter_discoverable, false), v_old.recruiter_discoverable),
                 ('network_discoverable',   coalesce(p_network_discoverable, false),   v_old.network_discoverable),
                 ('evidence_sharing',       coalesce(p_evidence_sharing, false),       v_old.evidence_sharing))
         as c(choice, granted, before)
   where c.before is distinct from c.granted;

  -- Withdrawal is immediate (§6): the projection and every cached
  -- judgement built on it go now, not when a worker gets round to it.
  if not coalesce(p_recruiter_discoverable, false) then
    delete from ai_private.member_docs where member_id = v_uid and purpose = 'recruiter';
    delete from ai_private.member_evidence where member_id = v_uid and purpose = 'recruiter';
  end if;
  if not coalesce(p_network_discoverable, false) then
    delete from ai_private.member_docs where member_id = v_uid and purpose = 'network';
    delete from ai_private.member_evidence where member_id = v_uid and purpose = 'network';
  end if;

  perform ai_private.bump_member_source(v_uid);
end;
$$;

revoke all on function public.get_my_ai_settings() from public, anon, authenticated;
revoke all on function public.set_my_ai_settings(boolean, boolean, boolean, boolean, text[], text[], text[], text[], text) from public, anon, authenticated;
grant execute on function public.get_my_ai_settings() to authenticated;
grant execute on function public.set_my_ai_settings(boolean, boolean, boolean, boolean, text[], text[], text[], text[], text) to authenticated;

-- "Preview what AI uses" (§2): the member's own projection, per purpose.
create or replace function public.ai_preview_my_projection(p_purpose text)
returns table (source_kind text, text text, from_cv boolean, concepts text[], built_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
begin
  if not (public.is_approved() or public.is_admin()) then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_purpose not in ('recruiter', 'network', 'self') then
    raise exception 'Unknown purpose' using errcode = '22023';
  end if;
  return query
    select e.source_kind, e.text, e.from_cv,
           array(select c.label from ai_private.concepts c where c.slug = any(e.concept_slugs) order by c.label),
           d.updated_at
      from ai_private.member_evidence e
      join ai_private.member_docs d on d.member_id = e.member_id and d.purpose = e.purpose
     where e.member_id = (select auth.uid()) and e.purpose = p_purpose
     order by e.id
     limit 200;
end;
$$;
revoke all on function public.ai_preview_my_projection(text) from public, anon, authenticated;
grant execute on function public.ai_preview_my_projection(text) to authenticated;


-- ─── 6. Worker functions (F26: the existing CV worker builds these) ──
-- Everything the projection builder may read, in one snapshot. Contact
-- details, links and the CV's raw text are not part of it; names come
-- back only so the worker can remove them.
create or replace function ai_private.worker_member_source(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ai_private, auth
as $$
declare
  v jsonb;
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'member_id', p.id,
    'version', coalesce((select v.version from ai_private.member_source_versions v where v.member_id = p.id), 0),
    'status', p.status,
    'role', p.role,
    'is_committee', p.is_committee,
    'course', p.course,
    'grad_year', p.grad_year,
    'bio_focus', p.bio_focus,
    'bio_hobbies', p.bio_hobbies,
    'working_on', p.working_on,
    'current_focus', p.current_focus,
    'availability_hours', p.availability_hours,
    'open_to_connections', p.open_to_connections,
    'cv_parse_consent', p.cv_parse_consent,
    'identifiers', jsonb_build_object('first_name', p.first_name, 'surname', p.surname,
                                      'preferred_name', p.preferred_name),
    'settings', (select to_jsonb(s) - 'member_id' from ai_private.member_settings s where s.member_id = p.id),
    'education', (select jsonb_build_object('currently_enrolled', e.currently_enrolled,
                                            'has_completed_degree', e.has_completed_degree)
                    from public.member_education e where e.member_id = p.id),
    'skill_tags', coalesce((select jsonb_agg(s.name::text order by s.name)
                              from public.profile_skills ps join public.skills s on s.id = ps.skill_id
                             where ps.profile_id = p.id), '[]'::jsonb),
    'sector_tags', coalesce((select jsonb_agg(s.name::text order by s.name)
                               from public.profile_sectors ps join public.sectors s on s.id = ps.sector_id
                              where ps.profile_id = p.id), '[]'::jsonb),
    'interests', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'label', i.label) order by i.label)
                             from public.profile_interests i where i.profile_id = p.id), '[]'::jsonb),
    'intents', coalesce((select jsonb_agg(i.intent order by i.rank) from public.profile_intents i
                          where i.profile_id = p.id), '[]'::jsonb),
    'cv', (select jsonb_build_object('policy_version', cp.policy_version, 'prompt_version', cp.prompt_version,
                                     'skills_raw', cp.profile->'skills_raw',
                                     'roles', (select coalesce(jsonb_agg(jsonb_build_object(
                                                 'title', r->>'title', 'start_date', r->>'start_date',
                                                 'end_date', r->>'end_date', 'description', r->>'description',
                                                 'is_current', r->'is_current')), '[]'::jsonb)
                                                 from jsonb_array_elements(coalesce(cp.profile->'roles', '[]'::jsonb)) r),
                                     'projects', (select coalesce(jsonb_agg(jsonb_build_object(
                                                 'name', pj->>'name', 'description', pj->>'description',
                                                 'technologies', pj->'technologies')), '[]'::jsonb)
                                                 from jsonb_array_elements(coalesce(cp.profile->'projects', '[]'::jsonb)) pj),
                                     'education', (select coalesce(jsonb_agg(jsonb_build_object(
                                                 'course', ed->>'course', 'level', ed->>'level')), '[]'::jsonb)
                                                 from jsonb_array_elements(coalesce(cp.profile->'education', '[]'::jsonb)) ed))
             from public.cvs c join public.cv_profiles cp on cp.cv_id = c.id
            where c.member_id = p.id and c.is_current and c.status = 'ready' and p.cv_parse_consent
            order by c.created_at desc limit 1),
    'github', (select jsonb_build_object(
                 'username', g.github_username,
                 'languages', g.github_signal->'languages',
                 'repos', (select coalesce(jsonb_agg(jsonb_build_object(
                             'name', r->>'name', 'description', coalesce(r->>'blurb', r->>'description'),
                             'language', r->>'language')), '[]'::jsonb)
                             from jsonb_array_elements(coalesce(g.showcase_repos, g.github_signal->'top_repos', '[]'::jsonb)) r))
                 from public.github_connections g
                where g.member_id = p.id and g.scan_status = 'ready')
  ) into v
  from public.profiles p
  where p.id = p_member;
  return v;
end;
$$;

-- Compare-and-swap promotion. Returns false (and writes nothing) when the
-- member changed, withdrew or re-consented while the worker was building.
create or replace function ai_private.worker_put_member_docs(
  p_member uuid, p_version bigint, p_consent_epoch int, p_docs jsonb, p_evidence jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_current  bigint;
  v_settings ai_private.member_settings;
  v_profile  public.profiles;
  v_allowed  text[];
  d          jsonb;
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select version into v_current from ai_private.member_source_versions where member_id = p_member for update;
  if v_current is distinct from p_version then
    return false;
  end if;
  select * into v_settings from ai_private.member_settings where member_id = p_member;
  if coalesce(v_settings.consent_epoch, 0) <> p_consent_epoch then
    return false;
  end if;
  select * into v_profile from public.profiles where id = p_member;

  -- Purposes this member may have right now. The worker proposes; this
  -- decides.
  v_allowed := array[]::text[];
  if v_profile.status = 'approved' then
    v_allowed := v_allowed || 'self'::text;
    if not v_profile.is_committee and coalesce(v_settings.recruiter_discoverable, false) then
      v_allowed := v_allowed || 'recruiter'::text;
    end if;
    if not v_profile.is_committee and coalesce(v_settings.network_discoverable, false) then
      v_allowed := v_allowed || 'network'::text;
    end if;
  end if;

  delete from ai_private.member_evidence where member_id = p_member;
  delete from ai_private.member_docs where member_id = p_member;

  for d in select * from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) loop
    continue when not ((d->>'purpose') = any(v_allowed));
    insert into ai_private.member_docs (member_id, purpose, source_version, consent_epoch, policy_version,
                                        projection_hash, concepts, features, body, embedding, embedding_model)
    values (p_member, d->>'purpose', p_version, p_consent_epoch, d->>'policy_version', d->>'projection_hash',
            array(select jsonb_array_elements_text(coalesce(d->'concepts', '[]'::jsonb))),
            coalesce(d->'features', '{}'::jsonb), d->>'body',
            case when d->>'embedding' is null then null else (d->>'embedding')::vector end,
            d->>'embedding_model');
  end loop;

  insert into ai_private.member_evidence (member_id, purpose, source_version, source_kind, concept_slugs,
                                          text, polarity, from_cv)
  select p_member, e->>'purpose', p_version, e->>'source_kind',
         array(select jsonb_array_elements_text(coalesce(e->'concepts', '[]'::jsonb))),
         left(e->>'text', 300), coalesce(e->>'polarity', 'positive'), coalesce((e->>'from_cv')::boolean, false)
    from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) e
   where (e->>'purpose') = any(v_allowed);

  return true;
end;
$$;

create or replace function ai_private.worker_job_source(p_opportunity uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
declare
  v jsonb;
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'opportunity_id', o.id, 'status', o.status, 'content_version', o.content_version,
    'creation_source', o.creation_source, 'eligible_audience', o.eligible_audience,
    'position_name', o.position_name, 'company', o.company, 'pay', o.pay,
    'location_type', o.location_type, 'location_text', o.location_text,
    'description', o.description, 'start_month', o.start_month, 'start_year', o.start_year,
    'application_deadline', o.application_deadline,
    'skill_tags', coalesce((select jsonb_agg(s.name::text order by s.name)
                              from public.opportunity_skills os join public.skills s on s.id = os.skill_id
                             where os.opportunity_id = o.id), '[]'::jsonb),
    'sector_tags', coalesce((select jsonb_agg(s.name::text order by s.name)
                               from public.opportunity_sectors os join public.sectors s on s.id = os.sector_id
                              where os.opportunity_id = o.id), '[]'::jsonb),
    'posted_by', o.posted_by,
    'requirements_status', (select r.status from ai_private.job_requirements r
                             where r.opportunity_id = o.id and r.content_version = o.content_version)
  ) into v
  from public.opportunities o where o.id = p_opportunity;
  return v;
end;
$$;

create or replace function ai_private.worker_put_job_ai(
  p_opportunity uuid, p_content_version int, p_doc jsonb, p_requirements jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_opp public.opportunities;
begin
  if session_user not in ('cv_worker', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into v_opp from public.opportunities where id = p_opportunity for share;
  if not found or v_opp.content_version <> p_content_version or v_opp.status <> 'approved' then
    return false;
  end if;

  insert into ai_private.job_docs (opportunity_id, content_version, concepts, body, embedding, embedding_model)
  values (p_opportunity, p_content_version,
          array(select jsonb_array_elements_text(coalesce(p_doc->'concepts', '[]'::jsonb))),
          p_doc->>'body',
          case when p_doc->>'embedding' is null then null else (p_doc->>'embedding')::vector end,
          p_doc->>'embedding_model')
  on conflict (opportunity_id) do update
     set content_version = excluded.content_version, concepts = excluded.concepts, body = excluded.body,
         embedding = excluded.embedding, embedding_model = excluded.embedding_model, updated_at = now();

  -- Recruiter requirements only for member-flow jobs (F18), and never
  -- over a confirmation the poster already gave for this same version.
  if p_requirements is not null and v_opp.creation_source = 'member' then
    insert into ai_private.job_requirements (opportunity_id, content_version, status, parsed, role_level,
                                             model, prompt_version, failure)
    values (p_opportunity, p_content_version,
            case when p_requirements ? 'failure' then 'failed' else 'parsed' end,
            p_requirements->'atoms', coalesce(p_requirements->>'role_level', 'unspecified'),
            p_requirements->>'model', p_requirements->>'prompt_version', left(p_requirements->>'failure', 200))
    on conflict (opportunity_id) do update
       set content_version = excluded.content_version, status = excluded.status, parsed = excluded.parsed,
           role_level = excluded.role_level, model = excluded.model, prompt_version = excluded.prompt_version,
           failure = excluded.failure, confirmed = null, confirmed_by = null, confirmed_at = null,
           updated_at = now()
     where not (ai_private.job_requirements.status = 'confirmed'
                and ai_private.job_requirements.content_version = excluded.content_version);
  end if;
  return true;
end;
$$;

create or replace function ai_private.worker_concepts()
returns table (slug text, label text, kind text, aliases text[], ambiguous boolean, dictionary_version int)
language plpgsql
stable
security definer
set search_path = ai_private
as $$
begin
  if session_user not in ('cv_worker', 'ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query select c.slug, c.label, c.kind, c.aliases, c.ambiguous, c.dictionary_version
                 from ai_private.concepts c order by c.slug;
end;
$$;

create or replace function ai_private.worker_concept_relations()
returns table (from_slug text, to_slug text, relation text, weight numeric)
language plpgsql
stable
security definer
set search_path = ai_private
as $$
begin
  if session_user not in ('cv_worker', 'ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query select r.from_slug, r.to_slug, r.relation, r.weight from ai_private.concept_relations r;
end;
$$;

revoke all on function ai_private.worker_member_source(uuid) from public;
revoke all on function ai_private.worker_put_member_docs(uuid, bigint, int, jsonb, jsonb) from public;
revoke all on function ai_private.worker_job_source(uuid) from public;
revoke all on function ai_private.worker_put_job_ai(uuid, int, jsonb, jsonb) from public;
revoke all on function ai_private.worker_concepts() from public;
revoke all on function ai_private.worker_concept_relations() from public;
grant execute on function ai_private.worker_member_source(uuid) to cv_worker;
grant execute on function ai_private.worker_put_member_docs(uuid, bigint, int, jsonb, jsonb) to cv_worker;
grant execute on function ai_private.worker_job_source(uuid) to cv_worker;
grant execute on function ai_private.worker_put_job_ai(uuid, int, jsonb, jsonb) to cv_worker;
grant execute on function ai_private.worker_concepts() to cv_worker, ai_service;
grant execute on function ai_private.worker_concept_relations() to cv_worker, ai_service;

revoke all on all tables in schema ai_private from public, anon, authenticated;
