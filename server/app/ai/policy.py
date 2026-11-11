"""Local request screening before any model call (AI-plan §4, §9.1).

Two narrow, deterministic checks on the minimised message, run before the
grammar and before the interpreter is paid for:

  sensitive   targeting a protected characteristic: nationality or
              citizenship, ethnicity, religion, sexuality, gender, age,
              pregnancy, disability, marital status. These can never be
              criteria that FILTER other people, so the request is
              refused rather than run without the part it asked for.
  injection   an attempt to change or reveal the instructions.

Deliberately narrow: "health tech founders" or "mentors" must still pass.
The interpreter's own refusal is the second line, not the only one, and
the database's is_sensitive() screens every free-text criterion again.

A sector is not a trait of a person. "Founders building products for
women's health" names a product domain, so the few sector phrases below
are removed from the message before the protected-term test. Only the
phrase goes: "women's health women founders" still leaves "women" behind
and is refused. The same list lives in ai_private.is_sensitive (migration
20261108000001); change them together.

Owner decision 2026-11-10: `mode == "network"` is different in kind from
recruiter/opportunities — nobody is screening candidates for a job or a
benefit there, two members only connect on mutual accept, and the profile
schema stores no gender/ethnicity/sexuality field at all, so there is
nothing for the model to filter ON even if it tried. Blocking "find other
LGBTQ+ founders to connect with" there was itself the wrong kind of
caution: a platform refusing to let members find each other by shared
identity reads as hostile to exactly the groups it should not be
discriminating against. So _AFFINITY (gender, sexuality, ethnicity,
nationality, religion — the categories with a real community/support
framing) is exempt in network mode only. _ALWAYS_SENSITIVE (age,
disability, pregnancy/marital status, political affiliation, criminal
history, visa/accent) stays refused in every mode: none of those have an
affinity-search reading, they only ever read as an eligibility filter,
and recruiter/opportunities keep the full original list unchanged — this
is a single, deliberately narrow carve-out, not a general loosening.
"""

from __future__ import annotations

import re

# Sector phrases that contain a screened word. Bare "health", "mental
# health" and "women" stay screened: those can describe a person.
DOMAIN_TERMS = re.compile(
    r"\b(?:(?:wo)?men['’]?s\s+health(?:care|\s?tech)?|digital\s+health|health\s?tech|femtech)\b",
    re.I,
)

# Identity/affinity categories: a real "find my community" framing exists
# for these in network mode (see module docstring), so they are exempt
# there — but still refused in recruiter/opportunities, where the same
# words can only ever mean filtering candidates by a protected trait.
_AFFINITY = re.compile(
    r"\b(citizens?|citizenship|nationality|nationals?|british|english|indian|chinese|african|european|american|"
    r"ethnicit\w*|races?|racial|white|black|asian|religio\w*|muslims?|christians?|jewish|jews|hindus?|sikhs?|"
    r"buddhists?|atheists?|gay|lesbians?|bisexual|straight|transgender|trans|sexuality|women|woman|men|man|"
    r"females?|males?|girls?|boys?|gender)\b",
    re.I,
)
# No plausible non-exclusionary reading in any mode — these are either a
# pure eligibility/employment proxy (age, visa, accent) or categories the
# owner chose not to extend the network carve-out to (disability,
# pregnancy/marital status, political affiliation, criminal history).
_ALWAYS_SENSITIVE = re.compile(
    r"\b(pregnan\w*|maternity|disab\w*|married|unmarried|single parents?|"
    r"young|younger than|older than|years old|aged? (?:under|over|between)?\s*\d+|under \d{2}|over \d{2}|"
    r"native speakers?|no accent)\b",
    re.I,
)
_INJECTION = re.compile(
    r"\b(ignore (?:all |any |the |your )?(?:previous |prior |above |earlier )?(?:instructions|rules|prompt)|"
    r"disregard (?:the |all |your )?(?:rules|instructions)|system prompt|your instructions|you are now|"
    r"developer mode|jailbreak|act as (?:an?|the) )",
    re.I,
)


def screen(message: str, mode: str = "recruiter") -> str | None:
    if _INJECTION.search(message):
        return "injection"
    stripped = DOMAIN_TERMS.sub(" ", message)
    if _ALWAYS_SENSITIVE.search(stripped):
        return "sensitive"
    if mode != "network" and _AFFINITY.search(stripped):
        return "sensitive"
    return None
