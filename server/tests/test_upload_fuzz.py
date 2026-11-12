"""Mutation fuzz of the upload endpoints.

The structural cases (SVG, polyglot, bombs, scripted PDFs, ticket misuse) have
their own tests in test_images/test_documents/test_endpoints. This pins the
other half: a file that is *almost* valid, damaged at a random place, must be
refused with a 4xx or accepted cleanly, never crash the decoder into a 5xx. A
5xx here is an unhandled parser exception, which is both noise in Sentry and a
sign a parser path was never exercised.

Seeded, so a failure reproduces: the failing seed and mutation are in the
assertion message.
"""

from __future__ import annotations

import io
import random

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from .test_endpoints import (  # noqa: F401  (client is a fixture)
    CV_KEY,
    KEY,
    client,
    cv_ticket,
    jpeg,
    real_docx,
    real_pdf,
    ticket,
)

MUTATIONS_PER_SEED = 40
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _image(fmt: str) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 30, 60)).save(buf, format=fmt)
    return buf.getvalue()


def mutate(data: bytes, rng: random.Random) -> tuple[str, bytes]:
    kind = rng.choice(["flip", "truncate", "insert", "zero", "dup", "header", "swap"])
    b = bytearray(data)
    if kind == "flip":
        for _ in range(rng.randint(1, 8)):
            b[rng.randrange(len(b))] ^= 1 << rng.randrange(8)
    elif kind == "truncate":
        b = b[: rng.randrange(1, len(b))]
    elif kind == "insert":
        at = rng.randrange(len(b))
        b[at:at] = bytes(rng.randrange(256) for _ in range(rng.randint(1, 64)))
    elif kind == "zero":
        at = rng.randrange(len(b))
        n = rng.randint(1, 64)
        b[at : at + n] = b"\x00" * n
    elif kind == "dup":
        at = rng.randrange(len(b))
        b[at:at] = b[at : at + rng.randint(1, 128)]
    elif kind == "header":
        for i in range(min(len(b), 16)):
            if rng.random() < 0.3:
                b[i] = rng.randrange(256)
    else:
        i, j = rng.randrange(len(b)), rng.randrange(len(b))
        b[i], b[j] = b[j], b[i]
    return kind, bytes(b)


@pytest.mark.parametrize("name,make", [("jpeg", jpeg), ("png", lambda: _image("PNG")), ("webp", lambda: _image("WEBP"))])
def test_damaged_images_never_cause_a_server_error(client: TestClient, name: str, make) -> None:  # noqa: ANN001
    seed_bytes = make()
    rng = random.Random(f"img-{name}")
    outcomes: set[int] = set()
    for n in range(MUTATIONS_PER_SEED):
        kind, data = mutate(seed_bytes, rng)
        res = client.post(
            "/v1/images",
            headers={"Authorization": f"Bearer {ticket()}"},
            files={"file": ("p." + name, data, f"image/{name}")},
        )
        outcomes.add(res.status_code)
        assert res.status_code < 500, f"{name} mutation #{n} ({kind}) gave {res.status_code}: {res.text[:200]}"
        if res.status_code == 200:
            # Whatever survived was re-encoded, not stored verbatim.
            stored = client.written[("post-images", KEY)]  # type: ignore[attr-defined]
            assert stored[:4] == b"RIFF" and stored[8:12] == b"WEBP", f"{name} #{n} ({kind}) stored a non-WebP"
    assert outcomes & {400, 413, 415, 422}, f"{name}: no mutation was ever refused ({outcomes}); the fuzzer is not biting"


@pytest.mark.parametrize("name,make,mime", [("pdf", real_pdf, "application/pdf"), ("docx", real_docx, DOCX_MIME)])
def test_damaged_documents_never_cause_a_server_error(client: TestClient, name: str, make, mime: str) -> None:  # noqa: ANN001
    seed_bytes = make()
    rng = random.Random(f"doc-{name}")
    outcomes: set[int] = set()
    for n in range(MUTATIONS_PER_SEED):
        kind, data = mutate(seed_bytes, rng)
        res = client.post(
            "/v1/documents",
            headers={"Authorization": f"Bearer {cv_ticket()}"},
            files={"file": ("cv." + name, data, mime)},
        )
        outcomes.add(res.status_code)
        assert res.status_code < 500, f"{name} mutation #{n} ({kind}) gave {res.status_code}: {res.text[:200]}"
    assert outcomes & {400, 413, 415, 422}, f"{name}: no mutation was ever refused ({outcomes}); the fuzzer is not biting"


def test_hostile_filenames_and_content_types_are_inert(client: TestClient) -> None:
    """The stored key comes from the ticket, never from the upload's own name."""
    for fname in ["../../etc/passwd", "a\x00b.jpg", "x" * 5000 + ".jpg", "CON", "..\\..\\evil.jpg", "<script>.jpg", ""]:
        res = client.post(
            "/v1/images",
            headers={"Authorization": f"Bearer {ticket()}"},
            files={"file": (fname, jpeg(), "image/jpeg")},
        )
        assert res.status_code < 500, f"filename {fname[:20]!r} gave {res.status_code}"
        if res.status_code == 200:
            assert res.json()["key"] == KEY
    written = client.written  # type: ignore[attr-defined]
    assert all(k[1] in (KEY, CV_KEY) for k in written), f"unexpected keys stored: {list(written)}"
    for ctype in ["text/html", "application/x-php", "image/svg+xml", "", "garbage"]:
        res = client.post(
            "/v1/images",
            headers={"Authorization": f"Bearer {ticket()}"},
            files={"file": ("p.jpg", jpeg(), ctype)},
        )
        assert res.status_code < 500
