-- ════════════════════════════════════════════════════════════════════
-- Foundry · AI conversations, turns and results (AI-plan §4, §5, §8, §9, §10, §11)
--
-- The turn row is the authority (F1). A member's browser calls a server
-- action, which calls ai_submit_turn AS THE MEMBER: approval, flags, mode
-- eligibility, quotas, idempotency, queue and budget headroom are checked
-- there, atomically, and the queued row records who the turn is for. The
-- executor (ai_service, no ingress) claims a turn and gets a lease token
-- and fencing number; every executor function takes (turn, lease) and
-- derives the member and scope from the row, never from its caller, and
-- only accepts candidate ids from the set it was issued for that turn.
--
-- Chat history and everything derived from it expires 168 hours after
-- each message (§5.1), checked at read time as well as purged hourly.
-- Every table cascades from the member or job it belongs to (F30).
-- ════════════════════════════════════════════════════════════════════


-- ─── 1. Tables ──────────────────────────────────────────────────────
create table ai_private.conversations (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles(id) on delete cascade,
  mode              text not null check (mode in ('recruiter', 'network', 'opportunities')),
  opportunity_id    uuid references public.opportunities(id) on delete cascade,
  temporary         boolean not null default false,
  title             text check (title is null or length(title) <= 80),
  spec              jsonb not null default '{"schema_version": 1, "atoms": [], "next_id": 1}'::jsonb,
  spec_revision     int not null default 0,
  prev_spec         jsonb,
  pending_ops       jsonb,
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  check ((mode = 'recruiter') = (opportunity_id is not null))
);
create index conversations_owner_idx on ai_private.conversations (owner_id, mode, last_activity_at desc);
create index conversations_opportunity_idx on ai_private.conversations (opportunity_id) where opportunity_id is not null;
alter table ai_private.conversations enable row level security;

-- The source archive (§5.1): minimised member messages and templated
-- system replies. Never model prose.
create table ai_private.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references ai_private.conversations(id) on delete cascade,
  owner_id         uuid not null references public.profiles(id) on delete cascade,
  role             text not null check (role in ('member', 'system')),
  kind             text not null check (kind in ('message', 'results', 'refused', 'clarify', 'mixed',
                                                 'failed', 'notice')),
  body             text not null check (length(body) between 1 and 700),
  turn_id          uuid,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '168 hours',
  tsv              tsvector generated always as (to_tsvector('simple', body)) stored
);
create index messages_conversation_idx on ai_private.messages (conversation_id, created_at);
create index messages_owner_tsv_idx on ai_private.messages using gin (tsv);
create index messages_expiry_idx on ai_private.messages (expires_at);
alter table ai_private.messages enable row level security;

create table ai_private.turns (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references ai_private.conversations(id) on delete cascade,
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  mode               text not null check (mode in ('recruiter', 'network', 'opportunities')),
  opportunity_id     uuid references public.opportunities(id) on delete cascade,
  kind               text not null check (kind in ('message', 'run', 'confirm', 'rescan')),
  message_id         uuid references ai_private.messages(id) on delete set null,
  idempotency_key    text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  body_digest        text not null,
  expected_revision  int not null,
  status             text not null default 'queued'
                     check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled',
                                       'refused', 'clarify', 'expired')),
  stage              text check (stage in ('queued', 'understanding', 'searching', 'assessing', 'scoring', 'done')),
  outcome            text check (outcome is null or length(outcome) <= 40),
  cancel_requested   boolean not null default false,
  lease_token        uuid,
  fence              bigint not null default 0,
  lease_expires_at   timestamptz,
  deadline_at        timestamptz,
  attempts           int not null default 0,
  revision           int not null default 0,
  result_count       int not null default 0,
  provider_calls     int not null default 0,
  created_at         timestamptz not null default now(),
  claimed_at         timestamptz,
  finished_at        timestamptz,
  expires_at         timestamptz not null default now() + interval '168 hours',
  unique (owner_id, idempotency_key)
);
create index turns_queue_idx on ai_private.turns (created_at) where status = 'queued';
create index turns_running_idx on ai_private.turns (lease_expires_at) where status = 'running';
create index turns_owner_recent_idx on ai_private.turns (owner_id, created_at desc);
create index turns_conversation_idx on ai_private.turns (conversation_id, created_at desc);
create index turns_expiry_idx on ai_private.turns (expires_at);
alter table ai_private.turns enable row level security;

alter table ai_private.messages
  add constraint messages_turn_fk foreign key (turn_id) references ai_private.turns(id) on delete set null;
alter table ai_private.spend
  add constraint spend_turn_fk foreign key (turn_id) references ai_private.turns(id) on delete set null;
create index spend_turn_idx on ai_private.spend (turn_id) where turn_id is not null;
create index messages_turn_idx on ai_private.messages (turn_id) where turn_id is not null;

-- The candidate set issued to a turn. The executor may only ask about,
-- assess and publish ids in here.
create table ai_private.turn_candidates (
  turn_id             uuid not null references ai_private.turns(id) on delete cascade,
  target_member       uuid references public.profiles(id) on delete cascade,
  target_opportunity  uuid references public.opportunities(id) on delete cascade,
  rank                int not null,
  projection_hash     text,
  check ((target_member is null) <> (target_opportunity is null))
);
create unique index turn_candidates_member_uniq on ai_private.turn_candidates (turn_id, target_member) where target_member is not null;
create unique index turn_candidates_opp_uniq on ai_private.turn_candidates (turn_id, target_opportunity) where target_opportunity is not null;
create index turn_candidates_target_member_idx on ai_private.turn_candidates (target_member) where target_member is not null;
create index turn_candidates_target_opp_idx on ai_private.turn_candidates (target_opportunity) where target_opportunity is not null;
alter table ai_private.turn_candidates enable row level security;

create table ai_private.results (
  turn_id             uuid not null references ai_private.turns(id) on delete cascade,
  slot                int not null check (slot between 1 and 10),
  target_member       uuid references public.profiles(id) on delete cascade,
  target_opportunity  uuid references public.opportunities(id) on delete cascade,
  score               int check (score between 0 and 100),
  tier                text not null check (tier in ('meets', 'possible', 'partial')),
  exact_tier          int not null default 0,
  coverage            jsonb not null default '[]'::jsonb,
  components          jsonb not null default '{}'::jsonb,
  evidence_ids        bigint[] not null default '{}',
  projection_hash     text,
  created_at          timestamptz not null default now(),
  primary key (turn_id, slot),
  check ((target_member is null) <> (target_opportunity is null))
);
create index results_target_member_idx on ai_private.results (target_member) where target_member is not null;
create index results_target_opp_idx on ai_private.results (target_opportunity) where target_opportunity is not null;
alter table ai_private.results enable row level security;

-- Cached evidence judgements (§8). The key hashes everything the
-- judgement depends on; the row also carries the member/job so deletion
-- and withdrawal reach it.
create table ai_private.assessments (
  cache_key           text primary key check (length(cache_key) = 64),
  target_member       uuid references public.profiles(id) on delete cascade,
  target_opportunity  uuid references public.opportunities(id) on delete cascade,
  owner_id            uuid references public.profiles(id) on delete cascade,
  purpose             text not null check (purpose in ('recruiter', 'network', 'opportunities')),
  projection_hash     text not null,
  verdict             jsonb not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  check ((target_member is null) <> (target_opportunity is null))
);
create index assessments_member_idx on ai_private.assessments (target_member) where target_member is not null;
create index assessments_opp_idx on ai_private.assessments (target_opportunity) where target_opportunity is not null;
create index assessments_owner_idx on ai_private.assessments (owner_id) where owner_id is not null;
create index assessments_expiry_idx on ai_private.assessments (expires_at);
alter table ai_private.assessments enable row level security;

create table ai_private.query_embeddings (
  cache_key   text primary key check (length(cache_key) = 64),
  embedding   vector(1536) not null,
  model       text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days'
);
alter table ai_private.query_embeddings enable row level security;

-- Metadata-only traces (programme G9): no content.
create table ai_private.trace_spans (
  id            bigserial primary key,
  turn_id       uuid references ai_private.turns(id) on delete cascade,
  stage         text not null check (length(stage) <= 40),
  model         text,
  prompt_hash   text check (prompt_hash is null or length(prompt_hash) <= 64),
  input_tokens  int,
  output_tokens int,
  cost_micro    bigint,
  latency_ms    int,
  outcome       text not null check (outcome in ('ok', 'refused', 'timeout', 'invalid_output', 'provider_error',
                                                 'budget', 'skipped', 'cached')),
  attempt       int not null default 1,
  created_at    timestamptz not null default now()
);
create index trace_spans_turn_idx on ai_private.trace_spans (turn_id);
create index trace_spans_created_idx on ai_private.trace_spans (created_at);
alter table ai_private.trace_spans enable row level security;

-- Saved recruiter findings (§8.1): a pointer to a completed turn, seven
-- days from that turn, never renewed by reading.
create table ai_private.saved_scans (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles(id) on delete cascade,
  opportunity_id   uuid not null references public.opportunities(id) on delete cascade,
  conversation_id  uuid not null references ai_private.conversations(id) on delete cascade,
  turn_id          uuid not null references ai_private.turns(id) on delete cascade,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  unique (turn_id)
);
create index saved_scans_owner_idx on ai_private.saved_scans (owner_id, opportunity_id, created_at desc);
alter table ai_private.saved_scans enable row level security;

-- Quota counters, kept apart from the history the member can delete:
-- deleting a chat is not a quota reset (§11). Purged after a day.
create table ai_private.usage_events (
  id          bigserial primary key,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  mode        text not null,
  kind        text not null,
  created_at  timestamptz not null default now()
);
create index usage_events_owner_idx on ai_private.usage_events (owner_id, created_at desc);
alter table ai_private.usage_events enable row level security;

create table ai_private.surfaced_members (
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  member_id    uuid not null references public.profiles(id) on delete cascade,
  surfaced_at  timestamptz not null default now(),
  primary key (owner_id, member_id)
);
create index surfaced_members_owner_idx on ai_private.surfaced_members (owner_id, surfaced_at);
alter table ai_private.surfaced_members enable row level security;


