"""CV byte-rendering helpers for the C1 generalisation audit corpus.

Renders plain-text CV content into real PDF/DOCX bytes so the audit
harness exercises server/app/cv_sanitise.py's actual extract_text() path
(_extract_pdf_text / _extract_docx_text) rather than skipping straight to
plain text. Uses only libraries already pinned in server/requirements.txt
(pymupdf, python-docx, pillow) — no new dependency.

This is generation code, not generated data: it is kept in the repo as a
one-command regression corpus (per the C1 audit plan). The bytes it
produces are not committed.
"""

from __future__ import annotations

import io
import textwrap

import pymupdf as fitz
from docx import Document as DocxDocument
from PIL import Image, ImageDraw

PDF_CONTENT_TYPE = "application/pdf"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_PAGE_RECT = fitz.paper_rect("a4")
_MARGIN = 36
_FONT = "helv"
_FONT_SIZE = 10.5
_LINE_HEIGHT = _FONT_SIZE * 1.35


def render_pdf_1col(text: str) -> bytes:
    """A clean, single-column PDF — as many pages as the text needs."""
    doc = fitz.open()
    _flow_text_single_column(doc, text)
    data = doc.tobytes()
    doc.close()
    return data


def _flow_text_single_column(doc: "fitz.Document", text: str) -> None:
    box = fitz.Rect(_MARGIN, _MARGIN, _PAGE_RECT.width - _MARGIN, _PAGE_RECT.height - _MARGIN)
    chars_per_line = int(box.width / (_FONT_SIZE * 0.52))
    lines_per_page = int(box.height / _LINE_HEIGHT)

    all_lines: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            all_lines.append("")
            continue
        wrapped = textwrap.wrap(paragraph, width=max(chars_per_line, 10)) or [""]
        all_lines.extend(wrapped)

    for start in range(0, len(all_lines), lines_per_page):
        page = doc.new_page(width=_PAGE_RECT.width, height=_PAGE_RECT.height)
        chunk = "\n".join(all_lines[start : start + lines_per_page])
        page.insert_textbox(box, chunk, fontsize=_FONT_SIZE, fontname=_FONT)


def render_pdf_2col_multipage(text: str) -> bytes:
    """A dense, two-column, multi-page PDF — the "veteran CV" shape (#4).
    Paginates by estimated character capacity per column rather than
    relying on insert_textbox's own overflow reporting, so no CV content
    is ever silently dropped regardless of exact page count."""
    doc = fitz.open()
    col_gap = 18
    col_width = (_PAGE_RECT.width - 2 * _MARGIN - col_gap) / 2
    left_box = fitz.Rect(_MARGIN, _MARGIN, _MARGIN + col_width, _PAGE_RECT.height - _MARGIN)
    right_box = fitz.Rect(
        _MARGIN + col_width + col_gap, _MARGIN, _PAGE_RECT.width - _MARGIN, _PAGE_RECT.height - _MARGIN
    )
    chars_per_line = int(col_width / (_FONT_SIZE * 0.52))
    lines_per_col = int(left_box.height / _LINE_HEIGHT)

    all_lines: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            all_lines.append("")
            continue
        wrapped = textwrap.wrap(paragraph, width=max(chars_per_line, 10)) or [""]
        all_lines.extend(wrapped)

    idx = 0
    while idx < len(all_lines):
        page = doc.new_page(width=_PAGE_RECT.width, height=_PAGE_RECT.height)
        for box in (left_box, right_box):
            chunk = "\n".join(all_lines[idx : idx + lines_per_col])
            if chunk:
                page.insert_textbox(box, chunk, fontsize=_FONT_SIZE, fontname=_FONT)
            idx += lines_per_col

    data = doc.tobytes()
    doc.close()
    return data


def render_docx(text: str) -> bytes:
    document = DocxDocument()
    for paragraph in text.split("\n"):
        document.add_paragraph(paragraph)
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def render_pdf_scanned_image(text: str) -> bytes:
    """A "scanned CV" fixture: the text is rendered onto a raster image
    and that image alone is embedded in the PDF page — no text layer at
    all. get_text() on this page returns "", so
    cv_sanitise.sanitise_cv's MIN_EXTRACTED_CHARS=200 floor correctly
    raises ExtractionFailed, exactly as a real scanned CV would."""
    img_w, img_h = 1240, 1754  # ~A4 at 150dpi
    image = Image.new("RGB", (img_w, img_h), "white")
    draw = ImageDraw.Draw(image)
    wrapped = textwrap.wrap(text.replace("\n", " / "), width=90)
    y = 60
    for line in wrapped[:80]:
        draw.text((60, y), line, fill="black")
        y += 20

    img_buf = io.BytesIO()
    image.save(img_buf, format="PNG")
    img_buf.seek(0)

    doc = fitz.open()
    page = doc.new_page(width=_PAGE_RECT.width, height=_PAGE_RECT.height)
    page.insert_image(page.rect, stream=img_buf.getvalue())
    data = doc.tobytes()
    doc.close()
    return data
