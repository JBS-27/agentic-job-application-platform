"""Advance one application session. External submit stays with the person."""

import uuid
from datetime import datetime, timezone

from app.core.exceptions import InvalidSessionTransitionError, JobSourceError
from app.schemas.application import (
    AgentTrace,
    ApplicationSession,
    ApprovedField,
    DecisionRequest,
)
from app.schemas.job import JobAnalyzeRequest
from app.schemas.resume import CandidateProfile
from app.services.application.followup import draft_follow_up
from app.services.application.tailor import draft_package
from app.services.agent.store import get_session, save_session
from app.services.job.analyzer import analyze_job
from app.services.job.matcher import score_match
from app.services.llm.base import BaseLLMProvider
from app.utils.text_utils import redact

_ALLOWED = {
    "answer_review": {"approved", "skipped"},
    "approved": {"filling", "awaiting_submit"},
    "filling": {"awaiting_submit", "stopped"},
    "awaiting_submit": {"submitted"},
}


async def start_campaign(
    request: JobAnalyzeRequest,
    questions: list[str],
    request_package: bool,
    llm: BaseLLMProvider | None,
) -> ApplicationSession:
    analysis = await analyze_job(
        request.job_text,
        request.job_url,
        use_llm=request.use_llm,
        llm=llm,
    )
    if not analysis.title and not analysis.description_text:
        raise JobSourceError("Paste a job description or a public job URL.")

    match = score_match(request.candidate_profile, analysis, request.match_threshold)
    package = draft_package(
        request.candidate_profile,
        analysis,
        match,
        questions,
        request_package=request_package,
    )
    session = ApplicationSession(
        id=uuid.uuid4().hex,
        job_id=analysis.id,
        phase="answer_review",
        analysis=analysis,
        match=match,
        package=package,
    )
    _trace(session, "matcher", "decision", "score", {"threshold": match.threshold}, {"score": match.score, "recommendation": match.recommendation})
    _trace(session, "tailor", "tool", "draft_package", {"questions": len(questions)}, {"unresolved": package.unresolved})
    return save_session(session)


def apply_decision(session_id: str, decision: DecisionRequest) -> ApplicationSession:
    session = get_session(session_id)
    _require(session.phase, "answer_review")
    if decision.decision == "skip":
        session.phase = "skipped"
        session.stop_reason = "user_skip" if session.match and session.match.recommendation != "skip" else "low_match"
        _trace(session, "ui", "gate", "skip", {}, {"phase": "skipped"})
        return save_session(session)

    edits = {item.field_key: item.value.strip() for item in decision.answers}
    approved: list[ApprovedField] = []
    if session.package:
        for answer in session.package.answers:
            if answer.field_key in edits:
                answer.value = edits[answer.field_key]
                answer.status = "edited"
                answer.confidence = "memory"
                answer.sensitive = False
            elif answer.status == "refused" or not answer.value.strip():
                continue
            else:
                answer.status = "approved"
            if answer.value.strip():
                approved.append(ApprovedField(field_key=answer.field_key, label=answer.label, value=answer.value.strip()))
    session.approved_field_map = approved
    session.phase = "approved"
    _trace(
        session,
        "ui",
        "gate",
        decision.decision,
        {},
        {"approved": len(approved), "override": bool(session.match and session.match.recommendation == "skip")},
    )
    return save_session(session)


def mark_awaiting_submit(session_id: str) -> ApplicationSession:
    session = get_session(session_id)
    if session.phase == "approved":
        session.phase = "filling"
    _require(session.phase, "filling")
    if not session.approved_field_map:
        session.phase = "stopped"
        session.stop_reason = "unmapped_field"
        _trace(session, "form_filler", "decision", "empty_map", {}, {"phase": "stopped"})
        return save_session(session)
    session.phase = "awaiting_submit"
    session.submit_clicked_by_system = False
    _trace(session, "form_filler", "tool", "awaiting_submit", {}, {"fields": len(session.approved_field_map)})
    return save_session(session)


def mark_submitted(session_id: str) -> ApplicationSession:
    session = get_session(session_id)
    _require(session.phase, "awaiting_submit")
    session.phase = "submitted"
    title = session.analysis.title if session.analysis else ""
    company = session.analysis.company if session.analysis else ""
    overlaps = [item.requirement for item in session.match.overlaps] if session.match else []
    session.follow_up_draft = draft_follow_up(title, company, overlaps)
    _trace(session, "follow_up", "tool", "draft_follow_up", {}, {"chars": len(session.follow_up_draft)})
    return save_session(session)


def _require(phase: str, expected: str) -> None:
    if phase != expected:
        raise InvalidSessionTransitionError(f"This session is '{phase}' and cannot take that step.")


def _trace(session: ApplicationSession, agent: str, kind: str, name: str, payload_in: dict, payload_out: dict) -> None:
    session.traces.append(
        AgentTrace(
            id=uuid.uuid4().hex[:10],
            at=datetime.now(timezone.utc).isoformat(),
            agent=agent,
            kind=kind,  # type: ignore[arg-type]
            name=name,
            input=redact(payload_in),
            output=redact(payload_out),
        )
    )


def profile_text(profile: CandidateProfile) -> str:
    return profile.model_dump_json()