-- ─── 2. Small helpers ───────────────────────────────────────────────
create or replace function ai_private.re_escape(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(p, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
$$;

-- Whole-token match, where "token" keeps C++, C#, .NET and Node.js whole.
create or replace function ai_private.text_mentions(p_text text, p_term text)
returns boolean
language sql
immutable
as $$
  select p_term is not null and length(p_term) > 0
     and lower(p_text) ~ ('(^|[^a-z0-9+#])' || ai_private.re_escape(lower(p_term)) || '($|[^a-z0-9+#])');
$$;

create or replace function ai_private.text_mentions_concept(p_text text, p_slug text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from ai_private.concepts c,
           lateral unnest(array_append(c.aliases, lower(c.label))) a
     where c.slug = p_slug and ai_private.text_mentions(p_text, a));
$$;

-- Contact details out of the archive before anything is stored (§3).
-- The executor applies the full policy again before any provider call.
create or replace function ai_private.redact_contact(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(p, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
             '(https?://|www\.)[^\s]+', '[link]', 'gi'),
           '\+?[0-9][0-9 ()-]{8,}[0-9]', '[number]', 'g');
$$;

-- Criteria that may not be searched on (§2, §13). A local screen; the
-- interpreter's own refusal is a second line, not the only one.
create or replace function ai_private.is_sensitive(p text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p, '')) ~ ('(^|[^a-z])(age|aged|young|old|older|younger|gender|male|female|man|woman|men|women|'
    || 'boy|girl|ethnic|ethnicity|race|racial|white|black|asian|nationality|national|citizen|religion|religious|'
    || 'christian|muslim|jewish|hindu|sikh|buddhist|atheist|gay|lesbian|straight|trans|transgender|sexuality|'
    || 'sexual|pregnan|maternity|disabled|disability|health|illness|mental|autis|adhd|dyslex|political|'
    || 'conservative|labour|tory|socialist|criminal|conviction|married|single|children|kids|visa|immigrant|'
    || 'accent|native)([^a-z]|$)');
$$;

-- Atoms whose chat source has expired drop out of the spec at read time
-- (§5.1): a criterion that has to be restated is never applied silently.
create or replace function ai_private.effective_spec(p_spec jsonb)
returns jsonb
language sql
stable
as $$
  select jsonb_set(p_spec, '{atoms}', coalesce((
    select jsonb_agg(a order by ord)
      from jsonb_array_elements(coalesce(p_spec->'atoms', '[]'::jsonb)) with ordinality as x(a, ord)
     where (a #>> '{source,expires_at}') is null
        or (a #>> '{source,expires_at}')::timestamptz > now()), '[]'::jsonb));
$$;

-- Labels for display come from the dictionary or from the member's own
-- validated words, never from model prose (§4).
create or replace function ai_private.spec_for_display(p_spec jsonb)
returns jsonb
language sql
stable
set search_path = ai_private, public
as $$
  select jsonb_build_object(
    'atoms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a->>'id', 'kind', a->>'kind', 'concept', a->>'concept',
               'label', coalesce((select c.label from ai_private.concepts c where c.slug = a->>'concept'), a->>'free_text'),
               'required', coalesce((a->>'required')::boolean, false),
               'negated', coalesce((a->>'negated')::boolean, false),
               'group', a->>'group',
               'source', a #>> '{source,type}',
               'expires_at', a #>> '{source,expires_at}') order by ord)
        from jsonb_array_elements(coalesce(ai_private.effective_spec(p_spec)->'atoms', '[]'::jsonb))
             with ordinality as x(a, ord)), '[]'::jsonb),
    'audience', coalesce(p_spec->'audience', 'null'::jsonb),
    'transferable', coalesce((p_spec->>'transferable')::boolean, false));
$$;

revoke all on function ai_private.re_escape(text) from public;
revoke all on function ai_private.text_mentions(text, text) from public;
revoke all on function ai_private.text_mentions_concept(text, text) from public;
revoke all on function ai_private.redact_contact(text) from public;
revoke all on function ai_private.is_sensitive(text) from public;
revoke all on function ai_private.effective_spec(jsonb) from public;
revoke all on function ai_private.spec_for_display(jsonb) from public;


-- ─── 3. Eligibility (one place, used at retrieval, publish and read) ─
create or replace function ai_private.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.connections c
                  where least(c.requester_id, c.addressee_id) = least(p_a, p_b)
                    and greatest(c.requester_id, c.addressee_id) = greatest(p_a, p_b)
                    and c.status = 'blocked');
$$;

-- An owned, approved, open job made through the member flow (F18).
create or replace function ai_private.recruiter_job_ok(p_member uuid, p_opportunity uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.opportunities o
                  where o.id = p_opportunity and o.posted_by = p_member and o.status = 'approved'
                    and o.application_deadline >= current_date and o.creation_source = 'member'
                    and o.eligible_audience is not null);
$$;

-- Effective recruiter audience: the job's audience narrowed by the
-- recruiter's choice, never widened (§5).
create or replace function ai_private.recruiter_audience(p_opportunity uuid, p_spec jsonb)
returns text[]
language sql
stable
set search_path = public
as $$
  with job as (
    select case o.eligible_audience when 'both' then array['students', 'graduates']
                                    when 'students' then array['students']
                                    when 'graduates' then array['graduates']
                                    else array[]::text[] end as allowed
      from public.opportunities o where o.id = p_opportunity
  )
  select case when jsonb_typeof(p_spec->'audience') = 'array'
              then array(select x from jsonb_array_elements_text(p_spec->'audience') x, job
                          where x = any(job.allowed))
              else (select allowed from job) end;
$$;

create or replace function ai_private.member_in_audience(p_member uuid, p_audience text[])
returns boolean
language sql
stable
set search_path = public
as $$
  select ('students' = any(p_audience) and public.member_admits_audience(p_member, 'students'))
      or ('graduates' = any(p_audience) and public.member_admits_audience(p_member, 'graduates'));
$$;

create or replace function ai_private.member_candidate_ok(p_owner uuid, p_mode text, p_target uuid,
                                                          p_opportunity uuid, p_spec jsonb)
returns boolean
language sql
stable
set search_path = ai_private, public
as $$
  select p_target <> p_owner
     and exists (select 1 from public.profiles p
                  where p.id = p_target and p.status = 'approved' and not p.is_committee
                    and (p_mode <> 'network' or p.open_to_connections))
     and exists (select 1 from ai_private.member_docs d
                  where d.member_id = p_target and d.purpose = p_mode)
     and not ai_private.blocked_between(p_owner, p_target)
     and (p_mode <> 'recruiter'
          or ai_private.member_in_audience(p_target, ai_private.recruiter_audience(p_opportunity, p_spec)));
$$;

create or replace function ai_private.job_candidate_ok(p_owner uuid, p_target uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.opportunities o
                  where o.id = p_target and o.status = 'approved' and o.application_deadline >= current_date
                    and o.posted_by <> p_owner
                    and public.member_admits_audience(p_owner, o.eligible_audience));
$$;

revoke all on function ai_private.blocked_between(uuid, uuid) from public;
revoke all on function ai_private.recruiter_job_ok(uuid, uuid) from public;
revoke all on function ai_private.recruiter_audience(uuid, jsonb) from public;
revoke all on function ai_private.member_in_audience(uuid, text[]) from public;
revoke all on function ai_private.member_candidate_ok(uuid, text, uuid, uuid, jsonb) from public;
revoke all on function ai_private.job_candidate_ok(uuid, uuid) from public;


-- ─── 4. Applying criteria operations (the one grammar, §5) ───────────
-- Every change to a spec, whether a chip edit, a confirmed proposal or
-- the interpreter's validated output, goes through here. p_message is the
-- turn's own minimised message when the ops came from the interpreter:
-- every concept must then be mentioned in it (or already be in the spec)
-- and every free-text criterion must be the exact span it cites. A chip
-- picked from the dictionary passes p_message null and p_from_command.
create or replace function ai_private.apply_spec_ops(
  p_spec jsonb, p_ops jsonb, p_mode text, p_message text, p_message_id uuid,
  p_message_expires timestamptz, p_from_command boolean
)
returns jsonb
language plpgsql
stable
set search_path = ai_private, public
as $$
declare
  v_spec    jsonb := ai_private.effective_spec(coalesce(p_spec, '{"schema_version": 1, "atoms": [], "next_id": 1}'::jsonb));
  v_atoms   jsonb := coalesce(v_spec->'atoms', '[]'::jsonb);
  v_next    int := coalesce((v_spec->>'next_id')::int, 1);
  op        jsonb;
  v_kind    text;
  v_concept text;
  v_free    text;
  v_group   text;
  v_source  jsonb;
  v_start   int;
  v_end     int;
  v_allowed text[];
  v_ckind   text;
begin
  v_allowed := case p_mode
    when 'recruiter'     then array['tool', 'method', 'area', 'language', 'free']
    when 'network'       then array['tool', 'method', 'area', 'language', 'interest', 'free', 'seek', 'offer']
    when 'opportunities' then array['tool', 'method', 'area', 'language', 'free', 'location', 'role_type']
  end;

  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 16 then
    raise exception 'invalid_ops' using errcode = '22023';
  end if;

  for op in select * from jsonb_array_elements(p_ops) loop
    case op->>'op'
    when 'clear' then
      v_atoms := '[]'::jsonb;

    when 'remove' then
      v_atoms := coalesce((select jsonb_agg(a) from jsonb_array_elements(v_atoms) a
                            where a->>'id' <> op->>'atom'), '[]'::jsonb);

    when 'set_required' then
      v_atoms := coalesce((select jsonb_agg(case when a->>'id' = op->>'atom'
                                                 then a || jsonb_build_object('required', (op->>'required')::boolean)
                                                 else a end)
                             from jsonb_array_elements(v_atoms) a), '[]'::jsonb);

    when 'set_audience' then
      if p_mode <> 'recruiter' or jsonb_typeof(op->'audience') <> 'array'
         or jsonb_array_length(op->'audience') = 0
         or exists (select 1 from jsonb_array_elements_text(op->'audience') x where x not in ('students', 'graduates')) then
        raise exception 'invalid_audience' using errcode = '22023';
      end if;
      v_spec := jsonb_set(v_spec, '{audience}', op->'audience');

    when 'set_transferable' then
      v_spec := jsonb_set(v_spec, '{transferable}', to_jsonb(coalesce((op->>'value')::boolean, false)));

    when 'add' then
      v_kind := op->>'kind';
      v_concept := nullif(op->>'concept', '');
      v_free := nullif(btrim(coalesce(op->>'free_text', '')), '');
      if v_kind is null or not (v_kind = any(v_allowed)) then
        raise exception 'kind_not_allowed: %', v_kind using errcode = '22023';
      end if;

      if v_kind in ('location', 'role_type') then
        if v_concept is null or not (
             (v_kind = 'location' and v_concept in ('remote', 'hybrid', 'onsite'))
          or (v_kind = 'role_type' and v_concept in ('internship', 'placement', 'graduate', 'part_time',
                                                     'full_time', 'contract', 'cofounder'))) then
          raise exception 'invalid_preference' using errcode = '22023';
        end if;
        v_free := null;
      elsif v_concept is not null then
        select c.kind into v_ckind from ai_private.concepts c where c.slug = v_concept;
        if v_ckind is null then
          raise exception 'unknown_concept' using errcode = '22023';
        end if;
        -- seek/offer atoms point at a concept of any kind; others must agree.
        if v_kind not in ('seek', 'offer') and v_ckind <> v_kind then
          v_kind := v_ckind;
          if not (v_kind = any(v_allowed)) then
            raise exception 'kind_not_allowed: %', v_kind using errcode = '22023';
          end if;
        end if;
        if not p_from_command and not ai_private.text_mentions_concept(coalesce(p_message, ''), v_concept) then
          raise exception 'ungrounded_concept' using errcode = '22023';
        end if;
        v_free := null;
      elsif v_free is not null then
        if v_kind not in ('free', 'seek', 'offer') then
          raise exception 'free_text_kind' using errcode = '22023';
        end if;
        if length(v_free) > 80 or ai_private.is_sensitive(v_free) then
          raise exception 'free_text_rejected' using errcode = '22023';
        end if;
        if not p_from_command then
          v_start := (op->'span'->>0)::int;
          v_end := (op->'span'->>1)::int;
          if v_start is null or v_end is null or v_start < 0 or v_end <= v_start
             or substr(coalesce(p_message, ''), v_start + 1, v_end - v_start) <> v_free then
            raise exception 'ungrounded_free_text' using errcode = '22023';
          end if;
        end if;
      else
        raise exception 'empty_atom' using errcode = '22023';
      end if;

      -- The same criterion twice is one criterion.
      if exists (select 1 from jsonb_array_elements(v_atoms) a
                  where coalesce(a->>'concept', '') = coalesce(v_concept, '')
                    and lower(coalesce(a->>'free_text', '')) = lower(coalesce(v_free, ''))
                    and a->>'kind' = v_kind) then
        continue;
      end if;

      v_group := nullif(op->>'group', '');
      if v_group is not null and v_group !~ '^g[1-4]$' then
        raise exception 'invalid_group' using errcode = '22023';
      end if;

      v_source := case
        when p_from_command then jsonb_build_object('type', 'command')
        else jsonb_build_object('type', 'message', 'message_id', p_message_id, 'expires_at', p_message_expires)
      end;

      v_atoms := v_atoms || jsonb_build_array(jsonb_build_object(
        'id', 'a' || v_next, 'kind', v_kind, 'concept', v_concept, 'free_text', v_free,
        'required', coalesce((op->>'required')::boolean, false),
        'negated', coalesce((op->>'negated')::boolean, false),
        'group', v_group, 'source', v_source));
      v_next := v_next + 1;

    else
      raise exception 'unknown_op' using errcode = '22023';
    end case;
  end loop;

  -- Limits (§5): 12 atoms, 4 flat OR groups, every group with 2+ members.
  if jsonb_array_length(v_atoms) > 12 then
    raise exception 'too_many_criteria' using errcode = '22023';
  end if;
  if (select count(distinct a->>'group') from jsonb_array_elements(v_atoms) a where a->>'group' is not null) > 4 then
    raise exception 'too_many_groups' using errcode = '22023';
  end if;
  -- A negated criterion is a hard exclusion, never a preference.
  v_atoms := coalesce((select jsonb_agg(case when (a->>'negated')::boolean
                                             then a || '{"required": true, "group": null}'::jsonb else a end)
                         from jsonb_array_elements(v_atoms) a), '[]'::jsonb);

  return jsonb_build_object('schema_version', 1, 'atoms', v_atoms, 'next_id', v_next)
      || case when v_spec ? 'audience' then jsonb_build_object('audience', v_spec->'audience') else '{}'::jsonb end
      || case when v_spec ? 'transferable' then jsonb_build_object('transferable', v_spec->'transferable') else '{}'::jsonb end;
end;
$$;
revoke all on function ai_private.apply_spec_ops(jsonb, jsonb, text, text, uuid, timestamptz, boolean) from public;


-- ─── 5. Member-facing RPCs ──────────────────────────────────────────
create or replace function public.ai_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
declare
  v_uid uuid := auth.uid();
  v_day int;
  v_oldest timestamptz;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  select count(*), min(created_at) into v_day, v_oldest
    from ai_private.usage_events where owner_id = v_uid and created_at > now() - interval '24 hours';

  return jsonb_build_object(
    'enabled', jsonb_build_object(
      'recruiter', public.ai_mode_enabled('recruiter'),
      'network', public.ai_mode_enabled('network'),
      'opportunities', public.ai_mode_enabled('opportunities')),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'title', o.position_name, 'company', o.company,
               'deadline', o.application_deadline, 'audience', o.eligible_audience,
               'requirements', coalesce((select r.status from ai_private.job_requirements r
                                          where r.opportunity_id = o.id and r.content_version = o.content_version),
                                        'pending')) order by o.application_deadline)
        from public.opportunities o
       where o.posted_by = v_uid and o.status = 'approved' and o.application_deadline >= current_date
         and o.creation_source = 'member' and o.eligible_audience is not null), '[]'::jsonb),
    'quota', jsonb_build_object('used', v_day, 'limit', 40,
                                'resets_at', case when v_day >= 40 then v_oldest + interval '24 hours' end),
    'education_known', exists (select 1 from public.member_education e where e.member_id = v_uid));
