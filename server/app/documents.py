"""CV document validation.

Unlike images.py, this module never re-encodes anything — a CV's stored
bytes ARE the original upload, because the eventual matching pipeline
(cv-matchmaker-spec.md, principle 6: "pipeline must be re-runnable from
stored text") needs to be able to go back to the source file, and because
re-encoding a PDF or DOCX in any real sense means re-authoring it, which is
not a thing this gateway is in the business of doing.

That makes this the higher-trust path of the two the gateway serves: an
image's pixels are the only thing that survives sanitise(), but a CV's
bytes are stored verbatim, and whoever downloads it — the member
themselves, or an admin — gets exactly what was uploaded. The checks below
exist to keep that file from being something other than what it claims:

  * magic bytes decide the format, never Content-Type or filename — the
    same rule images.py follows, for the same reason.
  * .docm is rejected even though it is byte-for-byte a valid .docx
    container: Office macros are executable code, and nothing about
    "upload your CV" should be able to deliver a macro payload to whoever
    opens it next.
  * a zip bomb (a small file that expands enormously) is rejected by
    comparing declared uncompressed size against the compressed size,
    mirroring the pixel-count guard images.py applies to images.
  * an encrypted PDF is rejected — this gateway has no password to open it
    with, and a member cannot review or the matcher parse content it can't
    read either.

PDF embedded JavaScript and /Launch actions are rejected outright, the same
way a macro-enabled .docm is: both are executable payload riding inside a
document upload, and "inert in a browser" doesn't mean inert everywhere —
Content-Disposition: attachment only stops inline rendering, and a PDF
reader that isn't a browser (Adobe Acrobat, chiefly) does run embedded
JavaScript and can act on a /Launch action. This is the well-known
malicious-résumé attack shape, and it's aimed squarely at whoever has the
most reason to open a stranger's CV — an admin. Detected with pikepdf
(qpdf-backed) rather than a byte search, because the earlier /Encrypt-only
check that shipped here shared a real weakness with that shape of check:
it can't see through a PDF's own object-stream compression, so anything
encoded that way — a real encryption dictionary, or a JavaScript action —
would silently pass a plain substring search.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass

import pikepdf

MIN_BYTES = 256  # Below this nothing resembling a real CV can exist.

# Zip bombs expand by orders of magnitude. A real DOCX (already-compressed
# XML plus small embedded media) rarely exceeds 10x; 60x leaves headroom
# for a document that is mostly a few uncompressed images while still
# catching a file engineered to blow up in memory when the gateway (or
# anything downstream) unzips it.
MAX_ZIP_EXPANSION_RATIO = 60

# The ratio cap alone lets an honestly-declared archive (no forged
# metadata needed — CPython's zipfile truncates decompression output at
# the declared size regardless) expand to MAX_DOCUMENT_BYTES * 60: at the
# default 8 MB upload cap, ~480 MB, well past what the CV-ingest worker's
# memory limit can hold. No real CV's extracted XML needs anywhere close
# to this; it exists only to bound worst-case memory during unzip+parse,
# independent of whatever the upload-size cap happens to be configured to
# (audit follow-up, run-2).
MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024


class RejectedDocument(Exception):
    """The upload is not something we are prepared to store."""


@dataclass(frozen=True)
class ValidatedDocument:
    data: bytes
    content_type: str
    extension: str  # for cv_original_filename fallback / logging only


_PDF_CONTENT_TYPE = "application/pdf"
_DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


# A PDF action's /S entry names its type. Only these two can make anything
# run — /GoTo, /URI and the rest just navigate or link, which is the whole
# point of having a PDF that isn't a plain scan.
_DANGEROUS_ACTION_TYPES = frozenset({pikepdf.Name.JavaScript, pikepdf.Name.Launch})


def _action_is_dangerous(action: object) -> bool:
    return isinstance(action, pikepdf.Dictionary) and action.get("/S") in _DANGEROUS_ACTION_TYPES


def _action_group_is_dangerous(action_group: object) -> bool:
    """An /AA dict maps trigger names (open, close, mouse-enter, ...) to
    action dicts — the per-page and per-annotation sibling of the document
    catalog's single /OpenAction."""
    return isinstance(action_group, pikepdf.Dictionary) and any(
        _action_is_dangerous(sub) for sub in action_group.values()
    )


