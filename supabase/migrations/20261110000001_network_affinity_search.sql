-- Owner decision 2026-11-10: network mode is different in kind from
-- recruiter/opportunities — nobody is screening candidates for a job or
-- a benefit there, two members only connect on mutual accept, and the
-- profile schema stores no gender/ethnicity/sexuality field at all, so
-- there is nothing to filter ON even if someone tried. Refusing
-- "find other LGBTQ+ founders to connect with" there was itself the
-- wrong kind of caution — a platform that won't let members find each
-- other by shared identity reads as hostile to exactly the groups it
-- should not be discriminating against.
--
-- Same split as server/app/ai/policy.py (keep both in step): identity/
-- affinity terms (gender, sexuality, ethnicity, nationality, religion —
-- the categories with a real community/support framing) are exempt when
-- p_mode = 'network'. Age, disability/health, pregnancy/marital status,
-- political affiliation, criminal history and visa/accent terms stay
-- refused in every mode: none of those have an affinity-search reading,
-- they only ever read as an eligibility filter. recruiter/opportunities
-- keep the exact original behaviour — this is one deliberately narrow
-- carve-out, not a general loosening. Every term from the previous
-- definition (20261108000001) is still here, just partitioned between
-- the two regexes below — none dropped.
--
-- Also fixes two real pre-existing gaps found while verifying this —
-- both brought up to parity with server/app/ai/policy.py's message-level
-- screen, which already had them:
--   1. The previous ALWAYS term list only matched the bare words
--      "age"/"aged", never a number ("under 25", "aged between 20 and
--      30", "22 years old"), so an age-restricted free-text criterion
--      was never actually screened in any mode.
--   2. The previous AFFINITY term list had generic "nationality|
--      national|citizen" but no actual nationality-adjective words
--      ("indian", "chinese", "british", "european", "american"), so
--      e.g. "Indian founders" as a free-text criterion was never
--      screened in ANY mode, recruiter included — a gap, not something
--      this migration is choosing to loosen.
--
-- A trailing default parameter does NOT make CREATE OR REPLACE treat this
-- as the same function as the one-arg 20261108000001 version — Postgres
-- identifies a function by (name, declared argument types), so the two
-- would coexist as a dead overload and every existing one-arg call site
-- (there are none left after this migration updates apply_spec_ops, but
-- a stray overload is still a live footgun for the next caller) would
-- become ambiguous. Drop the old signature explicitly first.
-- Rollback: drop the two-arg version, recreate the one-arg from
-- 20261108000001.
drop function if exists ai_private.is_sensitive(text);

create or replace function ai_private.is_sensitive(p text, p_mode text default null)
returns boolean
language sql
immutable
as $$
  select
    regexp_replace(
      lower(coalesce(p, '')),
      '(^|[^a-z])((wo)?men[''’]?s +health(care| ?tech)?|digital +health|health ?tech|femtech)(?=[^a-z]|$)',
      '\1 ', 'g')
    ~ ('(^|[^a-z])(age|aged|young|old|older|younger|years?\s*old|aged?\s*(under|over|between)?\s*[0-9]+|'
       || 'under\s*[0-9]{1,2}|over\s*[0-9]{1,2}|pregnan[a-z]*|maternity|disabled|disability|health|illness|'
       || 'mental|autis[a-z]*|adhd|dyslex[a-z]*|political|conservative|labour|tory|socialist|criminal|conviction|'
       || 'married|single|children|kids|visa|immigrant|accent|native)([^a-z]|$)')
    or (
      coalesce(p_mode, '') is distinct from 'network'
      and regexp_replace(
            lower(coalesce(p, '')),
            '(^|[^a-z])((wo)?men[''’]?s +health(care| ?tech)?|digital +health|health ?tech|femtech)(?=[^a-z]|$)',
            '\1 ', 'g')
          ~ ('(^|[^a-z])(gender|male|female|man|woman|men|women|boy|girl|ethnic|ethnicity|race|racial|white|black|'
             || 'asian|nationality|national|citizen|british|english|indian|chinese|african|european|american|'
             || 'religion|religious|christian|muslim|jewish|hindu|sikh|'
             || 'buddhist|atheist|gay|lesbian|straight|trans|transgender|sexuality|sexual)([^a-z]|$)')
    );
$$;

revoke execute on function ai_private.is_sensitive(text, text) from public, anon, authenticated;

-- Identical to 20261006000004's definition except the one call to
-- is_sensitive on the line marked below, which now passes p_mode through
-- so the network carve-out above actually reaches this check. Same
-- signature, language and volatility, so CREATE OR REPLACE keeps the
-- existing grants.
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
        -- CHANGED (this migration): pass p_mode through so the network
        -- affinity carve-out in is_sensitive() actually applies here.
        if length(v_free) > 80 or ai_private.is_sensitive(v_free, p_mode) then
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

      -- The same criterion twice is one criterion. Restating it more
      -- strongly ("must also like chess" after "chess") upgrades it to
      -- required; restating it negated turns it into an exclusion.
      if exists (select 1 from jsonb_array_elements(v_atoms) a
                  where coalesce(a->>'concept', '') = coalesce(v_concept, '')
                    and lower(coalesce(a->>'free_text', '')) = lower(coalesce(v_free, ''))
                    and a->>'kind' = v_kind) then
        v_atoms := (select jsonb_agg(case
                      when coalesce(a->>'concept', '') = coalesce(v_concept, '')
                       and lower(coalesce(a->>'free_text', '')) = lower(coalesce(v_free, ''))
                       and a->>'kind' = v_kind
                      then a || jsonb_build_object(
                             'required', coalesce((a->>'required')::boolean, false)
                                         or coalesce((op->>'required')::boolean, false)
                                         or coalesce((op->>'negated')::boolean, false),
                             'negated', coalesce((op->>'negated')::boolean, (a->>'negated')::boolean, false))
                      else a end)
                      from jsonb_array_elements(v_atoms) a);
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