end;
$$;

create or replace function public.ai_list_conversations(p_mode text)
returns table (id uuid, title text, opportunity_id uuid, temporary boolean, last_activity_at timestamptz,
               expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  return query
    select c.id, c.title, c.opportunity_id, c.temporary, c.last_activity_at,
           (select max(m.expires_at) from ai_private.messages m where m.conversation_id = c.id)
      from ai_private.conversations c
     where c.owner_id = (select auth.uid()) and c.mode = p_mode
       and exists (select 1 from ai_private.messages m where m.conversation_id = c.id and m.expires_at > now())
     order by c.last_activity_at desc
     limit 20;
end;
$$;

create or replace function public.ai_get_conversation(p_conversation uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_conv ai_private.conversations;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  select * into v_conv from ai_private.conversations where id = p_conversation and owner_id = v_uid;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_conv.id, 'mode', v_conv.mode, 'temporary', v_conv.temporary, 'title', v_conv.title,
    'spec', ai_private.spec_for_display(v_conv.spec), 'spec_revision', v_conv.spec_revision,
    'can_undo', v_conv.prev_spec is not null,
    'pending', v_conv.pending_ops is not null,
    'job', (select jsonb_build_object('id', o.id, 'title', o.position_name, 'company', o.company,
                                      'audience', o.eligible_audience,
                                      'open', ai_private.recruiter_job_ok(v_uid, o.id))
              from public.opportunities o where o.id = v_conv.opportunity_id),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'kind', m.kind, 'body', m.body,
                                          'turn_id', m.turn_id, 'created_at', m.created_at,
                                          'expires_at', m.expires_at) order by m.created_at)
        from ai_private.messages m where m.conversation_id = v_conv.id and m.expires_at > now()), '[]'::jsonb),
    'turns', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'status', t.status, 'stage', t.stage,
                                          'outcome', t.outcome, 'result_count', t.result_count,
                                          'created_at', t.created_at, 'finished_at', t.finished_at,
                                          'saved', exists (select 1 from ai_private.saved_scans s
                                                            where s.turn_id = t.id and s.expires_at > now()))
                       order by t.created_at)
        from (select * from ai_private.turns t2 where t2.conversation_id = v_conv.id and t2.expires_at > now()
               order by t2.created_at desc limit 20) t), '[]'::jsonb));
end;
$$;

