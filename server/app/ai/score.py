"""Deterministic, evidence-bound scoring (AI-plan §7, §7.1, §7.3).

The model never supplies a score. It contributes, at most, states for
free-text criteria it was asked about and a task/depth rating; every
concept criterion's state is computed here from the candidate's own
evidence lines, which carry the concepts the worker found in them.

  coverage   each requested need (an atom, or an OR-group of atoms) has a
             weight; when both specific (tools, languages, methods, exact
             phrases) and broad (areas, interests) needs are requested,
             specific needs share two-thirds and broad one-third (§7.3).
             met = 1; related evidence = 0.5 in network mode or when
             transferable credit was asked for, otherwise 0; unknown and
             not evidenced = 0.
  score      network: round(100 × coverage).
             recruiter / opportunities: round(60 × coverage + 25 × task
             + 15 × depth); if task/depth could not be assessed the score
             is coverage alone, renormalised, and says so.
  tier       meets: every required need is met exactly (related credit
             never satisfies a requirement). possible: none is shown
             missing, some are unknown. partial: a required need is not
             evidenced — never presented as meeting it.

Adding unrelated candidates cannot change anyone's score: nothing here
looks at the pool.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..concepts import Dictionary

SPECIFIC_KINDS = frozenset({"tool", "language", "method", "free"})
SCORED_KINDS = frozenset({"tool", "language", "method", "area", "interest", "free", "seek", "offer"})
_LEVELS = {"none": 0.0, "some": 0.5, "strong": 1.0}
_STATE_ORDER = {"met": 3, "related": 2, "unknown": 1, "not_evidenced": 0}
_TIER_RANK = {"meets": 2, "possible": 1, "partial": 0}


@dataclass(frozen=True)
class Atom:
    id: str
    kind: str
    concept: str | None
    free_text: str | None
    required: bool
    negated: bool = False
    group: str | None = None
    source: str = "command"
    expires_at: str | None = None

    @classmethod
    def from_json(cls, a: dict) -> Atom:
        return cls(
            id=str(a.get("id")),
            kind=str(a.get("kind")),
            concept=a.get("concept"),
            free_text=a.get("free_text"),
            required=bool(a.get("required")),
            negated=bool(a.get("negated")),
            group=a.get("group"),
            source=((a.get("source") or {}).get("type") or "command"),
            expires_at=((a.get("source") or {}).get("expires_at")),
        )

    @property
    def specific(self) -> bool:
        return self.kind in SPECIFIC_KINDS


@dataclass(frozen=True)
class Criterion:
    id: str
    atoms: tuple[Atom, ...]
    required: bool
    specific: bool


@dataclass
class AtomState:
    state: str  # met | related | unknown | not_evidenced
    evidence_ids: list = field(default_factory=list)


@dataclass
class Scored:
    score: int | None
    tier: str
    exact_tier: int
    coverage: list[dict]
    components: dict


def _fraction(value: str | float) -> float:
    """The assessor reports none/some/strong; fixtures and evals may pass a
    fraction directly (AI-evaluation-plan §3)."""
    if isinstance(value, str):
        return _LEVELS[value]
    return max(0.0, min(1.0, float(value)))


def round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def criteria_from_atoms(atoms: list[Atom]) -> list[Criterion]:
    out: list[Criterion] = []
    groups: dict[str, list[Atom]] = {}
    for atom in atoms:
        if atom.negated or atom.kind not in SCORED_KINDS:
            continue
        if atom.group:
            groups.setdefault(atom.group, []).append(atom)
        else:
            out.append(Criterion(atom.id, (atom,), atom.required, atom.specific))
    for gid, members in groups.items():
        out.append(Criterion(gid, tuple(members), any(a.required for a in members), any(a.specific for a in members)))
    return out


def weights(criteria: list[Criterion]) -> dict[str, float]:
    specific = [c for c in criteria if c.specific]
    broad = [c for c in criteria if not c.specific]
    if specific and broad:
        return {**{c.id: (2 / 3) / len(specific) for c in specific}, **{c.id: (1 / 3) / len(broad) for c in broad}}
    if not criteria:
        return {}
    return {c.id: 1 / len(criteria) for c in criteria}


def concept_state(atom: Atom, evidence: list[dict], d: Dictionary, *, substantial: bool) -> AtomState:
    """A concept criterion against a candidate's own evidence lines.

    Broad areas are supported by their specific children (PyTorch counts
    for Deep Learning), never the other way round. A 'seek' criterion (the
    searcher wants help with X) is met by someone offering or evidencing
    X; an 'offer' criterion by someone seeking it."""
    assert atom.concept
    if atom.kind == "area":
        targets = d.expand_broad(atom.concept)
    else:
        targets = {atom.concept}
    positive = [e for e in evidence if e.get("polarity", "positive") == "positive"]

    def kinds_ok(e: dict) -> bool:
        if atom.kind == "seek":
            return e.get("kind") != "seek"
        if atom.kind == "offer":
            return e.get("kind") == "seek"
        return e.get("kind") not in ("seek", "offer")

    hits = [e["id"] for e in positive if kinds_ok(e) and targets & set(e.get("concepts") or [])]
    if hits:
        return AtomState("met", hits[:4])
    related = set()
    for target in targets:
        related |= set(d.related.get(target, {}))
    near = [e["id"] for e in positive if kinds_ok(e) and related & set(e.get("concepts") or [])]
    if near:
        return AtomState("related", near[:4])
    return AtomState("not_evidenced" if substantial else "unknown")


def criterion_state(criterion: Criterion, states: dict[str, AtomState]) -> AtomState:
    best = max((states.get(a.id, AtomState("unknown")) for a in criterion.atoms),
               key=lambda s: _STATE_ORDER[s.state])
    return best


def score_candidate(
    mode: str,
    criteria: list[Criterion],
    states: dict[str, AtomState],
    *,
    task: str | float | None,
    depth: str | float | None,
    transferable: bool,
) -> Scored | None:
    if not criteria:
        return None
    w = weights(criteria)
    coverage_value = 0.0
    coverage_rows: list[dict] = []
    required_states: list[str] = []
    exact = 0
    for criterion in criteria:
        state = criterion_state(criterion, states)
        if state.state == "met":
            credit = 1.0
        elif state.state == "related" and (mode == "network" or transferable):
            credit = 0.5
        else:
            credit = 0.0
        coverage_value += w[criterion.id] * credit
        if criterion.required:
            required_states.append(state.state)
        if state.state == "met" and criterion.specific:
            exact += 1
        for atom in criterion.atoms:
            atom_state = states.get(atom.id, AtomState("unknown"))
            coverage_rows.append({
                "atom": atom.id, "kind": atom.kind, "concept": atom.concept, "free_text": atom.free_text,
                "required": criterion.required, "group": atom.group, "state": atom_state.state,
            })

    components: dict = {"coverage": round(coverage_value, 4)}
    if mode == "network":
        score = round_half_up(100 * coverage_value)
    elif task is None or depth is None:
        score = round_half_up(100 * coverage_value)
        components["coverage_only"] = True
    else:
        t, dp = _fraction(task), _fraction(depth)
        components.update(task=t, depth=dp)
        score = round_half_up(60 * coverage_value + 25 * t + 15 * dp)

    if required_states and all(s == "met" for s in required_states):
        tier = "meets"
    elif any(s == "not_evidenced" for s in required_states):
        tier = "partial"
    elif required_states:
        tier = "possible"
    else:
        tier = "meets" if coverage_value > 0 else "partial"
    return Scored(score=max(0, min(100, score)), tier=tier, exact_tier=exact, coverage=coverage_rows,
                  components=components)


def order_key(scored: Scored, retrieval_rank: int) -> tuple:
    """Eligibility tier first, then exact coverage of named tools, then the
    evidence score, then retrieval order as a stable tie-break (§7)."""
    return (-_TIER_RANK[scored.tier], -scored.exact_tier, -(scored.score or 0), retrieval_rank)
