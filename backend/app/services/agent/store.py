"""Campaign sessions. Memory is the default so the app runs without MongoDB."""

from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.exceptions import CampaignLimitError, SessionNotFoundError
from app.schemas.application import ApplicationSession

_sessions: dict[str, ApplicationSession] = {}
_created_on: dict[str, str] = {}


def reset_store() -> None:
    _sessions.clear()
    _created_on.clear()


def save_session(session: ApplicationSession) -> ApplicationSession:
    if session.id not in _sessions:
        today = datetime.now(timezone.utc).date().isoformat()
        made_today = sum(1 for day in _created_on.values() if day == today)
        if made_today >= get_settings().MAX_CAMPAIGNS_PER_DAY:
            raise CampaignLimitError(
                f"Daily prepare cap is {get_settings().MAX_CAMPAIGNS_PER_DAY}. Try again tomorrow."
            )
        _created_on[session.id] = today
    _sessions[session.id] = session
    return session


def get_session(session_id: str) -> ApplicationSession:
    session = _sessions.get(session_id)
    if session is None:
        raise SessionNotFoundError("That application session was not found.")
    return session


def list_sessions() -> list[ApplicationSession]:
    return list(_sessions.values())