-- Admission (§9, §9.1, §10). Returns one row: the turn (new or the
-- existing one for a repeated idempotency key) or a refusal reason with,
-- where it applies, when the member can try again.
create or replace function public.ai_submit_turn(
  p_mode               text,
  p_conversation       uuid,
  p_opportunity        uuid,
  p_kind               text,
  p_message            text,
  p_idempotency_key    text,
  p_expected_revision  int,
  p_temporary          boolean default false
)
returns table (turn_id uuid, conversation_id uuid, outcome text, retry_at timestamptz)
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid       uuid := auth.uid();
  v_conv      ai_private.conversations;
  v_cfg       ai_private.settings;
  v_msg       text;
  v_digest    text;
  v_existing  ai_private.turns;
  v_count     int;
  v_oldest    timestamptz;
  v_surfaced  int;
  v_msg_id    uuid;
  v_turn      uuid;
  v_estimate  bigint;
  v_spent     bigint;
  v_member    bigint;
  v_day       date := (now() at time zone 'utc')::date;
  v_tomorrow  timestamptz := ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
  v_unconfirmed boolean;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  if p_mode not in ('recruiter', 'network', 'opportunities') or p_kind not in ('message', 'run', 'confirm', 'rescan') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Cheap checks first; nothing below writes until every check passes.
  v_msg := nullif(btrim(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]', ' ', 'g')), '');
  if p_kind = 'message' and (v_msg is null or char_length(v_msg) > 600) then
    return query select null::uuid, p_conversation, 'invalid_message'::text, null::timestamptz;
    return;
  end if;
  if p_kind <> 'message' then
    v_msg := null;
  end if;

  v_digest := encode(sha256(convert_to(concat_ws('|', p_mode, p_conversation, p_opportunity, p_kind, v_msg,
                                                 p_expected_revision, p_temporary), 'utf8')), 'hex');
  select * into v_existing from ai_private.turns t where t.owner_id = v_uid and t.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.body_digest = v_digest then
      return query select v_existing.id, v_existing.conversation_id, 'duplicate'::text, null::timestamptz;
    else
      return query select null::uuid, p_conversation, 'idempotency_conflict'::text, null::timestamptz;
    end if;
    return;
  end if;

  if not public.ai_mode_enabled(p_mode) then
    return query select null::uuid, p_conversation, 'disabled'::text, null::timestamptz;
    return;
  end if;

  if p_mode = 'recruiter' then
    if p_opportunity is null or not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
      return query select null::uuid, p_conversation, 'job_not_eligible'::text, null::timestamptz;
      return;
    end if;
    if not exists (select 1 from ai_private.job_requirements r join public.opportunities o on o.id = r.opportunity_id
                    where r.opportunity_id = p_opportunity and r.status = 'confirmed'
                      and r.content_version = o.content_version) then
      return query select null::uuid, p_conversation, 'requirements_unconfirmed'::text, null::timestamptz;
      return;
    end if;
  elsif p_opportunity is not null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Conversation: existing (owner, mode and job must match; compare-and-
  -- swap on the spec revision) or a new one.
  if p_conversation is not null then
    select * into v_conv from ai_private.conversations c
     where c.id = p_conversation and c.owner_id = v_uid for update;
    if not found or v_conv.mode <> p_mode or v_conv.opportunity_id is distinct from p_opportunity then
      return query select null::uuid, p_conversation, 'not_found'::text, null::timestamptz;
      return;
    end if;
    if v_conv.spec_revision <> coalesce(p_expected_revision, -1) then
      return query select null::uuid, p_conversation, 'stale_revision'::text, null::timestamptz;
      return;
    end if;
    if (select count(*) from ai_private.turns t where t.conversation_id = v_conv.id and t.expires_at > now()
          and t.status in ('completed', 'partial', 'refused', 'clarify', 'failed', 'queued', 'running')) >= 15 then
      return query select null::uuid, v_conv.id, 'thread_full'::text, null::timestamptz;
      return;
    end if;
    if p_kind = 'confirm' and v_conv.pending_ops is null then
      return query select null::uuid, v_conv.id, 'nothing_to_confirm'::text, null::timestamptz;
      return;
    end if;
  else
    if p_kind not in ('message') then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    if (select count(*) from ai_private.conversations c
         where c.owner_id = v_uid
           and exists (select 1 from ai_private.messages m where m.conversation_id = c.id and m.expires_at > now())) >= 5 then
      return query select null::uuid, null::uuid, 'too_many_threads'::text, null::timestamptz;
      return;
    end if;
  end if;

  -- Concurrency: one running turn per conversation, two per member.
  if p_conversation is not null and exists (select 1 from ai_private.turns t
                where t.conversation_id = p_conversation and t.status in ('queued', 'running')) then
    return query select null::uuid, p_conversation, 'busy'::text, null::timestamptz;
    return;
  end if;
  if (select count(*) from ai_private.turns t where t.owner_id = v_uid and t.status in ('queued', 'running')) >= 2 then
    return query select null::uuid, p_conversation, 'busy'::text, null::timestamptz;
    return;
  end if;

  -- Rates: 5 a minute, 40 a rolling day, shared by every mode (§9).
  select count(*), min(u.created_at) into v_count, v_oldest
    from ai_private.usage_events u where u.owner_id = v_uid and u.created_at > now() - interval '1 minute';
  if v_count >= 5 then
    return query select null::uuid, p_conversation, 'rate_minute'::text, v_oldest + interval '1 minute';
    return;
  end if;
  select count(*), min(u.created_at) into v_count, v_oldest
    from ai_private.usage_events u where u.owner_id = v_uid and u.created_at > now() - interval '24 hours';
  if v_count >= 40 then
    return query select null::uuid, p_conversation, 'rate_day'::text, v_oldest + interval '24 hours';
    return;
  end if;

  -- Rescans (§8.1): five-minute cooldown, ten a day per job.
  if p_kind = 'rescan' then
    if p_mode <> 'recruiter' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    select count(*), max(u.created_at) into v_count, v_oldest
      from ai_private.usage_events u
     where u.owner_id = v_uid and u.kind = 'rescan:' || p_opportunity::text
       and u.created_at > now() - interval '24 hours';
    if v_oldest is not null and v_oldest > now() - interval '5 minutes' then
      return query select null::uuid, p_conversation, 'rescan_cooldown'::text, v_oldest + interval '5 minutes';
      return;
    end if;
    if v_count >= 10 then
      return query select null::uuid, p_conversation, 'rescan_limit'::text, now() + interval '24 hours';
      return;
    end if;
  end if;

  -- Distinct members surfaced, checked before any money is reserved (F7).
  if p_mode in ('recruiter', 'network') then
    select count(*) into v_surfaced
      from ai_private.surfaced_members sm
     where sm.owner_id = v_uid and sm.surfaced_at > now() - interval '24 hours';
    if v_surfaced + 10 > 150 then
      return query select null::uuid, p_conversation, 'surface_limit'::text, now() + interval '24 hours';
      return;
    end if;
  end if;

  -- Queue bound (§9): refuse before any provider call, keep the draft.
  select * into v_cfg from ai_private.settings where id = 1;
  if (select count(*) from ai_private.turns t where t.status = 'queued') >= v_cfg.queue_capacity then
    return query select null::uuid, p_conversation, 'queue_full'::text, now() + interval '1 minute';
    return;
  end if;

  -- Budget headroom for this turn's worst case: interpreter + four
  -- assessors + one embedding, at current prices. Reservations happen
  -- per call in the executor; this only refuses a turn that cannot fit.
  select bool_or(not mp.confirmed),
         coalesce(sum(case mp.model
                        when 'gpt-5.4-mini' then (6000 * mp.input_micro_per_mtok + 1500 * mp.output_micro_per_mtok)
                        when 'gpt-5.4' then 4 * (12000 * mp.input_micro_per_mtok + 3000 * mp.output_micro_per_mtok)
                        when 'text-embedding-3-small' then 2000 * mp.input_micro_per_mtok
                      end), 0) / 1000000
    into v_unconfirmed, v_estimate
    from ai_private.model_prices mp
   where mp.model in ('gpt-5.4-mini', 'gpt-5.4', 'text-embedding-3-small');
  select coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching'), 0),
         coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching' and s.member_id = v_uid), 0)
    into v_spent, v_member
    from ai_private.spend s where s.day = v_day;
  if v_spent + v_estimate > v_cfg.matching_daily_cap_micro or v_member + v_estimate > v_cfg.member_daily_cap_micro then
    return query select null::uuid, p_conversation, 'budget_exhausted'::text, v_tomorrow;
    return;
  end if;

  -- No names as search criteria (§1): a member's full name in the
  -- message is refused, and the text is not stored.
  if v_msg is not null and exists (
       select 1 from public.profiles p
        where p.status = 'approved' and length(p.first_name) > 1 and length(p.surname) > 1
          and lower(v_msg) like '%' || lower(p.first_name || ' ' || p.surname) || '%') then
    return query select null::uuid, p_conversation, 'named_person'::text, null::timestamptz;
    return;
  end if;

  -- Admitted.
  if p_conversation is null then
    insert into ai_private.conversations (owner_id, mode, opportunity_id, temporary, title, spec)
    values (v_uid, p_mode, p_opportunity, coalesce(p_temporary, false),
            left(ai_private.redact_contact(v_msg), 60),
            case when p_mode = 'recruiter'
                 then (select jsonb_build_object('schema_version', 1, 'next_id', 100,
                                                 'atoms', coalesce(r.confirmed, '[]'::jsonb))
                         from ai_private.job_requirements r where r.opportunity_id = p_opportunity)
                 else '{"schema_version": 1, "atoms": [], "next_id": 1}'::jsonb end)
    returning * into v_conv;
  end if;

  if v_msg is not null then
    insert into ai_private.messages (conversation_id, owner_id, role, kind, body)
    values (v_conv.id, v_uid, 'member', 'message', left(ai_private.redact_contact(v_msg), 700))
    returning id into v_msg_id;
  end if;

  insert into ai_private.turns (conversation_id, owner_id, mode, opportunity_id, kind, message_id,
                                idempotency_key, body_digest, expected_revision, stage)
  values (v_conv.id, v_uid, p_mode, p_opportunity, p_kind, v_msg_id, p_idempotency_key, v_digest,
          v_conv.spec_revision, 'queued')
  returning id into v_turn;

  update ai_private.messages set turn_id = v_turn where id = v_msg_id;
  update ai_private.conversations set last_activity_at = now() where id = v_conv.id;
  insert into ai_private.usage_events (owner_id, mode, kind)
  values (v_uid, p_mode, case when p_kind = 'rescan' then 'rescan:' || p_opportunity::text else p_kind end);

  return query select v_turn, v_conv.id, 'queued'::text, null::timestamptz;
end;
$$;

create or replace function public.ai_turn_status(p_turn uuid)
returns table (status text, stage text, outcome text, revision int, conversation_id uuid,
               result_count int, finished boolean)
language sql
stable
security definer
set search_path = public, ai_private
as $$
  select t.status, t.stage, t.outcome, t.revision, t.conversation_id, t.result_count,
         t.status not in ('queued', 'running')
    from ai_private.turns t
   where t.id = p_turn and t.owner_id = (select auth.uid()) and t.expires_at > now();
$$;

create or replace function public.ai_cancel_turn(p_turn uuid)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
begin
  -- Queued work never starts. Running work stops before its next provider
  -- call; a call already dispatched may still be billed (§9).
  update ai_private.turns
     set status = case when status = 'queued' then 'cancelled' else status end,
         outcome = case when status = 'queued' then 'cancelled' else outcome end,
         finished_at = case when status = 'queued' then now() else finished_at end,
         cancel_requested = true, revision = revision + 1
   where id = p_turn and owner_id = (select auth.uid()) and status in ('queued', 'running');
end;
$$;

-- Chip edits: typed operations, no model call, no run (§8). Running the
-- edited search is a separate, budgeted turn.
create or replace function public.ai_edit_spec(p_conversation uuid, p_expected_revision int, p_ops jsonb)
returns table (spec jsonb, spec_revision int)
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_conv ai_private.conversations;
  v_new  jsonb;
  v_edits int;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  select * into v_conv from ai_private.conversations c where c.id = p_conversation and c.owner_id = v_uid for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_conv.spec_revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  if exists (select 1 from ai_private.turns t where t.conversation_id = v_conv.id and t.status in ('queued', 'running')) then
    raise exception 'busy' using errcode = '55006';
  end if;

  -- 200 validated draft edits a day, counted on the conversations the
  -- member owns (§9).
  select coalesce(sum((c.spec->>'edits_today')::int) filter (where (c.spec->>'edits_day') = current_date::text), 0)
    into v_edits from ai_private.conversations c where c.owner_id = v_uid;
  if v_edits >= 200 then
    raise exception 'edit_limit' using errcode = '54000';
  end if;

  if p_ops = '[{"op": "undo"}]'::jsonb then
    if v_conv.prev_spec is null then
      raise exception 'nothing_to_undo' using errcode = '22023';
    end if;
    v_new := v_conv.prev_spec;
  elsif p_ops = '[{"op": "confirm_pending"}]'::jsonb then
    raise exception 'invalid_ops' using errcode = '22023';
  else
    v_new := ai_private.apply_spec_ops(v_conv.spec, p_ops, v_conv.mode, null, null, null, true);
  end if;

  v_new := v_new || jsonb_build_object(
    'edits_day', current_date::text,
    'edits_today', case when (v_conv.spec->>'edits_day') = current_date::text
                        then coalesce((v_conv.spec->>'edits_today')::int, 0) + 1 else 1 end);

  update ai_private.conversations
     set prev_spec = case when p_ops = '[{"op": "undo"}]'::jsonb then null else v_conv.spec end,
         spec = v_new, spec_revision = v_conv.spec_revision + 1, pending_ops = null,
         last_activity_at = now()
   where id = v_conv.id;

  return query select ai_private.spec_for_display(v_new), v_conv.spec_revision + 1;
end;
$$;

create or replace function public.ai_delete_conversation(p_conversation uuid)
returns void
language sql
security definer
set search_path = public, ai_private
as $$
  delete from ai_private.conversations where id = p_conversation and owner_id = (select auth.uid());
$$;

-- Deletion is not a quota reset: usage_events and surfaced_members are
-- separate and kept for the rolling day.
create or replace function public.ai_delete_all_history()
returns void
language sql
security definer
set search_path = public, ai_private
as $$
  delete from ai_private.conversations where owner_id = (select auth.uid());
$$;

-- Forget one message: it leaves the archive and any criterion it was the
-- source of leaves the spec at once (§5.1).
create or replace function public.ai_forget_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_conv uuid;
begin
  delete from ai_private.messages m
   where m.id = p_message and m.owner_id = v_uid and m.role = 'member'
  returning m.conversation_id into v_conv;
  if v_conv is null then
    return;
  end if;
  update ai_private.conversations c
     set spec = jsonb_set(c.spec, '{atoms}', coalesce((
                  select jsonb_agg(a) from jsonb_array_elements(c.spec->'atoms') a
                   where (a #>> '{source,message_id}') is distinct from p_message::text), '[]'::jsonb)),
         prev_spec = null, spec_revision = c.spec_revision + 1
   where c.id = v_conv;
end;
$$;

create or replace function public.ai_save_findings(p_turn uuid)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_turn ai_private.turns;
begin
  select * into v_turn from ai_private.turns t
   where t.id = p_turn and t.owner_id = (select auth.uid()) and t.mode = 'recruiter'
     and t.status in ('completed', 'partial') and t.expires_at > now();
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into ai_private.saved_scans (owner_id, opportunity_id, conversation_id, turn_id, expires_at)
  values (v_turn.owner_id, v_turn.opportunity_id, v_turn.conversation_id, v_turn.id, v_turn.created_at + interval '168 hours')
  on conflict (turn_id) do nothing;
end;
$$;

-- Cards, re-authorised on every read (§6, §11). A candidate who withdrew,
-- was banned, blocked either side, or left the audience is not returned;
-- a changed projection is returned as stale with no evidence attached.
create or replace function public.ai_result_cards(p_turn uuid)
returns table (slot int, kind text, target_id uuid, title text, subtitle text, avatar_path text,
               score int, tier text, exact_tier int, coverage jsonb, components jsonb, evidence jsonb,
               stale boolean, change text, extra jsonb)
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_turn ai_private.turns;
  v_conv ai_private.conversations;
  v_prev uuid;
begin
  if not public.is_approved() then
    raise exception 'Forbidden: approved members only' using errcode = '42501';
  end if;
  select * into v_turn from ai_private.turns t
   where t.id = p_turn and t.owner_id = v_uid and t.expires_at > now() and t.status in ('completed', 'partial');
  if not found then
    return;
  end if;
  select * into v_conv from ai_private.conversations where id = v_turn.conversation_id;
  if v_turn.mode = 'recruiter' and not ai_private.recruiter_job_ok(v_uid, v_turn.opportunity_id) then
    return;
  end if;

  -- The previous completed turn in this conversation, for New/Updated.
  select t.id into v_prev from ai_private.turns t
   where t.conversation_id = v_turn.conversation_id and t.status in ('completed', 'partial')
     and t.created_at < v_turn.created_at and t.expires_at > now()
   order by t.created_at desc limit 1;

  if v_turn.mode in ('recruiter', 'network') then
    return query
      select r.slot, 'member'::text, r.target_member,
             trim(coalesce(nullif(p.preferred_name, ''), p.first_name) || ' ' || p.surname),
             concat_ws(' · ', initcap(replace(p.role::text, '_', ' ')), p.course),
             p.avatar_path, r.score, r.tier, r.exact_tier,
             (select coalesce(jsonb_agg(c || jsonb_build_object(
                       'label', coalesce((select k.label from ai_private.concepts k where k.slug = c->>'concept'),
                                         c->>'free_text'))), '[]'::jsonb)
                from jsonb_array_elements(r.coverage) c),
             r.components,
             case when d.projection_hash is distinct from r.projection_hash then '[]'::jsonb else coalesce((
               select jsonb_agg(jsonb_build_object('text', left(e.text, 200), 'kind', e.source_kind,
                                                   'from_cv', e.from_cv))
                 from (select e2.* from ai_private.member_evidence e2
                        where e2.id = any(r.evidence_ids) and e2.member_id = r.target_member
                          and e2.purpose = v_turn.mode and e2.polarity = 'positive'
                          and (not e2.from_cv or (v_turn.mode = 'recruiter' and coalesce(ms.evidence_sharing, false)))
                        order by e2.id limit 2) e), '[]'::jsonb) end,
             d.projection_hash is distinct from r.projection_hash,
             case when v_prev is null then null
                  when not exists (select 1 from ai_private.results pr where pr.turn_id = v_prev
                                    and pr.target_member = r.target_member) then 'new'
                  when exists (select 1 from ai_private.results pr where pr.turn_id = v_prev
                                and pr.target_member = r.target_member
                                and pr.projection_hash is distinct from r.projection_hash) then 'updated'
                  else 'same' end,
             '{}'::jsonb
        from ai_private.results r
        join public.profiles p on p.id = r.target_member
        left join ai_private.member_docs d on d.member_id = r.target_member and d.purpose = v_turn.mode
        left join ai_private.member_settings ms on ms.member_id = r.target_member
       where r.turn_id = v_turn.id
         and ai_private.member_candidate_ok(v_uid, v_turn.mode, r.target_member, v_turn.opportunity_id, v_conv.spec)
       order by r.slot;
  else
    return query
      select r.slot, 'opportunity'::text, r.target_opportunity,
             o.position_name, o.company, null::text, r.score, r.tier, r.exact_tier,
             (select coalesce(jsonb_agg(c || jsonb_build_object(
                       'label', coalesce((select k.label from ai_private.concepts k where k.slug = c->>'concept'),
                                         c->>'free_text'))), '[]'::jsonb)
                from jsonb_array_elements(r.coverage) c),
             r.components, '[]'::jsonb,
             jd.content_version is distinct from (r.components->>'content_version')::int,
             case when v_prev is null then null
                  when not exists (select 1 from ai_private.results pr where pr.turn_id = v_prev
                                    and pr.target_opportunity = r.target_opportunity) then 'new'
                  else 'same' end,
             jsonb_build_object('deadline', o.application_deadline, 'location_type', o.location_type,
                                'location_text', o.location_text, 'pay', o.pay,
                                'apply_method', o.apply_method, 'apply_url', o.apply_url,
                                'contact_email', case when o.contact_email_visible then o.contact_email end,
                                'audience', o.eligible_audience,
                                'applied', exists (select 1 from public.user_listing_actions a
                                                    where a.user_id = v_uid and a.listing_kind = 'opportunity'
                                                      and a.listing_id = o.id and a.action_type = 'applied'),
                                'sparse', length(o.description) < 200)
        from ai_private.results r
        join public.opportunities o on o.id = r.target_opportunity
        left join ai_private.job_docs jd on jd.opportunity_id = o.id
       where r.turn_id = v_turn.id and ai_private.job_candidate_ok(v_uid, r.target_opportunity)
       order by r.slot;
  end if;
end;
$$;

-- Poster confirmation of parsed requirements (§14.3). The poster may
-- drop atoms, flip required/preferred and add dictionary concepts; not
-- invent free text the job doesn't say.
create or replace function public.ai_get_job_requirements(p_opportunity uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
    return null;
  end if;
  return (
    select jsonb_build_object(
             'status', case when r.content_version = o.content_version then r.status else 'pending' end,
             'role_level', r.role_level,
             'atoms', ai_private.spec_for_display(jsonb_build_object('atoms',
                        coalesce(case when r.status = 'confirmed' then r.confirmed else r.parsed end, '[]'::jsonb)))->'atoms',
             'confirmed_at', r.confirmed_at)
      from public.opportunities o
      left join ai_private.job_requirements r on r.opportunity_id = o.id
     where o.id = p_opportunity);
end;
$$;

create or replace function public.ai_confirm_job_requirements(p_opportunity uuid, p_atoms jsonb)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_uid  uuid := auth.uid();
  v_req  ai_private.job_requirements;
  v_ver  int;
  v_ops  jsonb := '[]'::jsonb;
  a      jsonb;
  v_spec jsonb;
begin
  if not ai_private.recruiter_job_ok(v_uid, p_opportunity) then
    raise exception 'job_not_eligible' using errcode = '42501';
  end if;
  select content_version into v_ver from public.opportunities where id = p_opportunity;
  select * into v_req from ai_private.job_requirements where opportunity_id = p_opportunity for update;
  if jsonb_typeof(p_atoms) <> 'array' or jsonb_array_length(p_atoms) > 12 then
    raise exception 'invalid_requirements' using errcode = '22023';
  end if;

  -- Each confirmed atom is either a parsed one (by id, free text kept as
  -- the job states it) or a dictionary concept.
  for a in select * from jsonb_array_elements(p_atoms) loop
    if a ? 'id' then
      select x || jsonb_build_object('required', coalesce((a->>'required')::boolean, (x->>'required')::boolean, false))
        into a
        from jsonb_array_elements(coalesce(v_req.parsed, '[]'::jsonb)) x where x->>'id' = a->>'id';
      if a is null then
        raise exception 'invalid_requirements' using errcode = '22023';
      end if;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'add', 'kind', a->>'kind', 'concept', a->>'concept',
                                                             'free_text', a->>'free_text', 'required', a->'required',
                                                             'group', a->>'group'));
    else
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'add', 'kind', coalesce(a->>'kind', 'tool'),
                                                             'concept', a->>'concept', 'required', a->'required'));
    end if;
  end loop;

  v_spec := ai_private.apply_spec_ops(null, v_ops, 'recruiter', null, null, null, true);
  -- Job criteria are not chat memory: they follow the job, not the
  -- seven-day chat lifetime.
  v_spec := jsonb_set(v_spec, '{atoms}', coalesce((
    select jsonb_agg(x || jsonb_build_object('source', jsonb_build_object('type', 'job', 'content_version', v_ver)))
      from jsonb_array_elements(v_spec->'atoms') x), '[]'::jsonb));

  insert into ai_private.job_requirements (opportunity_id, content_version, status, confirmed, confirmed_by, confirmed_at)
  values (p_opportunity, v_ver, 'confirmed', v_spec->'atoms', v_uid, now())
  on conflict (opportunity_id) do update
     set content_version = v_ver, status = 'confirmed', confirmed = v_spec->'atoms',
         confirmed_by = v_uid, confirmed_at = now(), updated_at = now();
end;
$$;

revoke all on function public.ai_state() from public, anon, authenticated;
revoke all on function public.ai_list_conversations(text) from public, anon, authenticated;
revoke all on function public.ai_get_conversation(uuid) from public, anon, authenticated;
revoke all on function public.ai_submit_turn(text, uuid, uuid, text, text, text, int, boolean) from public, anon, authenticated;
revoke all on function public.ai_turn_status(uuid) from public, anon, authenticated;
revoke all on function public.ai_cancel_turn(uuid) from public, anon, authenticated;
revoke all on function public.ai_edit_spec(uuid, int, jsonb) from public, anon, authenticated;
revoke all on function public.ai_delete_conversation(uuid) from public, anon, authenticated;
revoke all on function public.ai_delete_all_history() from public, anon, authenticated;
revoke all on function public.ai_forget_message(uuid) from public, anon, authenticated;
revoke all on function public.ai_save_findings(uuid) from public, anon, authenticated;
revoke all on function public.ai_result_cards(uuid) from public, anon, authenticated;
revoke all on function public.ai_get_job_requirements(uuid) from public, anon, authenticated;
revoke all on function public.ai_confirm_job_requirements(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ai_state() to authenticated;
grant execute on function public.ai_list_conversations(text) to authenticated;
grant execute on function public.ai_get_conversation(uuid) to authenticated;
grant execute on function public.ai_submit_turn(text, uuid, uuid, text, text, text, int, boolean) to authenticated;
grant execute on function public.ai_turn_status(uuid) to authenticated;
grant execute on function public.ai_cancel_turn(uuid) to authenticated;
grant execute on function public.ai_edit_spec(uuid, int, jsonb) to authenticated;
grant execute on function public.ai_delete_conversation(uuid) to authenticated;
grant execute on function public.ai_delete_all_history() to authenticated;
grant execute on function public.ai_forget_message(uuid) to authenticated;
grant execute on function public.ai_save_findings(uuid) to authenticated;
grant execute on function public.ai_result_cards(uuid) to authenticated;
grant execute on function public.ai_get_job_requirements(uuid) to authenticated;
grant execute on function public.ai_confirm_job_requirements(uuid, jsonb) to authenticated;


-- ─── 6. Executor functions (ai_service only) ────────────────────────
-- The lease check every executor function starts with. A stale holder
-- (lease expired, reclaimed, cancelled or finished) is refused.
create or replace function ai_private.exec_turn(p_turn uuid, p_lease uuid)
returns ai_private.turns
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns;
begin
  if session_user not in ('ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into v from ai_private.turns where id = p_turn for update;
  if not found or v.status <> 'running' or v.lease_token is distinct from p_lease or v.lease_expires_at < now() then
    raise exception 'stale_lease' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create or replace function ai_private.exec_claim(p_worker text)
returns jsonb
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_cfg   ai_private.settings;
  v_turn  ai_private.turns;
  v_conv  ai_private.conversations;
  v_msg   text;
  v_lease uuid := gen_random_uuid();
begin
  if session_user not in ('ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into v_cfg from ai_private.settings where id = 1;

  -- Queue wait has its own limit; a stale queued turn is expired, not run.
  update ai_private.turns
     set status = 'expired', outcome = 'queue_timeout', stage = 'done', finished_at = now(), revision = revision + 1
   where status = 'queued' and created_at < now() - make_interval(secs => v_cfg.max_queue_wait_seconds);

  if (select count(*) from ai_private.turns where status = 'running' and lease_expires_at > now())
     >= v_cfg.active_turn_ceiling then
    return null;
  end if;

  select * into v_turn from ai_private.turns
   where status = 'queued' and not cancel_requested
   order by created_at
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;

  update ai_private.turns
     set status = 'running', stage = 'understanding', lease_token = v_lease, fence = fence + 1,
         lease_expires_at = now() + interval '60 seconds',
         deadline_at = now() + make_interval(secs => v_cfg.turn_deadline_seconds),
         claimed_at = now(), attempts = attempts + 1, revision = revision + 1
   where id = v_turn.id
  returning * into v_turn;

  select * into v_conv from ai_private.conversations where id = v_turn.conversation_id;
  select m.body into v_msg from ai_private.messages m where m.id = v_turn.message_id and m.expires_at > now();

  return jsonb_build_object(
    'turn_id', v_turn.id, 'lease', v_lease, 'fence', v_turn.fence, 'mode', v_turn.mode, 'kind', v_turn.kind,
    'message', v_msg, 'message_id', v_turn.message_id,
    'message_expires_at', (select m.expires_at from ai_private.messages m where m.id = v_turn.message_id),
    'spec', ai_private.effective_spec(v_conv.spec), 'spec_revision', v_conv.spec_revision,
    'pending_ops', v_conv.pending_ops,
    'temporary', v_conv.temporary,
    'use_memory', not v_conv.temporary and coalesce((select s.use_chat_memory from ai_private.member_settings s
                                                      where s.member_id = v_turn.owner_id), true),
    'job', (select jsonb_build_object('audience', o.eligible_audience, 'role_level', r.role_level,
                                      'content_version', o.content_version)
              from public.opportunities o left join ai_private.job_requirements r on r.opportunity_id = o.id
             where o.id = v_turn.opportunity_id),
    'deadline_at', v_turn.deadline_at,
    'deadline_seconds', v_cfg.turn_deadline_seconds,
    'attempt_timeout_seconds', v_cfg.attempt_timeout_seconds);
end;
$$;

create or replace function ai_private.exec_heartbeat(p_turn uuid, p_lease uuid, p_stage text)
returns boolean
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
begin
  update ai_private.turns
     set lease_expires_at = least(now() + interval '60 seconds', v.deadline_at + interval '30 seconds'),
         stage = coalesce(p_stage, stage),
         revision = revision + case when p_stage is distinct from stage then 1 else 0 end
   where id = p_turn;
  return not v.cancel_requested;
end;
$$;

-- Owner-scoped history for this turn's mode (§5.1): never another
-- member's, never a temporary search, never expired.
create or replace function ai_private.exec_memory(p_turn uuid, p_lease uuid, p_query text)
returns table (message_id uuid, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_q tsquery;
begin
  if coalesce((select c.temporary from ai_private.conversations c where c.id = v.conversation_id), true)
     or not coalesce((select s.use_chat_memory from ai_private.member_settings s where s.member_id = v.owner_id), true) then
    return;
  end if;
  v_q := plainto_tsquery('simple', left(coalesce(p_query, ''), 600));
  return query
    select m.id, m.body, m.created_at
      from ai_private.messages m
      join ai_private.conversations c on c.id = m.conversation_id
     where m.owner_id = v.owner_id and c.mode = v.mode and not c.temporary
       and m.conversation_id <> v.conversation_id and m.role = 'member' and m.expires_at > now()
       and (c.mode <> 'recruiter' or c.opportunity_id = v.opportunity_id)
       and m.tsv @@ v_q
     order by ts_rank(m.tsv, v_q) desc, m.created_at desc
     limit 12;
end;
$$;

create or replace function ai_private.exec_reserve(p_turn uuid, p_lease uuid, p_stage text, p_model text,
                                                   p_max_in int, p_max_out int)
returns uuid
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_cfg ai_private.settings;
  v_id uuid;
begin
  if v.cancel_requested then
    raise exception 'cancelled' using errcode = 'P0001';
  end if;
  if now() > v.deadline_at then
    raise exception 'deadline' using errcode = 'P0001';
  end if;
  select * into v_cfg from ai_private.settings where id = 1;
  -- In-flight provider requests have their own cap, separate from active
  -- turns (F3).
  if (select count(*) from ai_private.spend s
       where s.status = 'reserved' and s.purpose = 'matching' and s.created_at > now() - interval '2 minutes')
     >= v_cfg.provider_request_ceiling then
    raise exception 'provider_busy' using errcode = 'P0001';
  end if;
  v_id := ai_private.spend_reserve('matching', v.mode, v.owner_id, v.id, null, p_stage, p_model, p_max_in, p_max_out);
  update ai_private.turns set provider_calls = provider_calls + 1 where id = p_turn;
  return v_id;
end;
$$;

-- Settlement must work after the lease is gone (a slow response that
-- outlived its turn still has to be paid for), so it checks the
-- reservation belongs to the turn rather than the lease.
create or replace function ai_private.exec_settle(p_turn uuid, p_reservation uuid, p_in int, p_out int)
returns bigint
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from ai_private.spend where id = p_reservation and turn_id = p_turn) then
    raise exception 'unknown_reservation' using errcode = 'P0001';
  end if;
  return ai_private.spend_settle(p_reservation, p_in, p_out);
end;
$$;

create or replace function ai_private.exec_abandon(p_turn uuid, p_reservation uuid, p_dispatched boolean)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from ai_private.spend where id = p_reservation and turn_id = p_turn) then
    raise exception 'unknown_reservation' using errcode = 'P0001';
  end if;
  if p_dispatched then
    perform ai_private.spend_mark_unknown(p_reservation);
  else
    perform ai_private.spend_release(p_reservation);
  end if;
end;
$$;

-- The interpreter's validated decision. 'apply' changes the spec
-- (compare-and-swap on the revision the turn was admitted against);
-- every other decision ends the turn with a templated reply.
create or replace function ai_private.exec_interpretation(
  p_turn uuid, p_lease uuid, p_fence bigint, p_decision text, p_ops jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v      ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_conv ai_private.conversations;
  v_msg  ai_private.messages;
  v_new  jsonb;
  v_body text;
begin
  if v.fence <> p_fence then
    raise exception 'stale_lease' using errcode = 'P0001';
  end if;
  select * into v_conv from ai_private.conversations where id = v.conversation_id for update;
  if v_conv.spec_revision <> v.expected_revision then
    raise exception 'stale_revision' using errcode = 'P0001';
  end if;
  select * into v_msg from ai_private.messages where id = v.message_id;

  if p_decision = 'apply' then
    v_new := ai_private.apply_spec_ops(v_conv.spec, p_ops, v.mode, v_msg.body, v_msg.id, v_msg.expires_at, false);
    if jsonb_array_length(v_new->'atoms') = 0 then
      p_decision := 'clarify';
    else
      update ai_private.conversations
         set prev_spec = v_conv.spec, spec = v_new, spec_revision = v_conv.spec_revision + 1, pending_ops = null
       where id = v_conv.id;
      return ai_private.spec_for_display(v_new) || jsonb_build_object('spec', v_new, 'spec_revision', v_conv.spec_revision + 1);
    end if;
  end if;

  if p_decision = 'confirm_pending' then
    if v_conv.pending_ops is null then
      raise exception 'nothing_to_confirm' using errcode = 'P0001';
    end if;
    -- The proposal was validated against the message it came from.
    select m.* into v_msg from ai_private.messages m
     where m.id = (v_conv.pending_ops->>'message_id')::uuid and m.expires_at > now();
    if not found then
      raise exception 'nothing_to_confirm' using errcode = 'P0001';
    end if;
    v_new := ai_private.apply_spec_ops(v_conv.spec, v_conv.pending_ops->'ops', v.mode, v_msg.body, v_msg.id,
                                       v_msg.expires_at, false);
    update ai_private.conversations
       set prev_spec = v_conv.spec, spec = v_new, spec_revision = v_conv.spec_revision + 1, pending_ops = null
     where id = v_conv.id;
    return ai_private.spec_for_display(v_new) || jsonb_build_object('spec', v_new, 'spec_revision', v_conv.spec_revision + 1);
  end if;

  if p_decision not in ('clarify', 'off_task', 'sensitive', 'injection', 'mixed') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  if p_decision = 'mixed' then
    -- Validate now so a later one-tap confirm can only apply criteria
    -- that were grounded in this message.
    perform ai_private.apply_spec_ops(v_conv.spec, p_ops, v.mode, v_msg.body, v_msg.id, v_msg.expires_at, false);
    update ai_private.conversations
       set pending_ops = jsonb_build_object('message_id', v_msg.id, 'ops', p_ops)
     where id = v_conv.id;
  end if;

  v_body := case p_decision
    when 'clarify'   then 'I couldn''t turn that into search criteria. Try naming skills, tools or interests.'
    when 'off_task'  then 'I can only search for people and jobs. I can''t answer other questions.'
    when 'sensitive' then 'I can''t search on personal characteristics. Search on skills and experience instead.'
    when 'injection' then 'I can''t follow instructions inside a search. Describe who or what you''re looking for.'
    when 'mixed'     then 'Part of that wasn''t a search, so I''ve left it out. Search with the remaining criteria?'
  end;
  insert into ai_private.messages (conversation_id, owner_id, role, kind, body, turn_id)
  values (v.conversation_id, v.owner_id, 'system',
          case p_decision when 'clarify' then 'clarify' when 'mixed' then 'mixed' else 'refused' end, v_body, v.id);
  update ai_private.turns
     set status = case when p_decision in ('clarify', 'mixed') then 'clarify' else 'refused' end,
         outcome = p_decision, stage = 'done', finished_at = now(), lease_token = null, revision = revision + 1
   where id = v.id;
  return null;
end;
$$;

-- Retrieval (§6): fresh each turn, every eligibility rule inside SQL,
-- at most 200 ids. Exact concept hits come first so an approximate top-k
-- can never push every exact match out.
create or replace function ai_private.exec_retrieve(
  p_turn uuid, p_lease uuid, p_concepts text[], p_negated text[], p_query text, p_embedding text, p_limit int
)
returns table (target uuid, exact_hits int, lexical real, distance real, projection_hash text, features jsonb)
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v      ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_spec jsonb;
  v_q    tsquery := case when coalesce(p_query, '') = '' then null
                         else websearch_to_tsquery('simple', left(p_query, 1000)) end;
  v_emb  vector := case when p_embedding is null then null else p_embedding::vector end;
  v_lim  int := greatest(1, least(coalesce(p_limit, 200), 200));
begin
  select c.spec into v_spec from ai_private.conversations c where c.id = v.conversation_id;
  delete from ai_private.turn_candidates where turn_id = v.id;

  if v.mode in ('recruiter', 'network') then
    return query
    with pool as materialized (
      select d.member_id, d.concepts, d.tsv, d.embedding, d.projection_hash, d.features
        from ai_private.member_docs d
       where d.purpose = v.mode
         and not (d.concepts && coalesce(p_negated, '{}'))
         and ai_private.member_candidate_ok(v.owner_id, v.mode, d.member_id, v.opportunity_id, v_spec)
    ),
    exact as (
      select p.member_id, cardinality(array(select unnest(p.concepts) intersect select unnest(p_concepts)))::int as hits
        from pool p where p.concepts && coalesce(p_concepts, '{}')
    ),
    lex as (
      select p.member_id, ts_rank(p.tsv, v_q)::real as rank
        from pool p where v_q is not null and p.tsv @@ v_q
       order by rank desc limit 200
    ),
    vec as (
      select p.member_id, (p.embedding <=> v_emb)::real as dist
        from pool p where v_emb is not null and p.embedding is not null
       order by p.embedding <=> v_emb limit 200
    ),
    unioned as (
      select p.member_id, coalesce(e.hits, 0) as hits, coalesce(l.rank, 0)::real as rank, vv.dist,
             p.projection_hash, p.features
        from pool p
        left join exact e on e.member_id = p.member_id
        left join lex l on l.member_id = p.member_id
        left join vec vv on vv.member_id = p.member_id
       where e.member_id is not null or l.member_id is not null or vv.member_id is not null
       order by coalesce(e.hits, 0) desc, coalesce(l.rank, 0) desc, vv.dist asc nulls last, p.member_id
       limit v_lim
    ),
    issued as (
      insert into ai_private.turn_candidates (turn_id, target_member, rank, projection_hash)
      select v.id, u.member_id, row_number() over (order by u.hits desc, u.rank desc, u.dist asc nulls last, u.member_id),
             u.projection_hash
        from unioned u
      returning target_member
    )
    select u.member_id, u.hits, u.rank, u.dist, u.projection_hash, u.features
      from unioned u
     order by u.hits desc, u.rank desc, u.dist asc nulls last, u.member_id;
  else
    return query
    with pool as materialized (
      select j.opportunity_id, j.concepts, j.tsv, j.embedding, j.content_version
        from ai_private.job_docs j
        join public.opportunities o on o.id = j.opportunity_id and o.content_version = j.content_version
       where ai_private.job_candidate_ok(v.owner_id, j.opportunity_id)
         and not (j.concepts && coalesce(p_negated, '{}'))
    ),
    exact as (
      select p.opportunity_id, cardinality(array(select unnest(p.concepts) intersect select unnest(p_concepts)))::int as hits
        from pool p where p.concepts && coalesce(p_concepts, '{}')
    ),
    lex as (
      select p.opportunity_id, ts_rank(p.tsv, v_q)::real as rank
        from pool p where v_q is not null and p.tsv @@ v_q
       order by rank desc limit 200
    ),
    vec as (
      select p.opportunity_id, (p.embedding <=> v_emb)::real as dist
        from pool p where v_emb is not null and p.embedding is not null
       order by p.embedding <=> v_emb limit 200
    ),
    unioned as (
      select p.opportunity_id, coalesce(e.hits, 0) as hits, coalesce(l.rank, 0)::real as rank, vv.dist,
             p.content_version
        from pool p
        left join exact e on e.opportunity_id = p.opportunity_id
        left join lex l on l.opportunity_id = p.opportunity_id
        left join vec vv on vv.opportunity_id = p.opportunity_id
       where e.opportunity_id is not null or l.opportunity_id is not null or vv.opportunity_id is not null
       order by coalesce(e.hits, 0) desc, coalesce(l.rank, 0) desc, vv.dist asc nulls last, p.opportunity_id
       limit v_lim
    ),
    issued as (
      insert into ai_private.turn_candidates (turn_id, target_opportunity, rank, projection_hash)
      select v.id, u.opportunity_id, row_number() over (order by u.hits desc, u.rank desc, u.dist asc nulls last, u.opportunity_id),
             u.content_version::text
        from unioned u
      returning target_opportunity
    )
    select u.opportunity_id, u.hits, u.rank, u.dist, u.content_version::text, '{}'::jsonb
      from unioned u
     order by u.hits desc, u.rank desc, u.dist asc nulls last, u.opportunity_id;
  end if;
end;
$$;

-- Evidence for issued candidates only. For a job search, a "candidate"
-- is a job and its evidence is the job's own requirements; the member's
-- own projection comes from exec_self_evidence.
create or replace function ai_private.exec_candidate_evidence(p_turn uuid, p_lease uuid, p_targets uuid[])
returns table (target uuid, projection_hash text, evidence jsonb, requirements jsonb)
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
begin
  if cardinality(p_targets) > 20 then
    raise exception 'too_many_targets' using errcode = '22023';
  end if;
  if v.mode in ('recruiter', 'network') then
    return query
      select c.target_member, d.projection_hash,
             coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.source_kind, 'text', e.text,
                                                           'concepts', e.concept_slugs, 'polarity', e.polarity))
                         from (select * from ai_private.member_evidence e2
                                where e2.member_id = c.target_member and e2.purpose = v.mode
                                order by e2.id limit 40) e), '[]'::jsonb),
             null::jsonb
        from ai_private.turn_candidates c
        join ai_private.member_docs d on d.member_id = c.target_member and d.purpose = v.mode
       where c.turn_id = v.id and c.target_member = any(p_targets);
  else
    return query
      select c.target_opportunity, j.content_version::text,
             jsonb_build_array(jsonb_build_object('id', 0, 'kind', 'job', 'text', left(j.body, 1500),
                                                  'concepts', j.concepts, 'polarity', 'positive')),
             (select case when r.content_version = j.content_version
                          then coalesce(case when r.status = 'confirmed' then r.confirmed else r.parsed end, '[]'::jsonb)
                     end
                from ai_private.job_requirements r where r.opportunity_id = c.target_opportunity)
        from ai_private.turn_candidates c
        join ai_private.job_docs j on j.opportunity_id = c.target_opportunity
       where c.turn_id = v.id and c.target_opportunity = any(p_targets);
  end if;
end;
$$;

create or replace function ai_private.exec_self_evidence(p_turn uuid, p_lease uuid)
returns table (projection_hash text, concepts text[], evidence jsonb, preferences jsonb)
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
begin
  if v.mode <> 'opportunities' then
    raise exception 'wrong_mode' using errcode = '22023';
  end if;
  return query
    select d.projection_hash, d.concepts,
           coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.source_kind, 'text', e.text,
                                                         'concepts', e.concept_slugs, 'polarity', e.polarity))
                       from (select * from ai_private.member_evidence e2
                              where e2.member_id = v.owner_id and e2.purpose = 'self'
                              order by e2.id limit 60) e), '[]'::jsonb),
           (select jsonb_build_object('role_types', s.pref_role_types, 'location_types', s.pref_location_types)
              from ai_private.member_settings s where s.member_id = v.owner_id)
      from ai_private.member_docs d
     where d.member_id = v.owner_id and d.purpose = 'self';
