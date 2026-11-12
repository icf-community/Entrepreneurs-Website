"""The outbound privacy boundary (app/privacy.py, AI-plan §3)."""

from __future__ import annotations

import pytest

from app import privacy
from app.privacy import Identifiers, OutboundPolicyError, assert_clean, extract_links, minimise

JANE = Identifiers(names=("Jane", "Doe"), exact=("jane.doe@imperial.ac.uk", "janedoe"), github_username="janedoe")


def test_removes_the_members_own_names_and_identifiers() -> None:
    out = minimise("Jane Doe built it. Contact jane.doe@imperial.ac.uk or github.com/janedoe.", JANE)
    assert "Jane" not in out.text and "Doe" not in out.text
    assert "jane.doe" not in out.text and "janedoe" not in out.text
    assert out.removed["name"] >= 1


@pytest.mark.parametrize(
    "text",
    [
        "Reach me at someone.else@example.com",
        "See https://example.com/portfolio",
        "Portfolio: www.example.org",
        "Call +44 7700 900123",
        "Mobile 07700 900123",
        "Lives at 221 Baker Street",
        "London SW7 2AZ",
        "Date of birth: 12 March 2001",
        "token = ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "key sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        "Follow @someone_handle",
        "site: janesmith.dev",
    ],
)
def test_removes_contact_patterns_and_secrets(text: str) -> None:
    out = minimise(text)
    assert out.removed, text
    assert findings_after(out.text) == []


def findings_after(text: str) -> list[str]:
    return privacy.findings(text)


@pytest.mark.parametrize(
    "token",
    ["C++", "C#", ".NET", "ASP.NET", "Node.js", "Next.js", "Socket.IO", "R", "Go", "2019-2023", "v1.2.3"],
)
def test_keeps_technical_tokens(token: str) -> None:
    text = f"Experienced with {token} in production."
    assert minimise(text).text == text


def test_a_surname_that_is_a_technology_keeps_the_skill() -> None:
    ids = Identifiers(names=("Taylor", "Swift"))
    out = minimise("Taylor Swift writes Swift for iOS.", ids)
    assert "Taylor" not in out.text
    assert "writes Swift" in out.text


def test_normalises_zero_width_and_control_characters() -> None:
    assert minimise("Py​Torch\x07 work").text == "PyTorch  work"


def test_assert_clean_refuses_a_payload_with_contact_details() -> None:
    with pytest.raises(OutboundPolicyError) as exc:
        assert_clean("Candidate: reach them at x@y.com")
    assert exc.value.kinds == ["email"]


def test_assert_clean_refuses_the_members_own_name_after_assembly() -> None:
    with pytest.raises(OutboundPolicyError):
        assert_clean('{"summary": "Jane built a compiler"}', JANE)


def test_assert_clean_accepts_minimised_text() -> None:
    text = minimise("Jane Doe, jane.doe@imperial.ac.uk, +44 7700 900123, built a PyTorch model.", JANE).text
    assert_clean(text, JANE)


def test_max_chars_bounds_the_payload() -> None:
    out = minimise("a" * 100, max_chars=10)
    assert len(out.text) == 10 and out.removed["truncated"] == 1


def test_links_are_parsed_locally_not_by_the_model() -> None:
    links = extract_links("GitHub https://github.com/janedoe and https://www.linkedin.com/in/jane-doe/ and https://jane.dev")
    assert {"type": "github", "url": "https://github.com/janedoe"} in links
    assert {"type": "linkedin", "url": "https://www.linkedin.com/in/jane-doe/"} in links
    assert {"type": "other", "url": "https://jane.dev"} in links


def test_identifiers_from_row() -> None:
    ids = Identifiers.from_row({"first_name": "Ana", "surname": "Lopez", "email": "a@b.co", "github_username": "anal"})
    assert ids.names == ("Ana", "Lopez")
    assert "a@b.co" in ids.exact and ids.github_username == "anal"
