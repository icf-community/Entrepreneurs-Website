-- ════════════════════════════════════════════════════════════════════
-- ai_private.is_sensitive: a sector is not a trait of a person.
--
-- "founders building products for women's health" is a product domain, not
-- a filter on people, but the screen refused it on two words ("women",
-- "health"), and so would the free-text criterion the interpreter derives
-- from it. A health-tech or femtech founder could not search their own
-- field. The Python screen (server/app/ai/policy.py, DOMAIN_TERMS) now
-- removes a short list of sector phrases before testing, and this does the
-- same, so the two lines agree. Keep the lists in step.
--
-- Only the PHRASE is removed, then the rest is tested exactly as before:
--   "women's health"              passes
--   "women's health women"        still refused ("women" is left behind)
--   "women who code"              still refused
--   "people with a health condition", "mental health", bare "health"
--                                 still refused (they can describe a person)
-- The apostrophe-s form is required for women/men, so "women health
-- professionals" (a filter on women) does not slip through as a sector.
--
-- Same signature, language and volatility as 20261026000008, so CREATE OR
-- REPLACE keeps the existing grants (revoked from public). Nothing is stored
-- from this function, so there is no data pre-check.
-- Rollback: recreate from 20261026000008.
-- ════════════════════════════════════════════════════════════════════

create or replace function ai_private.is_sensitive(p text)
returns boolean
language sql
immutable
as $$
  select regexp_replace(
           lower(coalesce(p, '')),
           '(^|[^a-z])((wo)?men[''’]?s +health(care| ?tech)?|digital +health|health ?tech|femtech)(?=[^a-z]|$)',
           '\1 ', 'g')
         ~ ('(^|[^a-z])(age|aged|young|old|older|younger|gender|male|female|man|woman|men|women|'
    || 'boy|girl|ethnic|ethnicity|race|racial|white|black|asian|nationality|national|citizen|religion|religious|'
    || 'christian|muslim|jewish|hindu|sikh|buddhist|atheist|gay|lesbian|straight|trans|transgender|sexuality|'
    || 'sexual|pregnan[a-z]*|maternity|disabled|disability|health|illness|mental|autis[a-z]*|adhd|dyslex[a-z]*|political|'
    || 'conservative|labour|tory|socialist|criminal|conviction|married|single|children|kids|visa|immigrant|'
    || 'accent|native)([^a-z]|$)');
$$;
