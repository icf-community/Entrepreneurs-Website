"""Deterministic scoring (app/ai/score.py, AI-plan §7, AI-evaluation-plan §3)."""

from __future__ import annotations

from app.ai.score import Atom, AtomState, concept_state, criteria_from_atoms, order_key, score_candidate, weights
from tests.test_concepts import D

DL = Atom(id="g1", kind="area", concept="deep-learning", free_text=None, required=False)
PT = Atom(id="t1", kind="tool", concept="pytorch", free_text=None, required=False)


def _score(atoms, states, task="some", depth="some", mode="recruiter", transferable=False):
    return score_candidate(mode, criteria_from_atoms(atoms), states, task=task, depth=depth,
                           transferable=transferable)


def test_eval_plan_fixture_broad_and_specific() -> None:
    """AI-evaluation-plan §3, recruiter-broad-and-specific-001: 20 broad +
    40 specific coverage points; scores 89 and 49; A before B."""
    w = weights(criteria_from_atoms([DL, PT]))
    assert round(w["t1"] * 60) == 40 and round(w["g1"] * 60) == 20
    a = score_candidate("recruiter", criteria_from_atoms([DL, PT]), {"g1": AtomState("met"), "t1": AtomState("met")},
                        task=0.8, depth=0.6, transferable=False)
    b = score_candidate("recruiter", criteria_from_atoms([DL, PT]),
                        {"g1": AtomState("met"), "t1": AtomState("related")}, task=0.8, depth=0.6,
                        transferable=False)
    assert (a.score, b.score) == (89, 49)
    assert order_key(a, 2) < order_key(b, 1)


def test_eval_plan_companions() -> None:
    req_pt = Atom(id="t1", kind="tool", concept="pytorch", free_text=None, required=True)
    # PyTorch required: TensorFlow-only B cannot be a qualified match.
    b = score_candidate("recruiter", criteria_from_atoms([DL, req_pt]),
                        {"g1": AtomState("met"), "t1": AtomState("related")}, task=0.8, depth=0.6,
                        transferable=False)
    assert b.tier != "meets"
    # PyTorch OR TensorFlow: both qualify.
    pt = Atom(id="t1", kind="tool", concept="pytorch", free_text=None, required=True, group="g9")
    tf = Atom(id="t2", kind="tool", concept="tensorflow", free_text=None, required=True, group="g9")
    either = score_candidate("recruiter", criteria_from_atoms([DL, pt, tf]),
                             {"g1": AtomState("met"), "t1": AtomState("not_evidenced"), "t2": AtomState("met")},
                             task=0.8, depth=0.6, transferable=False)
    assert either.tier == "meets" and either.score == 89
    # Broad-only search does not penalise the tool choice.
    broad = score_candidate("recruiter", criteria_from_atoms([DL]), {"g1": AtomState("met")}, task=0.8,
                            depth=0.6, transferable=False)
    assert broad.score == 89
    # (A duplicated ancestor can't reach scoring: ai_private.apply_spec_ops
    # collapses an identical criterion into the existing one; the SQL
    # smoke test covers it.)


def test_required_tool_is_never_met_by_a_related_tool() -> None:
    required = Atom(id="t1", kind="tool", concept="pytorch", free_text=None, required=True)
    scored = _score([DL, required], {"g1": AtomState("met"), "t1": AtomState("related")})
    assert scored.tier != "meets"
    assert scored.tier == "possible"


def test_or_group_is_met_by_either() -> None:
    a = Atom(id="a1", kind="tool", concept="pytorch", free_text=None, required=True, group="g1")
    b = Atom(id="a2", kind="tool", concept="tensorflow", free_text=None, required=True, group="g1")
    scored = _score([a, b], {"a1": AtomState("not_evidenced"), "a2": AtomState("met")})
    assert scored.tier == "meets" and scored.components["coverage"] == 1.0


def test_negated_atoms_are_filters_not_scored_criteria() -> None:
    neg = Atom(id="n1", kind="tool", concept="tensorflow", free_text=None, required=True, negated=True)
    assert [c.id for c in criteria_from_atoms([PT, neg])] == ["t1"]


def test_network_gives_half_credit_for_related_evidence() -> None:
    scored = _score([PT], {"t1": AtomState("related")}, mode="network")
    assert scored.score == 50
    scored = _score([PT], {"t1": AtomState("related")}, mode="recruiter")
    assert scored.components["coverage"] == 0


def test_transferable_credit_only_when_asked_for() -> None:
    off = _score([PT], {"t1": AtomState("related")}, task="none", depth="none")
    on = _score([PT], {"t1": AtomState("related")}, task="none", depth="none", transferable=True)
    assert off.score == 0 and on.score == 30


def test_unknown_and_not_evidenced_differ_in_tier_not_score() -> None:
    req = Atom(id="t1", kind="tool", concept="pytorch", free_text=None, required=True)
    unknown = _score([req], {"t1": AtomState("unknown")}, task="none", depth="none")
    missing = _score([req], {"t1": AtomState("not_evidenced")}, task="none", depth="none")
    assert unknown.score == missing.score == 0
    assert unknown.tier == "possible" and missing.tier == "partial"


def test_no_criteria_is_no_score_not_zero() -> None:
    assert score_candidate("network", [], {}, task=None, depth=None, transferable=False) is None


def test_missing_assessment_renormalises_and_says_so() -> None:
    scored = _score([PT], {"t1": AtomState("met")}, task=None, depth=None)
    assert scored.score == 100 and scored.components["coverage_only"] is True


def test_score_is_independent_of_the_pool() -> None:
    states = {"g1": AtomState("met"), "t1": AtomState("met")}
    alone = _score([DL, PT], states)
    again = _score([DL, PT], dict(states))
    assert alone.score == again.score


def test_tier_then_exact_coverage_then_score() -> None:
    meets_low = _score([PT], {"t1": AtomState("met")}, task="none", depth="none")
    partial_high = _score([Atom(id="t1", kind="tool", concept="pytorch", free_text=None, required=True), DL],
                          {"t1": AtomState("not_evidenced"), "g1": AtomState("met")}, task="strong", depth="strong")
    assert order_key(meets_low, 5) < order_key(partial_high, 1)


def test_concept_state_uses_evidence_concepts_only() -> None:
    evidence = [
        {"id": 1, "kind": "cv_skill", "concepts": ["pytorch"], "polarity": "positive"},
        {"id": 2, "kind": "bio_focus", "concepts": ["tensorflow"], "polarity": "negative"},
    ]
    assert concept_state(PT, evidence, D, substantial=True).state == "met"
    assert concept_state(DL, evidence, D, substantial=True).state == "met"  # PyTorch supports Deep learning
    tf = Atom(id="x", kind="tool", concept="tensorflow", free_text=None, required=True)
    # A negated mention is not evidence; the related PyTorch is.
    assert concept_state(tf, evidence, D, substantial=True).state == "related"
    assert concept_state(tf, [], D, substantial=False).state == "unknown"


def test_seek_is_met_by_an_offer_and_offer_by_a_seek() -> None:
    seek = Atom(id="s", kind="seek", concept="python", free_text=None, required=False)
    offer = Atom(id="o", kind="offer", concept="python", free_text=None, required=False)
    evidence = [{"id": 1, "kind": "offer", "concepts": ["python"]}, {"id": 2, "kind": "seek", "concepts": ["pytorch"]}]
    assert concept_state(seek, evidence, D, substantial=True).state == "met"
    assert concept_state(offer, evidence, D, substantial=True).state == "not_evidenced"
