"""The outbound privacy boundary (AI-plan §3, A0.1).

Everything that leaves Foundry for a model provider passes through here
first: CV text, GitHub READMEs, job descriptions, chat messages and the
projections built from them. Two steps, both local:

  minimise()      normalises the text and removes direct identifiers:
                  the member's own names, emails, handles and links,
                  contact patterns (email, phone, postcode, street
                  address, date of birth) and anything shaped like a
                  secret. Technical tokens (C++, C#, .NET, Node.js) are
                  kept whole.
  assert_clean()  runs the same detectors over the ASSEMBLED payload,
                  just before the call, and refuses it if anything is
                  left. A field-by-field pass can miss what the
                  assembly puts back together.

What this does not do, and the DPIA says so: it cannot make a CV
anonymous. A distinctive project can still identify someone; the rest of
the payload is pseudonymised personal data. Regex cannot find every name
or address either, which is why the member's own known identifiers are
removed by value and not only by pattern.

No external detector ever sees the text, since that would send the very
identifiers this exists to keep local.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

# Bump when a detector changes. CV dedupe and member projections record it,
# so text processed under an older policy is reprocessed, not reused.
POLICY_VERSION = "outbound-v1"


class OutboundPolicyError(Exception):
    """The assembled payload still contains something that must not leave."""

    def __init__(self, kinds: list[str]) -> None:
        super().__init__(f"outbound payload refused: {', '.join(sorted(set(kinds)))}")
        self.kinds = sorted(set(kinds))


@dataclass(frozen=True)
class Identifiers:
    """The member's own direct identifiers, removed by value."""

    names: tuple[str, ...] = ()
    exact: tuple[str, ...] = ()  # emails, usernames, profile URLs
    github_username: str | None = None

    @classmethod
    def from_row(cls, row: dict | None) -> Identifiers:
        if not row:
            return cls()
        names = []
        for key in ("first_name", "surname", "preferred_name"):
            value = (row.get(key) or "").strip()
            if value:
                names.append(value)
        exact = []
        for key in ("email", "github_username", "linkedin_url", "github_url", "portfolio_url"):
            value = (row.get(key) or "").strip()
            if value:
                exact.append(value)
        return cls(names=tuple(names), exact=tuple(exact), github_username=(row.get("github_username") or None))


@dataclass
class Minimised:
    text: str
    removed: Counter = field(default_factory=Counter)


# Words that are names of technologies. A member called "Rust" or "Swift"
# keeps their surname in the text rather than losing the skill; the
# pattern detectors and the projection allowlist still apply.
_TECH_WORDS = frozenset(
    {
        "go", "rust", "swift", "julia", "ruby", "java", "python", "react", "angular", "vue", "flask", "django",
        "spring", "rails", "dart", "kotlin", "scala", "elixir", "crystal", "unity", "pandas", "spark", "chess",
        "c", "r", "ai", "ml", "sql",
    }
)

_ZERO_WIDTH = re.compile("[​-‏‪-‮⁠-⁤﻿]")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

_SECRET_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    re.compile(r"(?i)\b(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S{6,}"),
]
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_URL = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>\"')\]]+")
# A bare domain (janedoe.dev) is a link; ASP.NET and Node.js are not.
_BARE_DOMAIN = re.compile(
    r"(?i)(?<![\w@./])([a-z0-9-]{2,63}(?:\.[a-z0-9-]{2,63})*\.(?:com|org|net|io|ai|dev|co|uk|me|app|xyz|tech|info|"
    r"site|page|blog|so|gg|ly|edu|gov))(?:/[^\s]*)?(?![\w.])"
)
_DOMAIN_ALLOW = frozenset({"asp.net", "ado.net", "vb.net", "dot.net", "socket.io", "next.js", "node.js"})
_HANDLE = re.compile(r"(?<![\w@])@[A-Za-z0-9_](?:[A-Za-z0-9_.-]{1,37}[A-Za-z0-9_])?\b")
_PHONE = re.compile(r"(?<![\w+])(\+?\d[\d\s().-]{8,18}\d)(?!\w)")
_POSTCODE = re.compile(r"\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b")
# Title-case on purpose: "5 people in a close team" is not an address.
_ADDRESS = re.compile(
    r"\b\d{1,4}[a-z]?\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Close|Way|"
    r"Place|Pl|Square|Sq|Gardens|Terrace|Crescent|Court|Ct|Grove|Hill|Mews|Row)\b\.?"
)
_DOB = re.compile(r"(?i)\b(?:date of birth|d\.?o\.?b\.?|born(?: on)?)\s*[:\-]?\s*[^\n,;]{0,24}?\b(?:19|20)\d{2}\b")


