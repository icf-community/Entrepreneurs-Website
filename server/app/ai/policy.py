"""Local request screening before any model call (AI-plan §4, §9.1).

Two narrow, deterministic checks on the minimised message, run before the
grammar and before the interpreter is paid for:

  sensitive   targeting a protected characteristic: nationality or
              citizenship, ethnicity, religion, sexuality, gender, age,
              pregnancy, disability, marital status. These can never be
              search criteria, so the request is refused rather than run
              without the part it asked for.
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
"""

from __future__ import annotations

import re

# Sector phrases that contain a screened word. Bare "health", "mental
# health" and "women" stay screened: those can describe a person.
DOMAIN_TERMS = re.compile(
    r"\b(?:(?:wo)?men['’]?s\s+health(?:care|\s?tech)?|digital\s+health|health\s?tech|femtech)\b",
    re.I,
)

_SENSITIVE = re.compile(
    r"\b(citizens?|citizenship|nationality|nationals?|british|english|indian|chinese|african|european|american|"
    r"ethnicit\w*|races?|racial|white|black|asian|religio\w*|muslims?|christians?|jewish|jews|hindus?|sikhs?|"
    r"buddhists?|atheists?|gay|lesbians?|bisexual|straight|transgender|trans|sexuality|women|woman|men|man|"
    r"females?|males?|girls?|boys?|gender|pregnan\w*|maternity|disab\w*|married|unmarried|single parents?|"
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


def screen(message: str) -> str | None:
    if _INJECTION.search(message):
        return "injection"
    if _SENSITIVE.search(DOMAIN_TERMS.sub(" ", message)):
        return "sensitive"
    return None
