"""Job analysis API (Phase 3)."""

from fastapi import APIRouter, HTTPException

from app.core.exceptions import AppError
from app.schemas.application import CampaignCreateRequest
from app.schemas.job import JobAnalyzeRequest, JobAnalyzeResponse
from app.services.job.analyzer import analyze_job
from app.services.job.matcher import score_match
from app.services.llm.factory import get_llm_provider

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("/analyze", response_model=JobAnalyzeResponse)
async def analyze(body: JobAnalyzeRequest) -> JobAnalyzeResponse:
    try:
        llm = get_llm_provider() if body.use_llm else None
        analysis = await analyze_job(body.job_text, body.job_url, use_llm=body.use_llm, llm=llm)
        match = score_match(body.candidate_profile, analysis, body.match_threshold)
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return JobAnalyzeResponse(analysis=analysis, match=match)


def as_campaign_request(body: JobAnalyzeRequest) -> CampaignCreateRequest:
    return CampaignCreateRequest(**body.model_dump())
