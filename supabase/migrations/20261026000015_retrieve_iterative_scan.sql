-- ════════════════════════════════════════════════════════════════════
-- exec_retrieve: keep the vector legs from silently returning fewer candidates
-- than they were asked for once the planner uses the HNSW index.
--
-- The vector leg is "order by embedding <=> q limit 200" with filters (purpose,
-- negated concepts and the privacy check member_candidate_ok). pgvector's HNSW
-- scan returns at most hnsw.ef_search (40) nearest candidates and the filters
-- are applied AFTER it, so whenever the index path is chosen the leg returns
-- fewer than 200 rows, and in a real corpus the privacy filter removes more.
-- Measured on a scratch copy of member_docs with the same indexes (2,000 members x
-- 3 purposes, 1536-dim): with the index forced the leg returned 130 of 200 rows
-- (before the privacy filter); with iterative scan on, 200. Today the planner picks
-- an exact scan at this size, so retrieval is correct now; it flips to the index as
-- the corpus grows, and nothing would have told anyone that recall had dropped.
--
-- Fix: the function sets hnsw.iterative_scan = relaxed_order for its transaction, so
-- the index keeps scanning until the LIMIT is satisfied (bounded by
-- hnsw.max_scan_tuples, default 20,000). The candidates are re-sorted by distance in
-- the "unioned" step and ranked by the scorer afterwards, so slightly relaxed ordering
-- inside the leg is harmless. The same setting covers the job_docs leg of this function.
--
-- Body is the LIVE definition (the result of every earlier migration) with only the
-- set_config call added. Signature, security definer, search_path and grants are
-- unchanged (CREATE OR REPLACE keeps them).
--
-- Prod pre-check: none, no data is touched.
-- Rollback: re-apply the function without the set_config call (20261011000003 or the
--           latest earlier definition).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ai_private.exec_retrieve(p_turn uuid, p_lease uuid, p_concepts text[], p_negated text[], p_query text, p_embedding text, p_limit integer)
 RETURNS TABLE(target uuid, exact_hits integer, lexical real, distance real, projection_hash text, features jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ai_private', 'public'
AS $function$
declare
  v      ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_spec jsonb;
  v_q    tsquery := case when coalesce(p_query, '') = '' then null
                         else websearch_to_tsquery('simple', left(p_query, 1000)) end;
  v_emb  vector := case when p_embedding is null then null else p_embedding::vector end;
  v_lim  int := greatest(1, least(coalesce(p_limit, 200), 200));
begin
  -- Iterative HNSW scan (20261026000015): see the migration header. Set here, not with a
  -- function-level SET clause, because the setting only exists once the vector library is
  -- loaded (the cast in the DECLARE above loads it when there is an embedding) and
  -- CREATE FUNCTION may not name a setting the session has not registered. Transaction-local.
  if v_emb is not null then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  end if;
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
$function$;