end;
$$;

create or replace function ai_private.exec_assessment_get(p_turn uuid, p_lease uuid, p_keys text[])
returns table (cache_key text, verdict jsonb)
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
begin
  return query
    select a.cache_key, a.verdict from ai_private.assessments a
     where a.cache_key = any(p_keys) and a.expires_at > now()
       and (a.owner_id is null or a.owner_id = v.owner_id);
end;
$$;

create or replace function ai_private.exec_assessment_put(
  p_turn uuid, p_lease uuid, p_target uuid, p_cache_key text, p_projection_hash text, p_verdict jsonb,
  p_expires_at timestamptz, p_owner_scoped boolean
)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
begin
  -- Only for a candidate this turn was issued, and only against the
  -- projection it was issued with: a stale put after a withdrawal or an
  -- update is dropped.
  if v.mode in ('recruiter', 'network') then
    if not exists (select 1 from ai_private.turn_candidates c
                    join ai_private.member_docs d on d.member_id = c.target_member and d.purpose = v.mode
                   where c.turn_id = v.id and c.target_member = p_target and d.projection_hash = p_projection_hash) then
      return;
    end if;
    insert into ai_private.assessments (cache_key, target_member, owner_id, purpose, projection_hash, verdict, expires_at)
    values (p_cache_key, p_target, case when p_owner_scoped then v.owner_id end, v.mode, p_projection_hash, p_verdict,
            least(coalesce(p_expires_at, now() + interval '30 days'), now() + interval '30 days'))
    on conflict (cache_key) do nothing;
  else
    if not exists (select 1 from ai_private.turn_candidates c where c.turn_id = v.id and c.target_opportunity = p_target) then
      return;
    end if;
    insert into ai_private.assessments (cache_key, target_opportunity, owner_id, purpose, projection_hash, verdict, expires_at)
    values (p_cache_key, p_target, v.owner_id, 'opportunities', p_projection_hash, p_verdict,
            least(coalesce(p_expires_at, now() + interval '30 days'), now() + interval '30 days'))
    on conflict (cache_key) do nothing;
  end if;
