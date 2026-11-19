"""
Candidate profile extraction service (Phase 2).

Orchestrates turning cleaned resume text into a validated
`CandidateProfile` via the LLM layer. Deliberately kept out of the route
handler so the route stays a thin HTTP adapter.

Token-conservation policy: at most ONE retry is issued, and only when the
first response fails to parse as valid JSON or fails schema validation
(a real sign the model needs a stricter nudge). Infrastructure failures
(auth errors, timeouts, 5xx) are NOT retried here — they propagate
immediately as `LLMProviderError` so we don't burn additional free-tier
calls on a failure a retry won't fix.
"""

import json

from pydantic import ValidationError

from app.core.exceptions import InvalidLLMOutputError, LLMProviderError
from app.core.logging import get_logger
from app.prompts.resume_prompts import (
    RESUME_EXTRACTION_SYSTEM_PROMPT,
    build_resume_extraction_user_prompt,
)
from app.schemas.resume import CandidateProfile
from app.services.llm.base import BaseLLMProvider

logger = get_logger(__name__)

_RETRY_INSTRUCTION = (
    "\n\nIMPORTANT: Your previous response was not valid JSON matching the "
    "required schema. Respond again with ONLY a single valid JSON object — "
    "no markdown code fences, no commentary, no trailing text."
)


async def extract_candidate_profile(
    resume_text: str, llm_provider: BaseLLMProvider
) -> CandidateProfile:
    user_prompt = build_resume_extraction_user_prompt(resume_text)

    raw_response = await _call_llm(llm_provider, user_prompt)
    profile = _try_parse(raw_response)
    if profile is not None:
        return profile

    logger.warning("First LLM response was not valid JSON/schema. Retrying once.")
    raw_response_retry = await _call_llm(llm_provider, user_prompt + _RETRY_INSTRUCTION)
    profile = _try_parse(raw_response_retry)
    if profile is not None:
        return profile

    raise InvalidLLMOutputError(
        "The AI model returned a response that could not be understood after "
        "a retry. Please try uploading the resume again."
    )


async def _call_llm(llm_provider: BaseLLMProvider, user_prompt: str) -> str:
    # LLMProviderError intentionally propagates unchanged — infra failures
    # are not retried by this function (see module docstring).
    return await llm_provider.generate_json(
        system_prompt=RESUME_EXTRACTION_SYSTEM_PROMPT,
        user_prompt=user_prompt,
    )


def _try_parse(raw_response: str) -> CandidateProfile | None:
    try:
        data = _extract_json_object(raw_response)
        return CandidateProfile(**data)
    except (json.JSONDecodeError, ValidationError, TypeError) as exc:
        logger.warning("Failed to parse/validate LLM output: %s", exc)
        return None


def _extract_json_object(raw: str) -> dict:
    """Strips accidental markdown code fences before parsing JSON."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    return json.loads(text)
