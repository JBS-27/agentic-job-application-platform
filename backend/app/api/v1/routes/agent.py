"""Agent entrypoint. Runs the same campaign pipeline and returns the session."""

from fastapi import APIRouter, HTTPException

from app.api.v1.routes.application import _start
from app.core.exceptions import AppError
from app.schemas.application import ApplicationSession, CampaignCreateRequest
from app.services.agent.store import get_session

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/run", response_model=ApplicationSession)
async def run_agent(body: CampaignCreateRequest) -> ApplicationSession:
    return await _start(body)


@router.get("/sessions/{session_id}/trace")
async def read_trace(session_id: str):
    try:
        session = get_session(session_id)
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return {"session_id": session.id, "phase": session.phase, "traces": session.traces}
