"""
Phase 2 tests: PDF text extraction (app/services/resume/parser.py).
"""

import pytest

from app.core.exceptions import ResumeExtractionError
from app.services.resume.parser import _clean_extracted_text, extract_text_from_pdf


def test_extracts_text_from_valid_pdf(valid_resume_pdf_bytes):
    text = extract_text_from_pdf(valid_resume_pdf_bytes)
    assert "Jane Doe" in text
    assert "jane.doe@example.com" in text
    assert "TECHNICAL SKILLS" in text


def test_blank_pdf_raises_extraction_error(blank_pdf_bytes):
    with pytest.raises(ResumeExtractionError):
        extract_text_from_pdf(blank_pdf_bytes)


def test_non_pdf_bytes_raise_extraction_error(not_a_pdf_bytes):
    with pytest.raises(ResumeExtractionError):
        extract_text_from_pdf(not_a_pdf_bytes)


def test_empty_bytes_raise_extraction_error():
    with pytest.raises(ResumeExtractionError):
        extract_text_from_pdf(b"")


def test_clean_extracted_text_rejoins_hyphenated_line_breaks():
    raw = "This is a develop-\nment role focused on soft-\nware engineering."
    cleaned = _clean_extracted_text(raw)
    assert "development role" in cleaned
    assert "software engineering" in cleaned


def test_clean_extracted_text_collapses_excess_whitespace():
    raw = "Line one\n\n\n\n\nLine two   with   spaces\t\tand tabs"
    cleaned = _clean_extracted_text(raw)
    assert "\n\n\n" not in cleaned
    assert "Line two with spaces and tabs" in cleaned


def test_clean_extracted_text_handles_empty_string():
    assert _clean_extracted_text("") == ""
    assert _clean_extracted_text(None) == ""
