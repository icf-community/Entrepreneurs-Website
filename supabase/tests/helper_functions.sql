-- ════════════════════════════════════════════════════════════════════
-- Pure helper functions that sit on a security decision.
--
--   public.is_imperial_email      pins the student role to the Imperial domains
--   ai_private.is_sensitive       second line of the AI sensitive-attribute screen
--   ai_private.re_escape / text_mentions
--                                 build a regex from member-supplied text
--
-- These had no test that called them. Behaviour pinned here, including the
-- known limits of is_sensitive (see the comment on it).
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/helper_functions.sql
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v text;
begin
  -- ── is_imperial_email ────────────────────────────────────────────
  -- accepted
  if not (public.is_imperial_email('eve@imperial.ac.uk') and public.is_imperial_email('eve@ic.ac.uk')
          and public.is_imperial_email('EVE@Imperial.AC.UK') and public.is_imperial_email('first.last+tag@ic.ac.uk')) then
    raise exception 'FAIL(imperial): a genuine Imperial address was refused';
  end if;
  -- refused: other domains, lookalikes, subdomains, extra "@", whitespace,
  -- empty local part, null and empty
  foreach v in array array[
    'eve@gmail.com', 'eve@imperial.ac.uk.evil.com', 'eve@evil-imperial.ac.uk', 'eve@cs.imperial.ac.uk',
    'eve@imperial.ac.uk@evil.com', 'eve@evil.com@ic.ac.uk', '"eve@ic.ac.uk"@evil.com',
    ' eve@ic.ac.uk', 'eve@ic.ac.uk ', 'e ve@ic.ac.uk', '@ic.ac.uk', 'eve@', 'eve', '',
    E'eve@ic.ac.uk\n', E'eve\n@ic.ac.uk', 'eve@ic.ac.uk.', 'eve@ic.ac.uk:25', 'eve@іc.ac.uk' -- Cyrillic і
  ] loop
    if public.is_imperial_email(v) then
      raise exception 'FAIL(imperial): % was accepted as an Imperial address', v;
    end if;
  end loop;
  if public.is_imperial_email(null) then raise exception 'FAIL(imperial): null accepted'; end if;

  -- ── re_escape: every regex metacharacter becomes a literal ───────
  if 'a.b' !~ ('^' || ai_private.re_escape('a.b') || '$') or 'axb' ~ ('^' || ai_private.re_escape('a.b') || '$') then
    raise exception 'FAIL(re_escape): "." is not literal';
  end if;
  foreach v in array array['c++', 'a|b', '(x)', '[y]', '{2}', 'a*', 'a?', '^a', 'a$', 'a\b', 'a-b', '.*'] loop
    if v !~ ('^' || ai_private.re_escape(v) || '$') then
      raise exception 'FAIL(re_escape): % does not match itself once escaped', v;
    end if;
  end loop;

  -- ── text_mentions: whole-term match, no regex injection ──────────
  if not (ai_private.text_mentions('I know C++ and Python', 'c++')
          and ai_private.text_mentions('I know C# well', 'c#')
          and ai_private.text_mentions('python, sql', 'sql')
          and ai_private.text_mentions('PYTHON', 'python')) then
    raise exception 'FAIL(text_mentions): a plain mention was missed';
  end if;
  if ai_private.text_mentions('I know C++ well', 'c')           -- "c" is not "c++"
     or ai_private.text_mentions('javascript', 'java')          -- no substring hits
     or ai_private.text_mentions('anything', '')
     or ai_private.text_mentions('anything', null)
     or ai_private.text_mentions('axb', 'a.b')                  -- "." is literal
     or ai_private.text_mentions('anything', '.*') then
    raise exception 'FAIL(text_mentions): a non-mention matched';
  end if;
  -- A malicious term must never raise (a regex error would be a 500 on the turn path).
  foreach v in array array['(', ')', '[', '*', '\', '(?', '{1,}', '(a)\1', repeat('(', 200)] loop
    perform ai_private.text_mentions('some text', v);
  end loop;

  -- ── is_sensitive ─────────────────────────────────────────────────
  -- Must reject: protected-characteristic terms as whole words.
  foreach v in array array[
    'muslim', 'Muslim founders', 'women only', 'under 30 and young', 'must be male', 'christian', 'gay',
    'visa required', 'disabled', 'pregnant', 'autistic', 'dyslexia', 'has children', 'single', 'asian', 'aged 25'
  ] loop
    if not ai_private.is_sensitive(v) then
      raise exception 'FAIL(sensitive): "%" was not screened', v;
    end if;
  end loop;
  -- Must pass: ordinary skills and words that merely contain a listed term.
  foreach v in array array[
    'python', 'machine learning', 'data analysis', 'mentor', 'robotics', 'management', 'manchester',
    'cleaner', 'blacksmith', 'whitepaper', 'transport', 'translation', 'syntax', 'racecar',
    'kidney research', 'maternal', 'agent based modelling', 'imagery'
  ] loop
    if ai_private.is_sensitive(v) then
      raise exception 'FAIL(sensitive): "%" was screened but is an ordinary term', v;
    end if;
  end loop;
  if ai_private.is_sensitive(null) or ai_private.is_sensitive('') then
    raise exception 'FAIL(sensitive): null/empty must not be sensitive';
  end if;
  -- KNOWN LIMITS, deliberately not asserted so a fix does not break this file:
  --   * English only, ASCII boundaries: 'musulmán', 'мусульманин' are not matched.
  --   * Evadable by punctuation inside the word ('m.u.s.l.i.m', zero-width characters).
  --   * Over-blocks whole-word tech terms in free text that is NOT a taxonomy concept:
  --     'react native', 'race condition', 'health tech', 'single page app', 'black box testing'.
  -- This function is the SECOND line: server/app/ai/policy.py screens the message first
  -- and the interpreter's refusal is third. The live multilingual pass (Part 3) measures
  -- the gap; see tasks/e2e-adversarial-sweep.md (L-2).
end;
$$;
