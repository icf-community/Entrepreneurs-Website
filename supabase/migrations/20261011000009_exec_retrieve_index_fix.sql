-- ════════════════════════════════════════════════════════════════════
-- Foundry · exec_retrieve: stop the materialized pool from defeating
-- the HNSW/GIN indexes (S7, gap 26)
--
-- Found during the 10k performance re-measure: exec_retrieve's p95 was
-- 199.5 ms against the plan's 100 ms gate, and it did not improve going
-- from a 50-row to a 10,000-row corpus (confirmed with EXPLAIN ANALYZE
-- against a synthetic 10k member_docs table — docs/audits/D1-scalability.md
-- §7). Root cause: `pool as materialized` forces Postgres to fully
-- evaluate member_candidate_ok()/job_candidate_ok() over every row of
-- the mode-filtered pool BEFORE any of the three scoring legs run, and
-- because the vector leg's ORDER BY then runs against that already-
-- materialized CTE (a CTE Scan, never an Index Scan), the HNSW index
-- that exists specifically to make that ordering cheap is never used at
-- all — nor are the GIN indexes on concepts/tsv for the exact/lexical
-- legs, which also scan the materialized set instead of using their own
-- index.
--
-- Fix: give each of the three legs its own independently-filtered CTE
-- (same purpose/negated/eligibility predicates as before, applied three
-- times instead of once), joined back together with FULL JOINs instead
-- of driving off one shared materialized relation. This lets exact use
-- member_docs_concepts_idx, lex use member_docs_tsv_idx, and vec use
-- member_docs_embedding_idx (job_docs' equivalents for opportunities
-- mode) directly, each against the base table.
--
-- Verified equivalent (not just faster): a before/after diff against a
-- synthetic 10k-row corpus with negated-concept and ineligible-member
-- rows planted (open_to_connections=false) returned the IDENTICAL 20
-- ranked rows in the identical order. The eligibility filter
-- (member_candidate_ok/job_candidate_ok) is still applied on every one
-- of the three legs, not relaxed on any of them — a candidate who fails
-- it is absent from exact AND lex AND vec, exactly as before.
--
-- member_candidate_ok() running up to 3x per eligible row instead of
-- once is the accepted tradeoff: it is `stable sql`, index-backed
-- existence checks, cheap per call, and the win from each leg using its
-- own index instead of a full unindexed scan/sort is the whole point.
-- ════════════════════════════════════════════════════════════════════

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
    with
    exact as (
      select d.member_id, d.projection_hash, d.features,
             cardinality(array(select unnest(d.concepts) intersect select unnest(p_concepts)))::int as hits
        from ai_private.member_docs d
       where d.purpose = v.mode
         and not (d.concepts && coalesce(p_negated, '{}'))
         and d.concepts && coalesce(p_concepts, '{}')
         and ai_private.member_candidate_ok(v.owner_id, v.mode, d.member_id, v.opportunity_id, v_spec)
    ),
    lex as (
      select d.member_id, d.projection_hash, d.features, ts_rank(d.tsv, v_q)::real as rank
        from ai_private.member_docs d
       where v_q is not null
         and d.purpose = v.mode
         and not (d.concepts && coalesce(p_negated, '{}'))
         and d.tsv @@ v_q
         and ai_private.member_candidate_ok(v.owner_id, v.mode, d.member_id, v.opportunity_id, v_spec)
       order by rank desc limit 200
    ),
    vec as (
      select d.member_id, d.projection_hash, d.features, (d.embedding <=> v_emb)::real as dist
        from ai_private.member_docs d
       where v_emb is not null and d.embedding is not null
         and d.purpose = v.mode
         and not (d.concepts && coalesce(p_negated, '{}'))
         and ai_private.member_candidate_ok(v.owner_id, v.mode, d.member_id, v.opportunity_id, v_spec)
       order by d.embedding <=> v_emb limit 200
    ),
    unioned as (
      select coalesce(e.member_id, l.member_id, vv.member_id) as member_id,
             coalesce(e.hits, 0) as hits, coalesce(l.rank, 0)::real as rank, vv.dist,
             coalesce(e.projection_hash, l.projection_hash, vv.projection_hash) as projection_hash,
             coalesce(e.features, l.features, vv.features) as features
        from exact e
        full join lex l on l.member_id = e.member_id
        full join vec vv on vv.member_id = coalesce(e.member_id, l.member_id)
       order by hits desc, rank desc, dist asc nulls last, member_id
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
    with
    exact as (
      select j.opportunity_id, j.content_version,
             cardinality(array(select unnest(j.concepts) intersect select unnest(p_concepts)))::int as hits
        from ai_private.job_docs j
        join public.opportunities o on o.id = j.opportunity_id and o.content_version = j.content_version
       where ai_private.job_candidate_ok(v.owner_id, j.opportunity_id)
         and not (j.concepts && coalesce(p_negated, '{}'))
         and j.concepts && coalesce(p_concepts, '{}')
    ),
    lex as (
      select j.opportunity_id, j.content_version, ts_rank(j.tsv, v_q)::real as rank
        from ai_private.job_docs j
        join public.opportunities o on o.id = j.opportunity_id and o.content_version = j.content_version
       where v_q is not null
         and ai_private.job_candidate_ok(v.owner_id, j.opportunity_id)
         and not (j.concepts && coalesce(p_negated, '{}'))
         and j.tsv @@ v_q
       order by rank desc limit 200
    ),
    vec as (
      select j.opportunity_id, j.content_version, (j.embedding <=> v_emb)::real as dist
        from ai_private.job_docs j
        join public.opportunities o on o.id = j.opportunity_id and o.content_version = j.content_version
       where v_emb is not null and j.embedding is not null
         and ai_private.job_candidate_ok(v.owner_id, j.opportunity_id)
         and not (j.concepts && coalesce(p_negated, '{}'))
       order by j.embedding <=> v_emb limit 200
    ),
    unioned as (
      select coalesce(e.opportunity_id, l.opportunity_id, vv.opportunity_id) as opportunity_id,
             coalesce(e.hits, 0) as hits, coalesce(l.rank, 0)::real as rank, vv.dist,
             coalesce(e.content_version, l.content_version, vv.content_version) as content_version
        from exact e
        full join lex l on l.opportunity_id = e.opportunity_id
        full join vec vv on vv.opportunity_id = coalesce(e.opportunity_id, l.opportunity_id)
       order by hits desc, rank desc, dist asc nulls last, opportunity_id
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

revoke all on function ai_private.exec_retrieve(uuid, uuid, text[], text[], text, text, int) from public;
grant execute on function ai_private.exec_retrieve(uuid, uuid, text[], text[], text, text, int) to ai_service;
