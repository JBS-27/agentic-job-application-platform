"""Application drafting, human review, and local form fill (Phases 4 and 5)."""

from fastapi import APIRouter, HTTPException

from app.core.exceptions import AppError
from app.schemas.application import (
    ApplicationSession,
    CampaignCreateRequest,
    DecisionRequest,
    FillReport,
    FillRequest,
)
from app.services.agent.orchestrator import apply_decision, mark_awaiting_submit, mark_submitted, start_campaign
from app.services.agent.store import get_session, list_sessions
from app.services.automation.form_filler import fill_html
from app.services.automation.playwright_driver import fill_local_html
from app.services.llm.factory import get_llm_provider

router = APIRouter(prefix="/applications", tags=["applications"])


@router.get("", response_model=list[ApplicationSession])
async def all_sessions() -> list[ApplicationSession]:
    return list_sessions()


@router.post("", response_model=ApplicationSession)
async def create_application(body: CampaignCreateRequest) -> ApplicationSession:
    return await _start(body)


@router.get("/{session_id}", response_model=ApplicationSession)
async def read_application(session_id: str) -> ApplicationSession:
    try:
        return get_session(session_id)
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/{session_id}/decision", response_model=ApplicationSession)
async def decide(session_id: str, body: DecisionRequest) -> ApplicationSession:
    try:
        return apply_decision(session_id, body)
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/{session_id}/fill", response_model=FillReport)
async def fill(session_id: str, body: FillRequest) -> FillReport:
    try:
        session = get_session(session_id)
        if session.phase != "approved":
            raise HTTPException(status_code=409, detail=f"This session is '{session.phase}' and cannot be filled.")
        if body.engine == "playwright":
            report = await fill_local_html(body.html, session.approved_field_map)
        else:
            _html, report = fill_html(body.html, session.approved_field_map)
        updated = mark_awaiting_submit(session_id)
        report.phase = updated.phase
        report.submit_clicked = False
        return report
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/{session_id}/submitted", response_model=ApplicationSession)
async def submitted(session_id: str) -> ApplicationSession:
    try:
        return mark_submitted(session_id)
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


async def _start(body: CampaignCreateRequest) -> ApplicationSession:
    try:
        llm = get_llm_provider() if body.use_llm else None
        return await start_campaign(body, body.questions, body.request_package, llm)
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
