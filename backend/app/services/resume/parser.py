"""
PDF text extraction (Phase 2).

Uses pypdf (selected in Phase 1) to pull raw text out of a resume PDF,
then cleans common extraction artifacts: hyphenated line-break splits,
repeated blank lines, runs of spaces/tabs, and trailing whitespace.
Encrypted, corrupt, image-only/scanned, or otherwise empty PDFs are
surfaced as a clear `ResumeExtractionError` rather than failing silently
or being passed on to the LLM as near-empty input.
"""

import re
from io import BytesIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.core.config import get_settings
from app.core.exceptions import ResumeExtractionError
from app.core.logging import get_logger

logger = get_logger(__name__)


def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(file_bytes))
    except PdfReadError as exc:
        raise ResumeExtractionError("The uploaded file is not a valid or readable PDF.") from exc
    except Exception as exc:  # defensive: pypdf can raise assorted errors on malformed input
        logger.error("Unexpected error opening PDF: %s", exc)
        raise ResumeExtractionError("Failed to open the uploaded PDF file.") from exc

    if reader.is_encrypted:
        try:
            # Attempt a blank-password decrypt; many "protected" exports only
            # restrict editing and open fine with an empty password.
            reader.decrypt("")
        except Exception:
            raise ResumeExtractionError(
                "This PDF is password-protected and cannot be read. Please upload an unprotected PDF."
            )

    if len(reader.pages) == 0:
        raise ResumeExtractionError("The uploaded PDF has no pages.")

    page_texts = []
    for page_number, page in enumerate(reader.pages, start=1):
        try:
            page_texts.append(page.extract_text() or "")
        except Exception as exc:
            logger.warning("Failed to extract text from page %d: %s", page_number, exc)
            page_texts.append("")

    cleaned_text = _clean_extracted_text("\n".join(page_texts))

    settings = get_settings()
    if len(cleaned_text) < settings.MIN_EXTRACTED_TEXT_CHARS:
        raise ResumeExtractionError(
            "No readable text could be extracted from this PDF. It may be a scanned "
            "image, blank, or corrupted document. Please upload a text-based PDF resume."
        )

    return cleaned_text


def _clean_extracted_text(text: str) -> str:
    """Normalizes whitespace and repairs common PDF-extraction artifacts."""
    if not text:
        return ""

    # Normalize line endings.
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Rejoin words split across a line break with a hyphen, e.g.
    # "develop-\nment" -> "development".
    text = re.sub(r"-\n(?=[a-z])", "", text)

    # Collapse 3+ consecutive blank lines down to a single blank line.
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Collapse runs of spaces/tabs into a single space.
    text = re.sub(r"[ \t]{2,}", " ", text)

    # Strip trailing/leading whitespace on each line.
    text = "\n".join(line.strip() for line in text.split("\n"))

    return text.strip()