def _has_dangerous_content(pdf: pikepdf.Pdf) -> bool:
    root = pdf.Root
    if _action_is_dangerous(root.get("/OpenAction")):
        return True
    if _action_group_is_dangerous(root.get("/AA")):
        return True

    names = root.get("/Names")
    # A non-empty /Names/JavaScript name tree *is* embedded JavaScript —
    # unlike /OpenAction and /AA, there's no benign action type sharing this
    # slot, so presence alone is the signal.
    if isinstance(names, pikepdf.Dictionary) and "/JavaScript" in names:
        return True

    for page in pdf.pages:
        if _action_group_is_dangerous(page.get("/AA")):
            return True
        for annot in page.get("/Annots", []):
            if not isinstance(annot, pikepdf.Dictionary):
                continue
            if _action_is_dangerous(annot.get("/A")) or _action_group_is_dangerous(annot.get("/AA")):
                return True
    return False


def _validate_pdf(data: bytes) -> None:
    try:
        with pikepdf.Pdf.open(io.BytesIO(data)) as pdf:
            # is_encrypted covers owner-only encryption too, where opening
            # with an empty user password succeeds but the file is still
            # marked encrypted — PasswordError alone would miss that case.
            if pdf.is_encrypted:
                raise RejectedDocument(
                    "That PDF is password-protected. Please upload an unprotected copy."
                )
            if _has_dangerous_content(pdf):
                raise RejectedDocument(
                    "That PDF contains an embedded script or launch action, which "
                    "isn't accepted. Please upload a plain PDF export."
                )
    except pikepdf.PasswordError as exc:
        raise RejectedDocument(
            "That PDF is password-protected. Please upload an unprotected copy."
        ) from exc
    except pikepdf.PdfError as exc:
        raise RejectedDocument("That file could not be read.") from exc


def _validate_docx(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())

            if "word/document.xml" not in names:
                # A bare zip signature also matches .jar, .apk and .xlsx —
                # this is the check that it is actually a Word document.
                raise RejectedDocument("That file isn't a Word document.")

            if "word/vbaProject.bin" in names:
                raise RejectedDocument(
                    "Macro-enabled Word documents (.docm) aren't accepted. "
                    "Please save as a plain .docx."
                )

            total_compressed = 0
            total_uncompressed = 0
            for info in zf.infolist():
                total_compressed += info.compress_size
                total_uncompressed += info.file_size
                # Per-entry ratio too: a single crafted entry inside an
                # otherwise-normal-looking archive is the classic zip-bomb
                # shape, and the aggregate check alone can miss it if the
                # rest of the archive is mostly incompressible.
                if info.compress_size > 0 and (
                    info.file_size / info.compress_size > MAX_ZIP_EXPANSION_RATIO
                ):
                    raise RejectedDocument("That file could not be read.")

            if total_compressed > 0 and (
                total_uncompressed / total_compressed > MAX_ZIP_EXPANSION_RATIO
            ):
                raise RejectedDocument("That file could not be read.")

            if total_uncompressed > MAX_DOCX_UNCOMPRESSED_BYTES:
                raise RejectedDocument("That file could not be read.")

    except zipfile.BadZipFile as exc:
        raise RejectedDocument("That file could not be read.") from exc


def sanitise(data: bytes) -> ValidatedDocument:
    """Validate a CV upload and return it, unmodified, for storage.

    Raises RejectedDocument for anything that fails a check above. The
    returned bytes are always identical to the input — this function's
    job is deciding whether to store them, never changing them.
    """
    if len(data) < MIN_BYTES:
        raise RejectedDocument("That file is too small to be a CV.")

    if data.startswith(b"%PDF-"):
        _validate_pdf(data)
        return ValidatedDocument(data=data, content_type=_PDF_CONTENT_TYPE, extension="pdf")

    if data.startswith(b"PK\x03\x04"):
        _validate_docx(data)
        return ValidatedDocument(data=data, content_type=_DOCX_CONTENT_TYPE, extension="docx")

    raise RejectedDocument("Only PDF or Word (.docx) files are accepted.")
