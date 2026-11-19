"""Application package, session, and review schemas (Phases 4 and 5)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.job import JobAnalysis, JobAnalyzeRequest, MatchResult
from app.schemas.resume import CandidateProfile


class PackageAnswer(BaseModel):
    field_key: str
    label: str
    kind: Literal["text", "years", "yesno", "long_text"] = "text"
    value: str = ""
    status: Literal["draft", "approved", "edited", "refused"] = "draft"
    confidence: Literal["fact", "memory", "model", "unknown"] = "unknown"
    evidence: str = ""
    sensitive: bool = False


class PackageBullet(BaseModel):
    text: str
    evidence: str


class GeneratedApplicationPackage(BaseModel):
    job_id: str
    bullets: list[PackageBullet] = Field(default_factory=list)
    cover_letter: str = ""
    answers: list[PackageAnswer] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    generated_at: str


class AgentTrace(BaseModel):
    id: str
    at: str
    agent: str
    kind: Literal["llm", "tool", "decision", "gate"]
    name: str
    input: dict = Field(default_factory=dict)
    output: dict = Field(default_factory=dict)
    error: Optional[str] = None


class ApprovedField(BaseModel):
    field_key: str
    label: str
    value: str


class ApplicationSession(BaseModel):
    id: str
    job_id: str
    phase: Literal[
        "analyzed",
        "scored",
        "drafted",
        "answer_review",
        "approved",
        "filling",
        "awaiting_submit",
        "submitted",
        "skipped",
        "stopped",
    ]
    stop_reason: Optional[str] = None
    analysis: Optional[JobAnalysis] = None
    match: Optional[MatchResult] = None
    package: Optional[GeneratedApplicationPackage] = None
    approved_field_map: list[ApprovedField] = Field(default_factory=list)
    follow_up_draft: str = ""
    traces: list[AgentTrace] = Field(default_factory=list)
    submit_clicked_by_system: bool = False


class CampaignCreateRequest(JobAnalyzeRequest):
    questions: list[str] = Field(default_factory=list)
    request_package: bool = False


class AnswerEdit(BaseModel):
    field_key: str
    value: str


class DecisionRequest(BaseModel):
    decision: Literal["approve", "edit", "skip"]
    answers: list[AnswerEdit] = Field(default_factory=list)


class FillRequest(BaseModel):
    html: str = ""
    engine: Literal["html", "playwright"] = "html"


class FillReport(BaseModel):
    wrote: list[ApprovedField] = Field(default_factory=list)
    unmapped_required: list[str] = Field(default_factory=list)
    submit_clicked: bool = False
    phase: str


class ProfileHolder(BaseModel):
    candidate_profile: CandidateProfile
