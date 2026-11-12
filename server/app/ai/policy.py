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

Owner decision 2026-11-10, narrowed 2026-11-12: `mode == "network"` is
different in kind from recruiter/opportunities — nobody is screened for a
job or a benefit, and two members only connect on mutual accept — so
gender and nationality (_AFFINITY) are allowed as network criteria:
"women in STEM", "Indian students in robotics".

Ethnicity/race, religion and sexuality (_SPECIAL_CATEGORY) are refused in
every mode, network included. Those are Article 9 UK GDPR special
categories, and the profile has no field for them, so the only way a
search on them can work is for the model to INFER them from what members
wrote in free text (bio_hobbies is network evidence) and surface people
on that basis. That is processing special category data, and the network
discovery toggle is not the explicit Art 9 consent it would need
(docs/compliance/12-uk-legal-gap-analysis.md §2.3). Gender and
nationality are Equality Act characteristics but not Art 9 categories.

_ALWAYS_SENSITIVE (age, disability, pregnancy/marital status, visa,
accent) stays refused in every mode: those only read as an eligibility
filter. recruiter/opportunities refuse all three lists.
"""

from __future__ import annotations

import re

# Sector phrases that contain a screened word. Bare "health", "mental
# health" and "women" stay screened: those can describe a person.
DOMAIN_TERMS = re.compile(
    r"\b(?:(?:wo)?men['’]?s\s+health(?:care|\s?tech)?|digital\s+health|health\s?tech|femtech)\b",
    re.I,
)

# Equality Act characteristics that are NOT Art 9 special categories:
# allowed in network mode as affinity search, refused elsewhere.
_AFFINITY = re.compile(
    r"\b(citizens?|citizenship|nationality|nationals?|british|english|indian|chinese|european|american|"
    r"transgender|trans|women|woman|men|man|females?|males?|girls?|boys?|gender)\b",
    re.I,
)
# Article 9 special categories (racial or ethnic origin, religious belief,
# sexual orientation): refused in EVERY mode — see the module docstring.
_SPECIAL_CATEGORY = re.compile(
    r"\b(ethnicit\w*|ethnic|races?|racial|white|black|asian|african|"
    r"religio\w*|muslims?|christians?|jewish|jews|hindus?|sikhs?|buddhists?|atheists?|"
    r"gay|lesbians?|bisexual|pansexual|asexual|queer|lgbt\w*|straight|sexuality|sexual orientation)\b",
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
    if _ALWAYS_SENSITIVE.search(stripped) or _SPECIAL_CATEGORY.search(stripped):
        return "sensitive"
    if mode != "network" and _AFFINITY.search(stripped):
        return "sensitive"
    return None
