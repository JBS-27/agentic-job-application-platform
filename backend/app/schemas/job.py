"""Job analysis and match schemas (Phase 3)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.resume import CandidateProfile


class JobAnalysis(BaseModel):
    id: str
    url: str = ""
    title: str = ""
    company: str = ""
    location: str = ""
    workplace: Literal["onsite", "hybrid", "remote", "unknown"] = "unknown"
    description_text: str = ""
    requirements: list[str] = Field(default_factory=list)
    captured_at: str
    source: Literal["job_text", "job_url"] = "job_text"


class MatchOverlap(BaseModel):
    requirement: str
    evidence: str
    profile_field: str


class MatchGap(BaseModel):
    requirement: str
    reason: Literal["missing", "conflicting", "unknown"]


class MatchResult(BaseModel):
    job_id: str
    score: int
    threshold: int
    recommendation: Literal["prepare", "skip", "review"]
    overlaps: list[MatchOverlap] = Field(default_factory=list)
    gaps: list[MatchGap] = Field(default_factory=list)
    deal_breakers: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    model: str = "rules"


class JobAnalyzeRequest(BaseModel):
    candidate_profile: CandidateProfile
    job_text: str = ""
    job_url: Optional[str] = None
    use_llm: bool = False
    match_threshold: int = Field(default=60, ge=0, le=100)


class JobAnalyzeResponse(BaseModel):
    analysis: JobAnalysis
    match: MatchResult
