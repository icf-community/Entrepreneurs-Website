-- Narrows the network-mode affinity carve-out from 20261110000001.
--
-- Network mode still allows gender and nationality as affinity criteria
-- ("women in STEM", "Indian students in robotics"). Ethnicity/race,
-- religion and sexuality move to the always-refused list, in every mode.
-- Those are Article 9 UK GDPR special categories. The profile has no field
-- for them, so a search on them can only work by having the model infer
-- them from members' own free text (bio_hobbies is network evidence) and
-- surface people on that basis. That is processing special category data,
-- and the network-discovery toggle is not an explicit Art 9 consent.
-- See docs/compliance/12-uk-legal-gap-analysis.md §2.3.
--
-- Same split as server/app/ai/policy.py (_AFFINITY vs _SPECIAL_CATEGORY);
-- keep both, interpret.txt and provider.py in step. Adds lgbt*, queer,
-- bisexual, pansexual and asexual, which neither list had, so
-- "LGBTQ+ founders" was never screened in any mode.
--
-- Same signature (text, text) as the live function, so CREATE OR REPLACE
-- replaces it in place and keeps apply_spec_ops' call working unchanged.
-- Rollback: re-run the is_sensitive definition from 20261110000001.

create or replace function ai_private.is_sensitive(p text, p_mode text default null)
returns boolean
language sql
immutable
as $$
  with s as (
    select regexp_replace(
      lower(coalesce(p, '')),
      '(^|[^a-z])((wo)?men[''’]?s +health(care| ?tech)?|digital +health|health ?tech|femtech)(?=[^a-z]|$)',
      '\1 ', 'g') as t
  )
  select
    s.t ~ ('(^|[^a-z])(age|aged|young|old|older|younger|years?\s*old|aged?\s*(under|over|between)?\s*[0-9]+|'
       || 'under\s*[0-9]{1,2}|over\s*[0-9]{1,2}|pregnan[a-z]*|maternity|disabled|disability|health|illness|'
       || 'mental|autis[a-z]*|adhd|dyslex[a-z]*|political|conservative|labour|tory|socialist|criminal|conviction|'
       || 'married|single|children|kids|visa|immigrant|accent|native|'
       -- Art 9: racial or ethnic origin, religious belief, sexual orientation
       || 'ethnic|ethnicity|race|racial|white|black|asian|african|'
       || 'religion|religious|christian|muslim|jewish|jews|hindu|sikh|buddhist|atheist|'
       || 'gay|lesbian|bisexual|pansexual|asexual|queer|lgbt[a-z]*|straight|sexuality|sexual)s?([^a-z]|$)')
    or (
      coalesce(p_mode, '') is distinct from 'network'
      and s.t ~ ('(^|[^a-z])(gender|male|female|man|woman|men|women|boy|girl|'
             || 'nationality|national|citizen|british|english|indian|chinese|european|american|'
             || 'trans|transgender)s?([^a-z]|$)')
    )
  from s;
$$;

revoke execute on function ai_private.is_sensitive(text, text) from public, anon, authenticated;
