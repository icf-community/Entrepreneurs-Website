-- ════════════════════════════════════════════════════════════════════
-- Two helpers that sit on a security decision, tightened.
--
-- 1. public.is_imperial_email: require exactly one "@" and no whitespace.
-- 2. ai_private.is_sensitive: the stems "pregnan", "autis" and "dyslex"
--    could never match (see below).
--
-- ── 1. is_imperial_email ────────────────────────────────────────────
-- The student role is pinned to this check (account-creation trigger,
-- role-lock trigger, submit_onboarding, submit_intake). The old body took
-- split_part(email, '@', 2), so 'a@ic.ac.uk@evil.com' and ' a@ic.ac.uk'
-- passed it. Nothing could exploit that today: GoTrue refuses an address
-- with a second '@' ("Unable to validate email address: invalid format",
-- verified for sign-up and admin create on the local stack). This removes
-- the dependence on that, so the database is the authority on its own.
--
-- Same signature, language and volatility as the original
-- (20260529000001), so CREATE OR REPLACE keeps the existing grants
-- (revoked from public/anon/authenticated by 20260608000001).
--
-- Prod pre-check (must return 0 rows, otherwise an existing student would
-- fail the next role/email re-check):
--   select u.id, u.email from auth.users u join public.profiles p on p.id = u.id
--    where p.role = 'student' and not (lower(u.email) ~ '^[^@[:space:]]+@(ic\.ac\.uk|imperial\.ac\.uk)$');
--
-- Rollback: recreate with
--   select lower(split_part(coalesce(p_email, ''), '@', 2)) in ('ic.ac.uk', 'imperial.ac.uk');
-- ════════════════════════════════════════════════════════════════════

create or replace function public.is_imperial_email(p_email text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_email, '')) ~ '^[^@[:space:]]+@(ic\.ac\.uk|imperial\.ac\.uk)$';
$$;

-- ── 2. is_sensitive ─────────────────────────────────────────────────
-- Found by supabase/tests/helper_functions.sql. The list holds the STEMS
-- 'pregnan', 'autis' and 'dyslex' but each term must be followed by a
-- non-letter, so 'pregnant', 'autism', 'autistic', 'dyslexia' and
-- 'dyslexic' were never screened (only the literal stem word was). The
-- Python screen (server/app/ai/policy.py) already uses 'pregnan\w*'. The
-- three stems now take trailing letters; everything else is byte-identical
-- to 20261006000004. Nothing is stored from this function, so there is no
-- data pre-check. Rollback: recreate from 20261006000004.
--
-- Known limits that remain (English-only, punctuation evasion, some
-- whole-word tech terms over-blocked) are recorded in
-- supabase/tests/helper_functions.sql and tasks/e2e-adversarial-sweep.md.
create or replace function ai_private.is_sensitive(p text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p, '')) ~ ('(^|[^a-z])(age|aged|young|old|older|younger|gender|male|female|man|woman|men|women|'
    || 'boy|girl|ethnic|ethnicity|race|racial|white|black|asian|nationality|national|citizen|religion|religious|'
    || 'christian|muslim|jewish|hindu|sikh|buddhist|atheist|gay|lesbian|straight|trans|transgender|sexuality|'
    || 'sexual|pregnan[a-z]*|maternity|disabled|disability|health|illness|mental|autis[a-z]*|adhd|dyslex[a-z]*|political|'
    || 'conservative|labour|tory|socialist|criminal|conviction|married|single|children|kids|visa|immigrant|'
    || 'accent|native)([^a-z]|$)');
$$;