def _digits(s: str) -> int:
    return sum(ch.isdigit() for ch in s)


def normalise(text: str) -> str:
    """NFKC, no zero-width or bidi controls, no control characters. Keeps
    newlines and tabs; does not touch non-Latin scripts."""
    text = unicodedata.normalize("NFKC", text or "")
    text = _ZERO_WIDTH.sub("", text)
    return _CONTROL.sub(" ", text)


def _replace(pattern: re.Pattern, label: str, text: str, removed: Counter, *, keep=None) -> str:
    def sub(match: re.Match) -> str:
        whole = match.group(0)
        if keep is not None and keep(match):
            return whole
        removed[label] += 1
        return f"[{label}]"

    return pattern.sub(sub, text)


def _phone_keep(match: re.Match) -> bool:
    value = match.group(1)
    # A date range (2019-2023) or a version string is not a phone number.
    return _digits(value) < 10


def _domain_keep(match: re.Match) -> bool:
    return match.group(1).lower() in _DOMAIN_ALLOW


def minimise(text: str, identifiers: Identifiers | None = None, *, max_chars: int | None = None) -> Minimised:
    removed: Counter = Counter()
    out = normalise(text)

    for pattern in _SECRET_PATTERNS:
        out = _replace(pattern, "secret", out, removed)

    ids = identifiers or Identifiers()
    for value in sorted(ids.exact, key=len, reverse=True):
        if len(value) >= 3:
            pattern = re.compile(re.escape(value), re.I)
            out, n = pattern.subn("[id]", out)
            removed["id"] += n

    out = _replace(_EMAIL, "email", out, removed)
    out = _replace(_URL, "link", out, removed)
    out = _replace(_BARE_DOMAIN, "link", out, removed, keep=_domain_keep)
    out = _replace(_HANDLE, "handle", out, removed)
    out = _replace(_DOB, "dob", out, removed)
    out = _replace(_PHONE, "number", out, removed, keep=_phone_keep)
    out = _replace(_ADDRESS, "address", out, removed)
    out = _replace(_POSTCODE, "postcode", out, removed)

    for name in _name_tokens(ids):
        pattern = re.compile(rf"(?<![\w]){re.escape(name)}(?![\w])", re.I)
        out, n = pattern.subn("[name]", out)
        removed["name"] += n

    if max_chars is not None and len(out) > max_chars:
        out = out[:max_chars]
        removed["truncated"] += 1
    return Minimised(text=out, removed=removed)


def _name_tokens(ids: Identifiers) -> list[str]:
    """Full names first, then each part, longest first so 'Mary Ann' is
    replaced as one before 'Ann' alone. A part that is a technology word
    is skipped (see _TECH_WORDS); so is a single letter."""
    tokens: set[str] = set()
    for name in ids.names:
        tokens.add(name)
        for part in re.split(r"[\s-]+", name):
            if len(part) >= 2 and part.lower() not in _TECH_WORDS:
                tokens.add(part)
    if len(ids.names) >= 2:
        tokens.add(" ".join(ids.names[:2]))
    return sorted((t for t in tokens if t.lower() not in _TECH_WORDS), key=len, reverse=True)


def findings(text: str, identifiers: Identifiers | None = None) -> list[str]:
    """What minimise() would still remove. Empty means clean."""
    probe = minimise(text, identifiers)
    return [kind for kind, n in probe.removed.items() if n and kind != "truncated"]


def assert_clean(payload: str, identifiers: Identifiers | None = None) -> None:
    """The final check on the assembled payload (§3 step 2)."""
    kinds = findings(payload, identifiers)
    if kinds:
        raise OutboundPolicyError(kinds)


_LINK_TYPES = (
    ("github", re.compile(r"(?i)\bhttps?://(?:www\.)?github\.com/[A-Za-z0-9_.-]+/?[^\s]*")),
    ("linkedin", re.compile(r"(?i)\bhttps?://(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?")),
)


def extract_links(text: str, *, limit: int = 10) -> list[dict]:
    """Self-profile links parsed locally into a non-model field (§3), so
    the model never has to recreate a URL it was not shown."""
    links: list[dict] = []
    seen: set[str] = set()
    clean = normalise(text)
    for link_type, pattern in _LINK_TYPES:
        for match in pattern.finditer(clean):
            url = match.group(0).rstrip(".,;)")
            if url.lower() not in seen:
                seen.add(url.lower())
                links.append({"type": link_type, "url": url})
    for match in _URL.finditer(clean):
        url = match.group(0).rstrip(".,;)")
        if url.lower() in seen or not url.lower().startswith("http"):
            continue
        seen.add(url.lower())
        links.append({"type": "other", "url": url})
    return links[:limit]
