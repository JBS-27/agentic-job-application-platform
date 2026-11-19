"""
Resume upload validation (Phase 2).

Validates an uploaded file before any parsing happens. Checks are layered
so obviously-wrong uploads are rejected cheaply (extension, declared
content-type) before reading the body, then the body itself is checked
for size and PDF magic bytes so a renamed non-PDF file can't slip through.
"""

from fastapi import UploadFile

from app.core.config import get_settings
from app.core.exceptions import InvalidFileError

ALLOWED_CONTENT_TYPES = {"application/pdf"}
PDF_MAGIC_BYTES = b"%PDF-"


async def validate_resume_file(file: UploadFile) -> bytes:
    settings = get_settings()

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise InvalidFileError("Only PDF files are supported. Please upload a file with a .pdf extension.")

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise InvalidFileError(
            f"Invalid file type '{file.content_type}'. Only application/pdf uploads are accepted."
        )

    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise InvalidFileError("The uploaded file is empty.")

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise InvalidFileError(
            f"The uploaded file is too large. Maximum allowed size is {settings.MAX_UPLOAD_SIZE_MB}MB."
        )

    if not file_bytes.startswith(PDF_MAGIC_BYTES):
        raise InvalidFileError("The uploaded file does not appear to be a valid PDF.")

    return file_bytes
