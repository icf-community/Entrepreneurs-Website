"""End-to-end tests for the HTTP surface.

Storage is stubbed — these cover the request path, not Azure. The point is
that the wiring holds: an unauthorised request never reaches the decoder, an
oversized body is cut off before it is buffered, and a rejected image or
document never reaches storage.
"""

from __future__ import annotations

import io
import time
import zipfile

import jwt
import pikepdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image

SECRET = "test-secret-not-a-real-key-padded-to-length"
SERVICE_TOKEN = "service-token-value-padded-to-length-here"
KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp"
CV_KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cv"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("UPLOAD_TICKET_SECRET", SECRET)
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "teststorage")
    monkeypatch.setenv("AZURE_BLOB_CONTAINER", "post-images")
    monkeypatch.setenv("AZURE_AVATAR_CONTAINER", "profile-pictures")
    monkeypatch.setenv("AZURE_CV_CONTAINER", "member-cvs")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://example.test")
    monkeypatch.setenv("MAX_UPLOAD_BYTES", str(1024 * 1024))
    monkeypatch.setenv("MAX_DOCUMENT_BYTES", str(1024 * 1024))

    from app import config

    config.settings.cache_clear()

    from app import main

    # Azure is never contacted in tests. The writes are recorded so the
    # assertions can check what would have been stored, and in which
    # container — that distinction is the whole point of this generalising
    # pass over the single-container original.
    written: dict[tuple[str, str], bytes] = {}
    deleted: list[tuple[str, str]] = []

    def _put(container: str, key: str, data: bytes, **_kw: object) -> None:
        written[(container, key)] = data

    def _delete(container: str, key: str) -> bool:
        deleted.append((container, key))
        return True

    monkeypatch.setattr(main, "put_blob", _put)
    monkeypatch.setattr(main, "delete_blob", _delete)

    c = TestClient(main.app)
    c.written = written  # type: ignore[attr-defined]
    c.deleted = deleted  # type: ignore[attr-defined]
    return c


def ticket(**overrides: object) -> str:
    claims: dict[str, object] = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "purpose": "post_image",
        "key": KEY,
        "max_bytes": 1024 * 1024,
        "exp": int(time.time()) + 300,
    }
    claims.update(overrides)
    return jwt.encode(claims, SECRET, algorithm="HS256")


def jpeg(size: tuple[int, int] = (400, 300)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(buf, format="JPEG")
    return buf.getvalue()


def real_docx() -> bytes:
    """A minimal but structurally real .docx — a zip with word/document.xml."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "word/document.xml",
            "<w:document xmlns:w=\"x\"><w:body><w:p/></w:body></w:document>",
        )
        zf.writestr("[Content_Types].xml", "<Types/>")
    return buf.getvalue()


def docm_disguised_as_docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", "<w:document/>")
        zf.writestr("word/vbaProject.bin", b"\x00" * 32)
    return buf.getvalue()


def zip_bomb_docx() -> bytes:
    """One entry whose declared uncompressed size vastly exceeds compressed."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", "<w:document/>")
        zf.writestr("word/media/huge.bin", b"\x00" * (5 * 1024 * 1024))
    return buf.getvalue()


def real_pdf() -> bytes:
    """A minimal but structurally real, unencrypted, action-free PDF.

    documents.py now actually parses the PDF object graph (pikepdf) rather
    than checking magic bytes plus a substring search, so a fake-but-
    plausible blob like the old `b"%PDF-1.4\\n" + b"x" * 300` no longer
    passes — pikepdf correctly rejects it as unreadable, same as it would a
    genuinely corrupt upload.
    """
    buf = io.BytesIO()
    with pikepdf.Pdf.new() as pdf:
        pdf.add_blank_page()
        pdf.save(buf)
    return buf.getvalue()


