"""Tests for the CV document validation boundary.

Everything reaching `sanitise` is attacker-controlled. The PDF branch is
the interesting one: it used to be a magic-bytes check plus a substring
search for "/Encrypt", which (a) could false-negative on anything hidden
inside a PDF's own object-stream compression and (b) had no opinion at all
on embedded JavaScript or /Launch actions — the same threat class as the
.docm macros this file already refuses outright. Each test below pins one
specific way a PDF can carry a live payload past the upload boundary.
"""

from __future__ import annotations

import io
import os
import zipfile

import pikepdf
import pytest

import app.documents as documents
from app.documents import MIN_BYTES, RejectedDocument, sanitise


def _pdf(build=lambda pdf: None) -> bytes:
    buf = io.BytesIO()
    with pikepdf.Pdf.new() as pdf:
        pdf.add_blank_page()
        build(pdf)
        pdf.save(buf)
    data = buf.getvalue()
    # pikepdf's own minimal output is well under MIN_BYTES; pad with a
    # comment so a deliberately tiny fixture doesn't trip the size floor
    # instead of the check under test.
    if len(data) < MIN_BYTES:
        data += b"\n% " + b"x" * (MIN_BYTES - len(data))
    return data


def clean_pdf() -> bytes:
    return _pdf()


# ─── Format allowlist ───────────────────────────────────────────────


def test_accepts_a_clean_pdf_unmodified() -> None:
    data = clean_pdf()
    result = sanitise(data)
    assert result.data == data  # verbatim — never re-encoded, unlike images
    assert result.content_type == "application/pdf"


def test_rejects_a_file_too_small_to_be_a_cv() -> None:
    with pytest.raises(RejectedDocument, match="too small"):
        sanitise(b"%PDF-1.4\nx")


def test_rejects_something_that_is_neither_pdf_nor_docx() -> None:
    with pytest.raises(RejectedDocument, match="PDF or Word"):
        sanitise(b"just some text " * 30)


def test_rejects_an_unparseable_pdf() -> None:
    """Magic bytes claim PDF; there's no real object graph behind them —
    distinct from encryption, and the case a plain substring search could
    never distinguish from a genuinely encrypted file."""
    with pytest.raises(RejectedDocument, match="could not be read"):
        sanitise(b"%PDF-1.4\n" + b"x" * 300 + b"\n%%EOF")


# ─── Encryption ──────────────────────────────────────────────────────


def test_rejects_a_pdf_with_a_real_user_password() -> None:
    buf = io.BytesIO()
    with pikepdf.Pdf.new() as pdf:
        pdf.add_blank_page()
        pdf.save(buf, encryption=pikepdf.Encryption(owner="ownerpw", user="userpw"))
    with pytest.raises(RejectedDocument, match="password-protected"):
        sanitise(buf.getvalue())


def test_rejects_owner_only_encryption_too() -> None:
    """No user password means pikepdf can open it without prompting, but
    the file is still encrypted — pdf.is_encrypted has to be checked
    explicitly, not just "did opening it raise"."""
    buf = io.BytesIO()
    with pikepdf.Pdf.new() as pdf:
        pdf.add_blank_page()
        pdf.save(buf, encryption=pikepdf.Encryption(owner="ownerpw", user=""))
    with pytest.raises(RejectedDocument, match="password-protected"):
        sanitise(buf.getvalue())


# ─── Embedded JavaScript / launch actions ───────────────────────────


def test_rejects_an_open_action_script() -> None:
    def build(pdf: pikepdf.Pdf) -> None:
        pdf.Root.OpenAction = pdf.make_indirect(
            pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert(1)"))
        )

    with pytest.raises(RejectedDocument, match="embedded script"):
        sanitise(_pdf(build))


def test_rejects_a_document_level_additional_action() -> None:
    """/AA (not /OpenAction) is the other document-catalog slot a script
    can hide in — fires on a trigger like will-close rather than open."""
    def build(pdf: pikepdf.Pdf) -> None:
        js = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("1")))
        pdf.Root.AA = pikepdf.Dictionary(WC=js)

    with pytest.raises(RejectedDocument, match="embedded script"):
        sanitise(_pdf(build))


