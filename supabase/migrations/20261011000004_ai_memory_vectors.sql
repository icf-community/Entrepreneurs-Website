-- Vector chat memory (programme S2; owner decision 2026-10-11; AI-plan §5.1
-- "lexical search and embeddings over minimised items").
--
-- Keyword memory needs every word of the new message to appear in an old
-- one (plainto_tsquery is an AND), so "someone like the vision researcher
-- from before" missed the chat that said "a computer vision researcher who
-- uses PyTorch". Memory now fuses the keyword leg with a vector leg by
-- reciprocal rank.
--
-- Where the vectors live, and why:
--   * On the message row itself, not in the shared query-embedding cache:
--     a message's embedding is its personal data and must go when it goes.
--     The 168-hour read-time expiry, forget (which deletes the row), chat
--     deletion and the hourly purge already remove it.
--   * No HNSW index. A member has at most ~280 live messages per mode, and
--     the search is scoped to one owner, so an exact distance scan over
--     their own rows is both more accurate and faster than an approximate
--     global index filtered afterwards (which can return too few rows).
--   * Written by the executor through a fenced call (the turn's lease),
--     only for the turn's own message, only while it has not expired. A
--     message forgotten meanwhile is simply not there to update (R16).
--   * Only embedded when memory is on and the message goes to the
--     interpreter (app/ai/pipeline.py); metered like every provider call.

alter table ai_private.messages
  add column embedding vector(1536),
  add column embedding_model text check (embedding_model is null or length(embedding_model) <= 80);

create index if not exists messages_owner_created_idx on ai_private.messages (owner_id, created_at);

create or replace function ai_private.exec_message_embedding(p_turn uuid, p_lease uuid, p_embedding text, p_model text)
returns void
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
begin
  update ai_private.messages m
     set embedding = p_embedding::vector, embedding_model = left(p_model, 80)
   where m.id = v.message_id and m.owner_id = v.owner_id and m.role = 'member' and m.expires_at > now();
end;
$$;

-- Signature change (adds p_embedding): dropped and recreated (F21).
drop function ai_private.exec_memory(uuid, uuid, text);

create function ai_private.exec_memory(p_turn uuid, p_lease uuid, p_query text, p_embedding text default null)
returns table (message_id uuid, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ai_private, public
as $$
declare
  v     ai_private.turns := ai_private.exec_turn(p_turn, p_lease);
  v_q   tsquery;
  v_emb vector := case when p_embedding is null then null else p_embedding::vector end;
begin
  if coalesce((select c.temporary from ai_private.conversations c where c.id = v.conversation_id), true)
     or not coalesce((select s.use_chat_memory from ai_private.member_settings s where s.member_id = v.owner_id), true) then
    return;
  end if;
  v_q := plainto_tsquery('simple', left(coalesce(p_query, ''), 600));
  return query
    with pool as materialized (
      select m.id, m.body, m.created_at, m.tsv, m.embedding
        from ai_private.messages m
        join ai_private.conversations c on c.id = m.conversation_id
       where m.owner_id = v.owner_id and c.mode = v.mode and not c.temporary
         and m.conversation_id <> v.conversation_id and m.role = 'member' and m.expires_at > now()
         and (c.mode <> 'recruiter' or c.opportunity_id = v.opportunity_id)
    ),
    lex as (
      select p.id, row_number() over (order by ts_rank(p.tsv, v_q) desc, p.created_at desc) as rk
        from pool p
       where p.tsv @@ v_q
       order by rk limit 50
    ),
    -- Cosine distance 0.7 (similarity 0.3) keeps unrelated chats out
    -- instead of always returning the nearest twelve; the memory eval
    -- suite (O09) measures it.
    vec as (
      select p.id, row_number() over (order by p.embedding <=> v_emb, p.created_at desc) as rk
        from pool p
       where v_emb is not null and p.embedding is not null and (p.embedding <=> v_emb) <= 0.7
       order by rk limit 50
    ),
    fused as (
      select x.id, sum(1.0 / (60 + x.rk)) as score
        from (select * from lex union all select * from vec) x
       group by x.id
    )
    select p.id, p.body, p.created_at
      from fused f
      join pool p on p.id = f.id
     order by f.score desc, p.created_at desc
     limit 12;
end;
$$;

revoke all on function ai_private.exec_message_embedding(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function ai_private.exec_memory(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function ai_private.exec_message_embedding(uuid, uuid, text, text) to ai_service;
grant execute on function ai_private.exec_memory(uuid, uuid, text, text) to ai_service;
