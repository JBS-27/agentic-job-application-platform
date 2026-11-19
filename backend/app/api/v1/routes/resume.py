"""
Resume upload API route (Phase 2).

Deliberately thin: this handler only wires together the validator, PDF
parser, and profile-extraction service, and translates `AppError`
subclasses into clear HTTP responses. All actual logic lives in
app/services/resume/* and app/services/llm/*.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.exceptions import AppError
from app.core.logging import get_logger
from app.schemas.resume import ErrorResponse, ResumeUploadResponse
from app.services.llm.factory import get_llm_provider
from app.services.resume.parser import extract_text_from_pdf
from app.services.resume.profile_extractor import extract_candidate_profile
from app.services.resume.validator import validate_resume_file

logger = get_logger(__name__)
router = APIRouter(prefix="/resume", tags=["resume"])


@router.post(
    "/upload",
    response_model=ResumeUploadResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid file"},
        422: {"model": ErrorResponse, "description": "Text extraction failed"},
        502: {"model": ErrorResponse, "description": "LLM provider or output error"},
    },
)
async def upload_resume(file: UploadFile = File(...)) -> ResumeUploadResponse:
    """
    Accepts a resume PDF, extracts its text, and returns a structured
    candidate profile produced by the configured LLM.
    """
    try:
        file_bytes = await validate_resume_file(file)
        raw_text = extract_text_from_pdf(file_bytes)

        llm_provider = get_llm_provider()
        candidate_profile = await extract_candidate_profile(raw_text, llm_provider)
    except AppError as exc:
        logger.warning("Resume upload rejected: %s", exc.message)
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except Exception:
        logger.exception("Unexpected error while processing resume upload")
        raise HTTPException(
            status_code=500,
            detail="An unexpected error occurred while processing the resume.",
        )

    return ResumeUploadResponse(
        filename=file.filename,
        extracted_text_length=len(raw_text),
        candidate_profile=candidate_profile,
    )