def test_rejects_a_names_tree_script_even_with_no_trigger() -> None:
    """A script sitting in the /Names/JavaScript tree runs without any
    /OpenAction or /AA pointing at it at all — some viewers execute every
    named script on load."""
    def build(pdf: pikepdf.Pdf) -> None:
        entry = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("1")))
        pdf.Root.Names = pikepdf.Dictionary(
            JavaScript=pikepdf.Dictionary(Names=[pikepdf.String("s"), entry])
        )

    with pytest.raises(RejectedDocument, match="embedded script"):
        sanitise(_pdf(build))


def test_rejects_a_launch_action_on_a_link_annotation() -> None:
    """The other dangerous action type — runs an external program/file
    rather than a script, attached to a clickable annotation on the page
    rather than the document catalog."""
    def build(pdf: pikepdf.Pdf) -> None:
        page = pdf.pages[0]
        action = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.Launch, F=pikepdf.String("calc.exe")))
        annot = pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[0, 0, 10, 10], A=action)
        page.Annots = pdf.make_indirect([pdf.make_indirect(annot)])

    with pytest.raises(RejectedDocument, match="embedded script"):
        sanitise(_pdf(build))


def test_rejects_an_annotation_additional_action() -> None:
    """Any annotation's own /AA (e.g. mouse-enter) is a third place an
    action can live, independent of both /OpenAction and the
    annotation's own /A."""
    def build(pdf: pikepdf.Pdf) -> None:
        page = pdf.pages[0]
        js = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("1")))
        annot = pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[0, 0, 10, 10],
            AA=pikepdf.Dictionary(E=js),
        )
        page.Annots = pdf.make_indirect([pdf.make_indirect(annot)])

    with pytest.raises(RejectedDocument, match="embedded script"):
        sanitise(_pdf(build))


def test_accepts_a_benign_goto_action() -> None:
    """A /GoTo (or /URI, /Named, ...) action is the entire reason PDFs
    have an /OpenAction and /A slot at all — an "open to page 3" or a
    normal hyperlink must not be flagged just for using them."""
    def build(pdf: pikepdf.Pdf) -> None:
        page = pdf.pages[0]
        pdf.Root.OpenAction = pdf.make_indirect(
            pikepdf.Dictionary(S=pikepdf.Name.GoTo, D=[page.obj, pikepdf.Name.Fit])
        )
        goto = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.GoTo, D=[page.obj, pikepdf.Name.Fit]))
        annot = pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[0, 0, 10, 10], A=goto)
        page.Annots = pdf.make_indirect([pdf.make_indirect(annot)])

    # Must not raise.
    result = sanitise(_pdf(build))
    assert result.content_type == "application/pdf"


# ─── DOCX zip-bomb guard (audit follow-up, run-2) ─────────────────────


def _docx(body_size: int) -> bytes:
    """A minimal, honestly-declared .docx: one `word/document.xml` entry
    of `body_size` bytes that don't compress well (real document XML
    doesn't either), so the expansion-ratio check stays out of the way
    and only the absolute-size check under test can fire."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", os.urandom(body_size))
    data = buf.getvalue()
    if len(data) < MIN_BYTES:
        data += b"\x00" * (MIN_BYTES - len(data))
    return data


def test_accepts_a_small_well_formed_docx() -> None:
    result = sanitise(_docx(10_000))
    assert result.content_type.endswith("wordprocessingml.document")


def test_rejects_a_docx_past_the_absolute_uncompressed_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    """An honestly-declared archive, well inside MAX_ZIP_EXPANSION_RATIO,
    can still decompress to more memory than the worker should ever hold —
    CPython's zipfile truncates decompression at the declared size, so no
    forged metadata is needed to blow past a ratio-only cap. The real
    default cap is 50 MB; shrunk here so the fixture stays small and fast."""
    monkeypatch.setattr(documents, "MAX_DOCX_UNCOMPRESSED_BYTES", 1_000)
    with pytest.raises(RejectedDocument, match="could not be read"):
        sanitise(_docx(5_000))


def test_rejects_a_docx_with_an_extreme_per_entry_expansion_ratio() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", b"a" * (200 * 1024))
    with pytest.raises(RejectedDocument, match="could not be read"):
        sanitise(buf.getvalue())