def test_health_needs_no_auth(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_uploads_and_stores_a_sanitised_image(client: TestClient) -> None:
    res = client.post(
        "/v1/images",
        headers={"Authorization": f"Bearer {ticket()}"},
        files={"file": ("photo.jpg", jpeg(), "image/jpeg")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["key"] == KEY
    assert (body["width"], body["height"]) == (400, 300)

    # What reached storage is re-encoded WebP, not the bytes that arrived,
    # and it landed in the post-images container this ticket resolved to.
    assert client.written[("post-images", KEY)][:4] == b"RIFF"  # type: ignore[attr-defined]


def test_uploads_a_profile_picture_into_its_own_container_at_a_smaller_edge(
    client: TestClient,
) -> None:
    avatar_key = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp"
    res = client.post(
        "/v1/images",
        headers={"Authorization": f"Bearer {ticket(purpose='profile_picture')}"},
        files={"file": ("photo.jpg", jpeg((2000, 2000)), "image/jpeg")},
    )
    assert res.status_code == 200
    body = res.json()
    # Bounded to the avatar edge, not the feed's 1600px ceiling.
    assert body["width"] <= 512 and body["height"] <= 512
    assert ("profile-pictures", avatar_key) in client.written  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer nonsense"}, {"Authorization": "Basic abc"}],
)
def test_rejects_unauthorised_uploads_before_decoding(
    client: TestClient, headers: dict[str, str]
) -> None:
    res = client.post("/v1/images", headers=headers, files={"file": ("p.jpg", jpeg(), "image/jpeg")})
    assert res.status_code == 401
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_an_oversized_body(client: TestClient) -> None:
    """The cap is enforced while reading, not after.

    Checking len() on a fully-buffered body would mean the cost is paid
    before the check runs, which lets the client choose how much memory we
    spend. Content-Length is no help either — it is a claim.
    """
    big = jpeg((3000, 3000)) + b"\x00" * (1024 * 1024)
    res = client.post(
        "/v1/images",
        headers={"Authorization": f"Bearer {ticket()}"},
        files={"file": ("big.jpg", big, "image/jpeg")},
    )
    assert res.status_code == 413
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_an_svg_upload(client: TestClient) -> None:
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    res = client.post(
        "/v1/images",
        headers={"Authorization": f"Bearer {ticket()}"},
        # Content-Type deliberately lies. It is never consulted.
        files={"file": ("logo.png", svg, "image/png")},
    )
    assert res.status_code == 415
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_an_empty_upload(client: TestClient) -> None:
    res = client.post(
        "/v1/images",
        headers={"Authorization": f"Bearer {ticket()}"},
        files={"file": ("empty.jpg", b"", "image/jpeg")},
    )
    assert res.status_code == 400


def test_images_endpoint_rejects_a_cv_ticket(client: TestClient) -> None:
    """A ticket is purpose-specific — presenting a CV ticket at the image
    endpoint (or vice versa, tested below) must not silently work."""
    res = client.post(
        "/v1/images",
        headers={"Authorization": f"Bearer {ticket(purpose='cv', key=CV_KEY)}"},
        files={"file": ("photo.jpg", jpeg(), "image/jpeg")},
    )
    assert res.status_code == 400
    assert client.written == {}  # type: ignore[attr-defined]


# ─── /v1/documents ───────────────────────────────────────────────────


def cv_ticket(**overrides: object) -> str:
    claims: dict[str, object] = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "purpose": "cv",
        "key": CV_KEY,
        "max_bytes": 1024 * 1024,
        "exp": int(time.time()) + 300,
    }
    claims.update(overrides)
    return jwt.encode(claims, SECRET, algorithm="HS256")


def test_uploads_a_pdf_cv_unmodified(client: TestClient) -> None:
    pdf = real_pdf()
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={"file": ("cv.pdf", pdf, "application/pdf")},
    )
    assert res.status_code == 200
    assert res.json()["key"] == CV_KEY
    # Stored verbatim — no re-encoding, unlike the image path.
    assert client.written[("member-cvs", CV_KEY)] == pdf  # type: ignore[attr-defined]


