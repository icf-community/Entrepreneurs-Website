-- ════════════════════════════════════════════════════════════════════
-- Foundry · get_my_cv_profile: deduplicate skills by canonical name
--
-- Found while testing the combined CV+GitHub summary: member_skills
-- holds one row per (member, source, skill) — a member with, say,
-- Python on both their CV and their GitHub languages has TWO rows that
-- both resolve to the canonical name "Python" (20260906000001's skill
-- normalisation and 20260907000001's GitHub language mapping both
-- write into the same table, deliberately, so either signal can supply
-- a skill on its own). get_my_cv_profile's array_agg never collapsed
-- that, so the CV processing dialog rendered "Python" twice, keyed by
-- the name string — a duplicate-key React warning that was really a
-- duplicate-data bug.
--
-- Latest previous version: 20260906000001. Same signature.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.get_my_cv_profile()
returns table (summary text, skills text[])
language sql
stable
security definer
set search_path = public
as $$
  select cp.summary,
         coalesce(
           (select array_agg(dedup.name order by dedup.confidence desc nulls last)
              from (
                select coalesce(cs.canonical_name, ms.raw_text) as name,
                       max(ms.confidence) as confidence
                  from public.member_skills ms
                  left join public.cv_skills cs on cs.id = ms.skill_id
                 where ms.member_id = c.member_id
                 group by coalesce(cs.canonical_name, ms.raw_text)
              ) dedup
           ),
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
