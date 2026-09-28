"""Tests for ticket verification.

The gateway trusts exactly one thing — a signed ticket — so these tests
cover the ways someone might try to forge, replay, or widen one.
"""

from __future__ import annotations

import time

import jwt
import pytest

# 32+ bytes: below that PyJWT warns about HMAC key length, and the real
# secret is generated with `openssl rand -base64 48`.
SECRET = "test-secret-not-a-real-key-padded-to-length"
KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UPLOAD_TICKET_SECRET", SECRET)
    monkeypatch.setenv("SERVICE_TOKEN", "service-token-value")
    monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "teststorage")
    monkeypatch.setenv("AZURE_BLOB_CONTAINER", "post-images")
    monkeypatch.setenv("AZURE_AVATAR_CONTAINER", "profile-pictures")
    monkeypatch.setenv("AZURE_CV_CONTAINER", "member-cvs")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://example.test")
    from app.config import settings

    settings.cache_clear()


def make_ticket(secret: str = SECRET, **overrides: object) -> str:
    claims: dict[str, object] = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "purpose": "post_image",
        "key": KEY,
        "max_bytes": 8 * 1024 * 1024,
        "iat": int(time.time()),
        "exp": int(time.time()) + 300,
    }
    claims.update(overrides)
    return jwt.encode(claims, secret, algorithm="HS256")


def test_accepts_a_well_formed_ticket() -> None:
    from app.auth import verify_ticket

    ticket = verify_ticket(f"Bearer {make_ticket()}")
    assert ticket.key == KEY
    assert ticket.purpose == "post_image"


@pytest.mark.parametrize(
    "header",
    [None, "", "Basic abc", "Bearer", "Bearer not-a-jwt", "nonsense"],
)
def test_rejects_malformed_authorization_headers(header: str | None) -> None:
    from app.auth import InvalidTicket, verify_ticket

    with pytest.raises(InvalidTicket):
        verify_ticket(header)


def test_rejects_a_ticket_signed_with_another_secret() -> None:
    from app.auth import InvalidTicket, verify_ticket

    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {make_ticket(secret='wrong-secret-also-padded-to-length-here')}")


def test_rejects_an_expired_ticket() -> None:
    from app.auth import InvalidTicket, verify_ticket

    expired = make_ticket(exp=int(time.time()) - 10)
    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {expired}")


def test_rejects_the_none_algorithm() -> None:
    """Algorithm confusion: a token declaring it needs no signature.

    Pinning algorithms=["HS256"] in verify_ticket is what stops this. It is
    the classic JWT vulnerability and the reason that argument is never
    left to default.
    """
    from app.auth import InvalidTicket, verify_ticket

    forged = jwt.encode(
        {
            "sub": "attacker",
            "purpose": "post_image",
            "key": KEY,
            "max_bytes": 8 * 1024 * 1024,
            "exp": int(time.time()) + 300,
        },
        key="",
        algorithm="none",
    )
    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {forged}")


@pytest.mark.parametrize(
    "bad_key",
    [
        "../../../etc/passwd",
        "not-a-uuid.webp",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp/../other.webp",
        "",
    ],
)
def test_rejects_a_ticket_naming_an_unacceptable_key(bad_key: str) -> None:
    """A key out of a token becomes a path component.

    Validated here as well as at issue time, so a compromised signing key
    still cannot direct a write outside the expected shape.
    """
    from app.auth import InvalidTicket, verify_ticket

    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {make_ticket(key=bad_key)}")


def test_rejects_a_ticket_for_an_unrecognised_purpose() -> None:
    from app.auth import InvalidTicket, verify_ticket

    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {make_ticket(purpose='something_else')}")


def test_rejects_a_purpose_and_key_extension_mismatch() -> None:
    """A cv-purpose ticket naming a .webp key (or vice versa) is exactly
    the shape a compromised signing key would produce to smuggle a CV
    into the image container, or an image into the CV container."""
    from app.auth import InvalidTicket, verify_ticket

    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {make_ticket(purpose='cv', key=KEY)}")  # KEY ends .webp

    cv_key = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cv"
    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {make_ticket(purpose='post_image', key=cv_key)}")


def test_accepts_a_profile_picture_ticket() -> None:
    from app.auth import verify_ticket

    ticket = verify_ticket(f"Bearer {make_ticket(purpose='profile_picture')}")
    assert ticket.purpose == "profile_picture"
    assert ticket.container == "profile-pictures"


def test_accepts_a_cv_ticket_and_resolves_its_own_container() -> None:
    from app.auth import verify_ticket

    cv_key = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cv"
    ticket = verify_ticket(f"Bearer {make_ticket(purpose='cv', key=cv_key)}")
    assert ticket.purpose == "cv"
    assert ticket.container == "member-cvs"


def test_post_image_ticket_resolves_its_own_container() -> None:
    from app.auth import verify_ticket

    ticket = verify_ticket(f"Bearer {make_ticket()}")
    assert ticket.container == "post-images"


def test_a_ticket_cannot_raise_the_server_size_ceiling() -> None:
    """max_bytes is a claim, and claims are clamped, not obeyed."""
    from app.auth import verify_ticket

    greedy = make_ticket(max_bytes=10 * 1024 * 1024 * 1024)
    assert verify_ticket(f"Bearer {greedy}").max_bytes == 8 * 1024 * 1024


def test_service_token_comparison_accepts_only_the_real_token() -> None:
    from app.auth import InvalidTicket, verify_service_token

    verify_service_token("Bearer service-token-value")
    with pytest.raises(InvalidTicket):
        verify_service_token("Bearer service-token-valu")
    with pytest.raises(InvalidTicket):
        verify_service_token("Bearer ")


# B21: bind the ticket to its purpose and issuer, so a token signed with the
# same secret for any other reason can't be replayed as an upload ticket.
# Rolled out in two steps: accept tickets with or without the claims for one
# release (old Next.js deploys are still minting), then require them.

AUD = "foundry-gateway-upload"
ISS = "foundry-web"


def test_accepts_a_ticket_with_the_right_audience_and_issuer() -> None:
    from app.auth import verify_ticket

    assert verify_ticket(f"Bearer {make_ticket(aud=AUD, iss=ISS)}").key == KEY


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "something-else", "iss": ISS},
        {"aud": AUD, "iss": "someone-else"},
        {"aud": ["other", AUD], "iss": ISS},
        {"aud": AUD},
        {"iss": ISS},
    ],
)
def test_rejects_a_wrong_or_partial_audience_or_issuer(overrides: dict[str, object]) -> None:
    from app.auth import InvalidTicket, verify_ticket

    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {make_ticket(**overrides)}")


def test_transition_still_accepts_a_ticket_without_the_claims() -> None:
    from app.auth import verify_ticket

    assert verify_ticket(f"Bearer {make_ticket()}").key == KEY


def test_once_required_a_ticket_without_the_claims_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UPLOAD_TICKET_REQUIRE_AUDIENCE", "true")
    from app.auth import InvalidTicket, verify_ticket
    from app.config import settings

    settings.cache_clear()
    with pytest.raises(InvalidTicket):
        verify_ticket(f"Bearer {make_ticket()}")
    assert verify_ticket(f"Bearer {make_ticket(aud=AUD, iss=ISS)}").key == KEY