def test_uploads_a_docx_cv(client: TestClient) -> None:
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={
            "file": (
                "cv.docx",
                real_docx(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert res.status_code == 200
    assert ("member-cvs", CV_KEY) in client.written  # type: ignore[attr-defined]


def test_rejects_a_password_protected_pdf(client: TestClient) -> None:
    buf = io.BytesIO()
    with pikepdf.Pdf.new() as pdf:
        pdf.add_blank_page()
        pdf.save(buf, encryption=pikepdf.Encryption(owner="ownerpw", user="userpw"))
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={"file": ("cv.pdf", buf.getvalue(), "application/pdf")},
    )
    assert res.status_code == 415
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_a_pdf_with_an_open_action_script(client: TestClient) -> None:
    buf = io.BytesIO()
    with pikepdf.Pdf.new() as pdf:
        pdf.add_blank_page()
        pdf.Root.OpenAction = pdf.make_indirect(
            pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert('pwned')"))
        )
        pdf.save(buf)
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={"file": ("cv.pdf", buf.getvalue(), "application/pdf")},
    )
    assert res.status_code == 415
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_an_unreadable_pdf(client: TestClient) -> None:
    """Magic bytes claim PDF; the rest is garbage — distinct from the
    encrypted case, and from the old naive check this replaced, which
    couldn't tell the two apart from a substring search either way."""
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={"file": ("cv.pdf", b"%PDF-1.4\n" + b"x" * 300, "application/pdf")},
    )
    assert res.status_code == 415
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_a_docm_disguised_as_docx(client: TestClient) -> None:
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={
            "file": (
                "cv.docm",
                docm_disguised_as_docx(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert res.status_code == 415
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_a_zip_bomb_docx(client: TestClient) -> None:
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={
            "file": (
                "cv.docx",
                zip_bomb_docx(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert res.status_code == 415
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_a_file_that_is_neither_pdf_nor_docx(client: TestClient) -> None:
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={"file": ("cv.txt", b"just some text " * 30, "text/plain")},
    )
    assert res.status_code == 415
    assert client.written == {}  # type: ignore[attr-defined]


def test_documents_endpoint_rejects_a_post_image_ticket(client: TestClient) -> None:
    """The exact reverse of test_images_endpoint_rejects_a_cv_ticket —
    ticket-purpose confusion has to fail in both directions."""
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {ticket()}"},  # purpose=post_image
        files={"file": ("cv.pdf", real_pdf(), "application/pdf")},
    )
    assert res.status_code == 400
    assert client.written == {}  # type: ignore[attr-defined]


def test_rejects_an_oversized_document(client: TestClient) -> None:
    big = real_pdf() + b"\x00" * (2 * 1024 * 1024)
    res = client.post(
        "/v1/documents",
        headers={"Authorization": f"Bearer {cv_ticket()}"},
        files={"file": ("cv.pdf", big, "application/pdf")},
    )
    assert res.status_code == 413
    assert client.written == {}  # type: ignore[attr-defined]


# ─── /v1/blobs/delete ────────────────────────────────────────────────


def test_delete_requires_the_service_token(client: TestClient) -> None:
    res = client.post(
        "/v1/blobs/delete", json={"items": [{"key": KEY, "container": "post-images"}]}
    )
    assert res.status_code == 401

    res = client.post(
        "/v1/blobs/delete",
        headers={"Authorization": "Bearer wrong-token"},
        json={"items": [{"key": KEY, "container": "post-images"}]},
    )
    assert res.status_code == 401
    assert client.deleted == []  # type: ignore[attr-defined]


def test_delete_removes_items_from_their_own_containers(client: TestClient) -> None:
    res = client.post(
        "/v1/blobs/delete",
        headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        json={
            "items": [
                {"key": KEY, "container": "post-images"},
                {"key": CV_KEY, "container": "member-cvs"},
            ]
        },
    )
    assert res.status_code == 200
    assert res.json()["deleted"] == 2
    assert set(client.deleted) == {("post-images", KEY), ("member-cvs", CV_KEY)}  # type: ignore[attr-defined]


def test_delete_rejects_a_malformed_or_oversized_payload(client: TestClient) -> None:
    auth = {"Authorization": f"Bearer {SERVICE_TOKEN}"}
    assert client.post("/v1/blobs/delete", headers=auth, json={"items": "nope"}).status_code == 400
    assert client.post("/v1/blobs/delete", headers=auth, json={}).status_code == 400
    assert (
        client.post(
            "/v1/blobs/delete",
            headers=auth,
            json={"items": [{"key": KEY, "container": "post-images"}] * 101},
        ).status_code
        == 400
    )


def test_delete_refuses_an_oversized_body_before_parsing_it(client: TestClient) -> None:
    # B22: nginx's body limit was the only bound; the handler parsed any
    # size into memory before counting items.
    auth = {"Authorization": f"Bearer {SERVICE_TOKEN}", "Content-Type": "application/json"}
    huge = '{"items": [], "pad": "' + ("x" * 200_000) + '"}'
    assert client.post("/v1/blobs/delete", headers=auth, content=huge).status_code == 413
    assert client.deleted == []  # type: ignore[attr-defined]


def test_delete_answers_bad_json_with_400_not_500(client: TestClient) -> None:
    auth = {"Authorization": f"Bearer {SERVICE_TOKEN}", "Content-Type": "application/json"}
    assert client.post("/v1/blobs/delete", headers=auth, content="{not json").status_code == 400
    assert client.post("/v1/blobs/delete", headers=auth, content="[1, 2]").status_code == 400


def test_delete_rejects_an_unrecognised_container(client: TestClient) -> None:
    auth = {"Authorization": f"Bearer {SERVICE_TOKEN}"}
    res = client.post(
        "/v1/blobs/delete",
        headers=auth,
        json={"items": [{"key": KEY, "container": "some-other-container"}]},
    )
    assert res.status_code == 400
    assert client.deleted == []  # type: ignore[attr-defined]


def test_delete_rejects_keys_that_do_not_match_their_containers_pattern(
    client: TestClient,
) -> None:
    """Holding the service token authorises deleting blobs in these three
    containers, not naming arbitrary objects. The key is a path component
    either way, so it is checked on arrival rather than trusted because the
    caller authenticated."""
    auth = {"Authorization": f"Bearer {SERVICE_TOKEN}"}
    bad_items = [
        {"key": "../../etc/passwd", "container": "post-images"},
        {"key": "not-a-uuid.webp", "container": "post-images"},
        {"key": f"{KEY[:-5]}.png", "container": "post-images"},
        {"key": f"nested/path/{KEY}", "container": "post-images"},
        {"key": "", "container": "post-images"},
        # A .webp key presented against the CV container's .cv pattern.
        {"key": KEY, "container": "member-cvs"},
    ]
    for item in bad_items:
        res = client.post("/v1/blobs/delete", headers=auth, json={"items": [item]})
        assert res.status_code == 400, f"accepted a bad item: {item!r}"

    # And nothing reached storage.
    assert client.deleted == []  # type: ignore[attr-defined]