end;
$$;

-- Publish (§4, §6): the fence must still be ours, the spec unchanged
-- since the turn read it, and every result re-checked against today's
-- eligibility. Results are written together; the browser never sees a
-- partial ranking while batches race.
create or replace function ai_private.exec_publish(
  p_turn uuid, p_lease uuid, p_fence bigint, p_spec_revision int, p_results jsonb, p_partial boolean
)
returns int
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v      ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_conv ai_private.conversations;
  r      jsonb;
  v_slot int := 0;
  v_target uuid;
  v_body text;
begin
  if v.fence <> p_fence then
    raise exception 'stale_lease' using errcode = 'P0001';
  end if;
  select * into v_conv from ai_private.conversations where id = v.conversation_id;
  if v_conv.spec_revision <> p_spec_revision then
    raise exception 'stale_revision' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 10 then
    raise exception 'invalid_results' using errcode = '22023';
  end if;

  delete from ai_private.results where turn_id = v.id;
  for r in select * from jsonb_array_elements(p_results) loop
    v_target := (r->>'target')::uuid;
    if v.mode in ('recruiter', 'network') then
      continue when not exists (select 1 from ai_private.turn_candidates c
                                 where c.turn_id = v.id and c.target_member = v_target);
      continue when not ai_private.member_candidate_ok(v.owner_id, v.mode, v_target, v.opportunity_id, v_conv.spec);
      -- A profile that changed while it was being assessed is left out
      -- rather than shown with a score for evidence it no longer has.
      continue when (select d.projection_hash from ai_private.member_docs d
                      where d.member_id = v_target and d.purpose = v.mode) is distinct from (r->>'projection_hash');
      v_slot := v_slot + 1;
      insert into ai_private.surfaced_members as sm (owner_id, member_id) values (v.owner_id, v_target)
      on conflict (owner_id, member_id) do update set surfaced_at = now();
      insert into ai_private.results (turn_id, slot, target_member, score, tier, exact_tier, coverage, components,
                                      evidence_ids, projection_hash)
      values (v.id, v_slot, v_target, (r->>'score')::int, r->>'tier', coalesce((r->>'exact_tier')::int, 0),
              coalesce(r->'coverage', '[]'::jsonb), coalesce(r->'components', '{}'::jsonb),
              -- Evidence ids must belong to this candidate (§7).
              array(select e.id from ai_private.member_evidence e
                     where e.member_id = v_target and e.purpose = v.mode
                       and e.id in (select x::bigint from jsonb_array_elements_text(coalesce(r->'evidence_ids', '[]'::jsonb)) x)),
              (select d.projection_hash from ai_private.member_docs d where d.member_id = v_target and d.purpose = v.mode));
    else
      continue when not exists (select 1 from ai_private.turn_candidates c
                                 where c.turn_id = v.id and c.target_opportunity = v_target);
      continue when not ai_private.job_candidate_ok(v.owner_id, v_target);
      v_slot := v_slot + 1;
      insert into ai_private.results (turn_id, slot, target_opportunity, score, tier, exact_tier, coverage, components,
                                      projection_hash)
      values (v.id, v_slot, v_target, (r->>'score')::int, r->>'tier', coalesce((r->>'exact_tier')::int, 0),
              coalesce(r->'coverage', '[]'::jsonb),
              coalesce(r->'components', '{}'::jsonb)
                || jsonb_build_object('content_version', (select j.content_version from ai_private.job_docs j
                                                           where j.opportunity_id = v_target)),
              (select j.content_version::text from ai_private.job_docs j where j.opportunity_id = v_target));
    end if;
  end loop;

  v_body := case
    when v_slot = 0 and v.mode = 'recruiter'
      then 'No matches yet. Few members have opted in to recruiter search so far.'
    when v_slot = 0 then 'No matches for these criteria. Try fewer must-haves.'
    when v_slot = 1 then '1 match.'
    else v_slot || ' matches.'
  end || case when p_partial then ' Some profiles couldn''t be checked this time.' else '' end;
  insert into ai_private.messages (conversation_id, owner_id, role, kind, body, turn_id)
  values (v.conversation_id, v.owner_id, 'system', 'results', v_body, v.id);

  update ai_private.turns
     set status = case when p_partial then 'partial' else 'completed' end, outcome = null, stage = 'done',
         result_count = v_slot, finished_at = now(), lease_token = null, revision = revision + 1
   where id = v.id;
  update ai_private.conversations set last_activity_at = now() where id = v.conversation_id;
  return v_slot;
