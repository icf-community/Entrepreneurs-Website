"""Concept matching (app/concepts.py, AI-plan §4, §7)."""

from __future__ import annotations

from app.concepts import Dictionary, slugify

ROWS = [
    ("pytorch", "PyTorch", "tool", ["pytorch"], False),
    ("tensorflow", "TensorFlow", "tool", ["tensorflow"], False),
    ("deep-learning", "Deep learning", "area", ["deep learning"], False),
    ("cpp", "C++", "language", ["c++", "cpp"], False),
    ("c-lang", "C", "language", ["c"], True),
    ("csharp", "C#", "language", ["c#", "csharp"], False),
    ("golang", "Go", "language", ["golang", "go"], True),
    ("flask", "Flask", "tool", ["flask"], True),
    ("dotnet", ".NET", "tool", [".net", "dotnet", "asp.net"], False),
    ("chess", "Chess", "interest", ["chess"], False),
    ("python", "Python", "language", ["python"], False),
]
RELATIONS = [
    ("pytorch", "deep-learning", "part_of", 1),
    ("tensorflow", "deep-learning", "part_of", 1),
    ("pytorch", "tensorflow", "related_to", 0.5),
    ("tensorflow", "pytorch", "related_to", 0.5),
]
D = Dictionary.from_rows(ROWS, RELATIONS)


def slugs(text: str) -> list[str]:
    return [m.slug for m in D.find(text)]


def test_exact_aliases_only() -> None:
    assert slugs("Built models in PyTorch and TensorFlow") == ["pytorch", "tensorflow"]
    assert slugs("torchvision") == []


def test_tokens_with_symbols_stay_whole() -> None:
    assert slugs("C++ and C# and ASP.NET") == ["cpp", "csharp", "dotnet"]
    assert "c-lang" not in slugs("C++ only")


def test_ambiguous_aliases_need_technical_context() -> None:
    assert slugs("I go to the gym") == []
    assert slugs("a flask of tea") == []
    assert "golang" in slugs("backend services written in Go")
    assert "flask" in slugs("REST API in Flask and Python")


def test_negated_and_aspirational_mentions_are_not_positive() -> None:
    found = {m.slug: m.polarity for m in D.find("No experience with PyTorch; learning TensorFlow; use Python")}
    assert found == {"pytorch": "negative", "tensorflow": "aspirational", "python": "positive"}
    assert D.positive("No experience with PyTorch") == []


def test_broad_criteria_expand_to_their_specific_children_only() -> None:
    assert D.expand_broad("deep-learning") == {"deep-learning", "pytorch", "tensorflow"}
    assert D.expand_broad("pytorch") == {"pytorch"}
    assert D.related["pytorch"] == {"tensorflow": 0.5}


def test_slugify_matches_the_dictionary_migration() -> None:
    assert slugify("Deep learning") == "deep-learning"
    assert slugify("3D modelling / animation") == "3d-modelling-animation"
    assert slugify("R (statistics)") == "r-statistics"
