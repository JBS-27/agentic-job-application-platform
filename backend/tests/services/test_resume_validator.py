"""
Phase 2 tests: resume upload validation (app/services/resume/validator.py).
"""

from io import BytesIO

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from app.core.exceptions import InvalidFileError
from app.services.resume.validator import validate_resume_file


def _make_upload_file(filename: str, content: bytes, content_type: str) -> UploadFile:
    headers = Headers({"content-type": content_type})
    return UploadFile(filename=filename, file=BytesIO(content), headers=headers)


@pytest.mark.asyncio
async def test_valid_pdf_passes_validation(valid_resume_pdf_bytes):
    upload = _make_upload_file("resume.pdf", valid_resume_pdf_bytes, "application/pdf")
    result = await validate_resume_file(upload)
    assert result == valid_resume_pdf_bytes


@pytest.mark.asyncio
async def test_rejects_non_pdf_extension(valid_resume_pdf_bytes):
    upload = _make_upload_file("resume.docx", valid_resume_pdf_bytes, "application/pdf")
    with pytest.raises(InvalidFileError):
        await validate_resume_file(upload)


@pytest.mark.asyncio
async def test_rejects_wrong_content_type(valid_resume_pdf_bytes):
    upload = _make_upload_file("resume.pdf", valid_resume_pdf_bytes, "text/plain")
    with pytest.raises(InvalidFileError):
        await validate_resume_file(upload)


@pytest.mark.asyncio
async def test_rejects_empty_file():
    upload = _make_upload_file("resume.pdf", b"", "application/pdf")
    with pytest.raises(InvalidFileError):
        await validate_resume_file(upload)


@pytest.mark.asyncio
async def test_rejects_file_missing_pdf_magic_bytes():
    fake_content = b"not actually a pdf, just renamed"
    upload = _make_upload_file("resume.pdf", fake_content, "application/pdf")
    with pytest.raises(InvalidFileError):
        await validate_resume_file(upload)


@pytest.mark.asyncio
async def test_rejects_oversized_file(monkeypatch, valid_resume_pdf_bytes):
    from app.core.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("MAX_UPLOAD_SIZE_MB", "0")  # anything is now "too large"
    get_settings.cache_clear()

    upload = _make_upload_file("resume.pdf", valid_resume_pdf_bytes, "application/pdf")
    with pytest.raises(InvalidFileError):
        await validate_resume_file(upload)

    get_settings.cache_clear()