end;
$$;

create or replace function ai_private.exec_finish(p_turn uuid, p_lease uuid, p_status text, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_body text;
begin
  if p_status not in ('failed', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  v_body := case p_outcome
    when 'budget_exhausted' then 'AI search has reached today''s limit. It resets at midnight UTC.'
    when 'provider_busy'    then 'AI search is busy right now. Please try again in a minute.'
    when 'cancelled'        then 'Search stopped.'
    when 'deadline'         then 'That search took too long. Please try again.'
    when 'unavailable'      then 'AI search is temporarily unavailable. Your criteria are saved.'
    when 'no_profile'       then 'Add some skills or a CV to your profile so we can match jobs to you.'
    else 'Something went wrong with that search. Your criteria are saved; please try again.'
  end;
  insert into ai_private.messages (conversation_id, owner_id, role, kind, body, turn_id)
  values (v.conversation_id, v.owner_id, 'system', 'failed', v_body, v.id);
  update ai_private.turns
     set status = p_status, outcome = left(p_outcome, 40), stage = 'done', finished_at = now(),
         lease_token = null, revision = revision + 1
   where id = v.id;
end;
$$;

create or replace function ai_private.exec_span(
  p_turn uuid, p_stage text, p_model text, p_prompt_hash text, p_in int, p_out int, p_cost bigint,
  p_latency_ms int, p_outcome text, p_attempt int
)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into ai_private.trace_spans (turn_id, stage, model, prompt_hash, input_tokens, output_tokens, cost_micro,
                                      latency_ms, outcome, attempt)
  select p_turn, left(p_stage, 40), left(p_model, 80), left(p_prompt_hash, 64), p_in, p_out, p_cost, p_latency_ms,
         p_outcome, coalesce(p_attempt, 1)
   where exists (select 1 from ai_private.turns where id = p_turn);
end;
$$;

create or replace function ai_private.exec_embedding_get(p_key text)
returns text
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return (select q.embedding::text from ai_private.query_embeddings q where q.cache_key = p_key and q.expires_at > now());
end;
$$;

create or replace function ai_private.exec_embedding_put(p_key text, p_embedding text, p_model text)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  -- Bounded store: a flood of unique queries cannot grow it without limit.
  if (select count(*) from ai_private.query_embeddings) >= 50000 then
    return;
  end if;
  insert into ai_private.query_embeddings (cache_key, embedding, model)
  values (p_key, p_embedding::vector, p_model)
  on conflict (cache_key) do nothing;
end;
$$;

-- Startup refuses paid mode without a confirmed price for every model it
-- would call (§9.1).
create or replace function ai_private.exec_preflight(p_models text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ai_private, public
as $$
begin
  if session_user not in ('ai_service', 'postgres') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return array(select m from unnest(p_models) m
                where not exists (select 1 from ai_private.model_prices p where p.model = m and p.confirmed));
end;
$$;

revoke all on function ai_private.exec_turn(uuid, uuid) from public;
revoke all on function ai_private.exec_claim(text) from public;
revoke all on function ai_private.exec_heartbeat(uuid, uuid, text) from public;
revoke all on function ai_private.exec_memory(uuid, uuid, text) from public;
revoke all on function ai_private.exec_reserve(uuid, uuid, text, text, int, int) from public;
revoke all on function ai_private.exec_settle(uuid, uuid, int, int) from public;
revoke all on function ai_private.exec_abandon(uuid, uuid, boolean) from public;
revoke all on function ai_private.exec_interpretation(uuid, uuid, bigint, text, jsonb) from public;
revoke all on function ai_private.exec_retrieve(uuid, uuid, text[], text[], text, text, int) from public;
revoke all on function ai_private.exec_candidate_evidence(uuid, uuid, uuid[]) from public;
revoke all on function ai_private.exec_self_evidence(uuid, uuid) from public;
revoke all on function ai_private.exec_assessment_get(uuid, uuid, text[]) from public;
revoke all on function ai_private.exec_assessment_put(uuid, uuid, uuid, text, text, jsonb, timestamptz, boolean) from public;
revoke all on function ai_private.exec_publish(uuid, uuid, bigint, int, jsonb, boolean) from public;
revoke all on function ai_private.exec_finish(uuid, uuid, text, text) from public;
revoke all on function ai_private.exec_span(uuid, text, text, text, int, int, bigint, int, text, int) from public;
revoke all on function ai_private.exec_embedding_get(text) from public;
revoke all on function ai_private.exec_embedding_put(text, text, text) from public;
revoke all on function ai_private.exec_preflight(text[]) from public;

grant execute on function ai_private.exec_claim(text) to ai_service;
grant execute on function ai_private.exec_heartbeat(uuid, uuid, text) to ai_service;
grant execute on function ai_private.exec_memory(uuid, uuid, text) to ai_service;
grant execute on function ai_private.exec_reserve(uuid, uuid, text, text, int, int) to ai_service;
grant execute on function ai_private.exec_settle(uuid, uuid, int, int) to ai_service;
grant execute on function ai_private.exec_abandon(uuid, uuid, boolean) to ai_service;
grant execute on function ai_private.exec_interpretation(uuid, uuid, bigint, text, jsonb) to ai_service;
grant execute on function ai_private.exec_retrieve(uuid, uuid, text[], text[], text, text, int) to ai_service;
grant execute on function ai_private.exec_candidate_evidence(uuid, uuid, uuid[]) to ai_service;
grant execute on function ai_private.exec_self_evidence(uuid, uuid) to ai_service;
grant execute on function ai_private.exec_assessment_get(uuid, uuid, text[]) to ai_service;
grant execute on function ai_private.exec_assessment_put(uuid, uuid, uuid, text, text, jsonb, timestamptz, boolean) to ai_service;
grant execute on function ai_private.exec_publish(uuid, uuid, bigint, int, jsonb, boolean) to ai_service;
grant execute on function ai_private.exec_finish(uuid, uuid, text, text) to ai_service;
grant execute on function ai_private.exec_span(uuid, text, text, text, int, int, bigint, int, text, int) to ai_service;
grant execute on function ai_private.exec_embedding_get(text) to ai_service;
grant execute on function ai_private.exec_embedding_put(text, text, text) to ai_service;
grant execute on function ai_private.exec_preflight(text[]) to ai_service;


-- ─── 7. Reaper and purge (pg_cron, F31) ─────────────────────────────
-- Every minute: queued turns past their wait limit expire; a running turn
-- whose lease lapsed is failed, not re-run (its provider calls may have
-- been billed, so nothing is blindly resent); a reservation that never
-- settled counts at its upper bound for good.
create or replace function ai_private.cron_reap()
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v_cfg ai_private.settings;
begin
  select * into v_cfg from ai_private.settings where id = 1;

  update ai_private.turns
     set status = 'expired', outcome = 'queue_timeout', stage = 'done', finished_at = now(), revision = revision + 1
   where status = 'queued' and created_at < now() - make_interval(secs => v_cfg.max_queue_wait_seconds);

  with lapsed as (
    update ai_private.turns
       set status = 'failed', outcome = 'interrupted', stage = 'done', finished_at = now(),
           lease_token = null, revision = revision + 1
     where status = 'running' and lease_expires_at < now() - interval '30 seconds'
    returning id, conversation_id, owner_id
  )
  insert into ai_private.messages (conversation_id, owner_id, role, kind, body, turn_id)
  select l.conversation_id, l.owner_id, 'system', 'failed',
         'Something went wrong with that search. Your criteria are saved; please try again.', l.id
    from lapsed l;

  update ai_private.spend set status = 'unknown'
   where status = 'reserved' and created_at < now() - interval '15 minutes';
end;
$$;

-- Hourly: seven-day chat expiry, cache TTLs, saved findings (§5.1, §8.1).
create or replace function ai_private.cron_purge()
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
begin
  delete from ai_private.messages where expires_at <= now();
  delete from ai_private.turns where expires_at <= now();
  delete from ai_private.saved_scans where expires_at <= now();
  -- A conversation with no live message and nothing running is gone; one
  -- that still has live messages keeps only criteria whose sources live.
  delete from ai_private.conversations c
   where c.last_activity_at < now() - interval '168 hours'
     and not exists (select 1 from ai_private.messages m where m.conversation_id = c.id)
     and not exists (select 1 from ai_private.turns t where t.conversation_id = c.id);
  update ai_private.conversations c
     set spec = ai_private.effective_spec(c.spec), spec_revision = c.spec_revision + 1,
         prev_spec = case when c.prev_spec is null then null else ai_private.effective_spec(c.prev_spec) end
   where jsonb_array_length(c.spec->'atoms') <> jsonb_array_length(ai_private.effective_spec(c.spec)->'atoms')
     and not exists (select 1 from ai_private.turns t where t.conversation_id = c.id and t.status in ('queued', 'running'));
  delete from ai_private.assessments where expires_at <= now();
  delete from ai_private.query_embeddings where expires_at <= now();
  delete from ai_private.trace_spans where turn_id is null and created_at < now() - interval '7 days';
  delete from ai_private.usage_events where created_at < now() - interval '25 hours';
  delete from ai_private.surfaced_members where surfaced_at < now() - interval '25 hours';
end;
$$;

revoke all on function ai_private.cron_reap() from public;
revoke all on function ai_private.cron_purge() from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('ai-reap', 'ai-purge');
    perform cron.schedule('ai-reap', '* * * * *', 'select ai_private.cron_reap()');
    perform cron.schedule('ai-purge', '17 * * * *', 'select ai_private.cron_purge()');
  end if;
end $$;


-- ─── 8. Admin: aggregate health, flags and limits (§10.1) ───────────
-- Aggregates only: no member, message, candidate or per-member spend.
create or replace function public.admin_ai_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, ai_private
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: not an admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'is_operator', public.is_ai_operator(),
    'flags', jsonb_build_object(
      'ai_enabled', coalesce((select value = 'true' from public.app_config where key = 'ai_enabled'), false),
      'recruiter', coalesce((select value = 'true' from public.app_config where key = 'ai_recruiter_enabled'), false),
      'network', coalesce((select value = 'true' from public.app_config where key = 'ai_network_enabled'), false),
      'opportunities', coalesce((select value = 'true' from public.app_config where key = 'ai_opportunities_enabled'), false)),
    'limits', (select to_jsonb(s) - 'previous' - 'updated_by' from ai_private.settings s where s.id = 1),
    'spend_today', (select jsonb_build_object(
                      'matching', coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'matching'), 0),
                      'ingestion', coalesce(sum(ai_private.spend_charged(s)) filter (where s.purpose = 'ingestion'), 0),
                      'unreconciled', count(*) filter (where s.status in ('reserved', 'unknown')))
                      from ai_private.spend s where s.day = v_day),
    'prices_confirmed', not exists (select 1 from ai_private.model_prices
                                     where model in ('gpt-5.4', 'gpt-5.4-mini', 'text-embedding-3-small')
                                       and not confirmed),
    'turns_24h', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                    from (select t.status, count(*) as n from ai_private.turns t
                           where t.created_at > now() - interval '24 hours' group by t.status) x),
    'outcomes_24h', (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb)
                       from (select t.outcome, count(*) as n from ai_private.turns t
                              where t.created_at > now() - interval '24 hours' and t.outcome is not null
                              group by t.outcome) x),
    'queue', (select jsonb_build_object(
                'queued', count(*) filter (where t.status = 'queued'),
                'running', count(*) filter (where t.status = 'running'),
                'oldest_queued_seconds', extract(epoch from now() - min(t.created_at) filter (where t.status = 'queued'))::int)
                from ai_private.turns t where t.status in ('queued', 'running')),
    'latency_ms_24h', (select jsonb_build_object(
                         'p50', percentile_cont(0.5) within group (order by extract(epoch from t.finished_at - t.created_at) * 1000),
                         'p95', percentile_cont(0.95) within group (order by extract(epoch from t.finished_at - t.created_at) * 1000))
                         from ai_private.turns t
                        where t.created_at > now() - interval '24 hours' and t.status in ('completed', 'partial')),
    'opted_in', jsonb_build_object(
      'recruiter', (select count(*) from ai_private.member_docs where purpose = 'recruiter'),
      'network', (select count(*) from ai_private.member_docs where purpose = 'network')),
    'requirements', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                       from (select r.status, count(*) as n from ai_private.job_requirements r group by r.status) x),
    'jobs_needing_audience', (select count(*) from public.opportunities o
                               where o.status = 'approved' and o.eligible_audience is null
                                 and o.application_deadline >= current_date),
    'recent_changes', coalesce((
      select jsonb_agg(jsonb_build_object('action', a.action, 'notes', a.notes, 'at', a.created_at) order by a.created_at desc)
        from (select * from public.admin_actions a2
               where a2.action in ('ai_flag_on', 'ai_flag_off', 'ai_limits_changed', 'ai_rebuild_index')
               order by a2.created_at desc limit 10) a), '[]'::jsonb));
