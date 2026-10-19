"""The reviewed concept dictionary, and finding concepts in text.

Shared by the worker (building projections) and the AI executor
(interpreting searches). Matching is by exact alias only, never by
embedding similarity (AI-plan §4: no fuzzy grounding, no alias created
by a cosine threshold). The token boundary is the same one the database
uses to check grounding (ai_private.text_mentions): letters, digits, '+'
and '#' join a token, so C++, C# and .NET stay whole and "c" never
matches inside "c++".

Ambiguous aliases (go, rust, swift, c, spark, flask, unity …) only count
next to technical context, so "go to the gym" is not Go and "a flask in
the lab" is not Flask.

Polarity: a mention after "no", "not", "without", "never" … is negative,
and one after "learning", "want to learn", "interested in" is
aspirational. Neither is evidence that someone has done it (§7: source
negation is never positive evidence).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_BOUNDARY = "a-z0-9+#"


@dataclass(frozen=True)
class Concept:
    slug: str
    label: str
    kind: str
    aliases: tuple[str, ...]
    ambiguous: bool = False


@dataclass(frozen=True)
class Mention:
    slug: str
    start: int
    end: int
    polarity: str  # "positive" | "negative" | "aspirational"


_NEGATION = re.compile(r"\b(no|not|without|never|don't|dont|didn't|doesn't|doesnt|does not|did not|isn't|wasn't|"
                       r"lack(?:ing|s|ed)?|except|excluding|avoid(?:ed|s|ing)?|nor|zero)\b[^.;:!?\n]{0,30}$")
_ASPIRATION = re.compile(
    r"\b(learning|learn|want(?:s|ing)? to (?:learn|try|get into)|interested in learning|hoping to|plan(?:ning)? to "
    r"learn|curious about|beginner in|new to)\b[^.;:!?\n]{0,25}$"
)
_TECH_CONTEXT = re.compile(
    r"\b(programming|programmer|language|languages|code|coding|coded|developer|development|engineer|engineering|"
    r"framework|library|stack|backend|frontend|written in|built (?:with|in|using)|using|developed|software|scripts?|"
    r"api|apis|services?|microservices?|repo|repository|open[- ]source|compiler|runtime|game engine|lang)\b"
)


@dataclass
class Dictionary:
    concepts: dict[str, Concept]
    part_of: dict[str, set[str]] = field(default_factory=dict)  # specific → broad
    children: dict[str, set[str]] = field(default_factory=dict)  # broad → specific
    related: dict[str, dict[str, float]] = field(default_factory=dict)
    version: int = 1

    def __post_init__(self) -> None:
        surfaces: dict[str, list[str]] = {}
        for concept in self.concepts.values():
            for alias in set(concept.aliases) | {concept.label.lower()}:
                alias = alias.strip().lower()
                if alias:
                    surfaces.setdefault(alias, []).append(concept.slug)
        self._surfaces = surfaces
        alternation = "|".join(re.escape(a) for a in sorted(surfaces, key=len, reverse=True))
        self._pattern = re.compile(rf"(?<![{_BOUNDARY}])(?:{alternation})(?![{_BOUNDARY}])") if alternation else None
        tech = {s for s, c in self.concepts.items() if c.kind in ("tool", "language", "method") and not c.ambiguous}
        self._tech_slugs = tech

    @classmethod
    def from_rows(cls, concept_rows: list[tuple], relation_rows: list[tuple], version: int = 1) -> Dictionary:
        concepts = {
            row[0]: Concept(slug=row[0], label=row[1], kind=row[2], aliases=tuple(row[3] or ()), ambiguous=bool(row[4]))
            for row in concept_rows
        }
        part_of: dict[str, set[str]] = {}
        children: dict[str, set[str]] = {}
        related: dict[str, dict[str, float]] = {}
        for frm, to, relation, weight in relation_rows:
            if relation == "part_of":
                part_of.setdefault(frm, set()).add(to)
                children.setdefault(to, set()).add(frm)
            elif relation == "related_to":
                related.setdefault(frm, {})[to] = float(weight)
        return cls(concepts=concepts, part_of=part_of, children=children, related=related, version=version)

    def label(self, slug: str) -> str:
        concept = self.concepts.get(slug)
        return concept.label if concept else slug

    def find(self, text: str) -> list[Mention]:
        """Every concept mention in `text`, left to right, longest alias
        first at each position, with its polarity."""
        if not text or self._pattern is None:
            return []
        lower = text.lower()
        raw: list[tuple[str, int, int]] = []
        for match in self._pattern.finditer(lower):
            for slug in self._surfaces[match.group(0)]:
                raw.append((slug, match.start(), match.end()))
        if not raw:
            return []

        confident = {slug for slug, _, _ in raw if slug in self._tech_slugs}
        mentions: list[Mention] = []
        for slug, start, end in raw:
            concept = self.concepts[slug]
            if concept.ambiguous and not self._has_context(lower, start, end, confident - {slug}):
                continue
            mentions.append(Mention(slug=slug, start=start, end=end, polarity=self._polarity(lower, start)))
        return mentions

    def _has_context(self, lower: str, start: int, end: int, confident: set[str]) -> bool:
        if confident:
            return True
        window = lower[max(0, start - 40): end + 40]
        return _TECH_CONTEXT.search(window) is not None

    @staticmethod
    def _polarity(lower: str, start: int) -> str:
        before = lower[max(0, start - 45): start]
        if _NEGATION.search(before):
            return "negative"
        if _ASPIRATION.search(before):
            return "aspirational"
        return "positive"

    def positive(self, text: str) -> list[str]:
        """Concepts mentioned positively, de-duplicated, in order."""
        seen: list[str] = []
        for mention in self.find(text):
            if mention.polarity == "positive" and mention.slug not in seen:
                seen.append(mention.slug)
        return seen

    def expand_broad(self, slug: str) -> set[str]:
        """A broad criterion is supported by itself or any specific
        concept that is part of it (PyTorch supports Deep Learning). One
        level: the dictionary's part_of edges go straight to the area."""
        return {slug} | self.children.get(slug, set())


def slugify(name: str) -> str:
    """Same rule the dictionary migration used for directory skills."""
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