end;
$$;

create or replace function public.admin_set_ai_flag(p_key text, p_enabled boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
begin
  if not public.is_ai_operator() then
    raise exception 'Forbidden: AI operators only' using errcode = '42501';
  end if;
  if p_key not in ('ai_enabled', 'ai_recruiter_enabled', 'ai_network_enabled', 'ai_opportunities_enabled') then
    raise exception 'Unknown flag' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 300 then
    raise exception 'Give a reason (3–300 characters).' using errcode = '22023';
  end if;
  update public.app_config set value = case when p_enabled then 'true' else 'false' end, updated_at = now()
   where key = p_key;
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (auth.uid(), case when p_enabled then 'ai_flag_on' else 'ai_flag_off' end, 'app_config',
          '00000000-0000-0000-0000-000000000000'::uuid, p_key || ': ' || p_reason);
  if p_key = 'ai_enabled' and p_enabled then
    perform ai_private.enqueue_ai_backfill(5000);
  end if;
end;
$$;

-- Raising the active-turn ceiling is limited to 25% a step (§10.1), the
-- hard maximum is the table's own CHECK, and the previous values are kept
-- for rollback.
create or replace function public.admin_set_ai_limits(
  p_active_turn_ceiling int, p_matching_daily_cap_micro bigint, p_member_daily_cap_micro bigint, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_old ai_private.settings;
begin
  if not public.is_ai_operator() then
    raise exception 'Forbidden: AI operators only' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 300 then
    raise exception 'Give a reason (3–300 characters).' using errcode = '22023';
  end if;
  select * into v_old from ai_private.settings where id = 1 for update;
  if p_active_turn_ceiling > ceil(v_old.active_turn_ceiling * 1.25) then
    raise exception 'Raise the ceiling in steps of at most 25%%.' using errcode = '22023';
  end if;
  update ai_private.settings
     set previous = to_jsonb(v_old) - 'previous',
         active_turn_ceiling = p_active_turn_ceiling,
         matching_daily_cap_micro = p_matching_daily_cap_micro,
         member_daily_cap_micro = p_member_daily_cap_micro,
         updated_at = now(), updated_by = auth.uid(), reason = p_reason
   where id = 1;
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (auth.uid(), 'ai_limits_changed', 'app_config', '00000000-0000-0000-0000-000000000000'::uuid,
          format('ceiling %s→%s, daily %s→%s, member %s→%s: %s', v_old.active_turn_ceiling, p_active_turn_ceiling,
                 v_old.matching_daily_cap_micro, p_matching_daily_cap_micro, v_old.member_daily_cap_micro,
                 p_member_daily_cap_micro, p_reason));
end;
$$;

create or replace function public.admin_ai_rebuild_index()
returns int
language plpgsql
security definer
set search_path = public, ai_private
as $$
declare
  v_n int;
begin
  if not public.is_ai_operator() then
    raise exception 'Forbidden: AI operators only' using errcode = '42501';
  end if;
  v_n := ai_private.enqueue_ai_backfill(5000);
  insert into public.admin_actions (admin_id, action, target_table, target_id, notes)
  values (auth.uid(), 'ai_rebuild_index', 'app_config', '00000000-0000-0000-0000-000000000000'::uuid, v_n::text);
  return v_n;
end;
$$;

revoke all on function public.admin_ai_overview() from public, anon, authenticated;
revoke all on function public.admin_set_ai_flag(text, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_set_ai_limits(int, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.admin_ai_rebuild_index() from public, anon, authenticated;
grant execute on function public.admin_ai_overview() to authenticated;
grant execute on function public.admin_set_ai_flag(text, boolean, text) to authenticated;
grant execute on function public.admin_set_ai_limits(int, bigint, bigint, text) to authenticated;
grant execute on function public.admin_ai_rebuild_index() to authenticated;

revoke all on all tables in schema ai_private from public, anon, authenticated;
