"""
Phase 2 tests: candidate profile extraction service
(app/services/resume/profile_extractor.py).

All LLM calls are stubbed via FakeLLMProvider (see tests/conftest.py) so
these tests run instantly and consume zero real API tokens.
"""

import pytest

from app.core.exceptions import InvalidLLMOutputError
from app.services.resume.profile_extractor import extract_candidate_profile
from tests.conftest import FakeLLMProvider


@pytest.mark.asyncio
async def test_extracts_profile_on_first_valid_response(valid_llm_json_response):
    provider = FakeLLMProvider([valid_llm_json_response])

    profile = await extract_candidate_profile("some resume text", provider)

    assert profile.professional_summary == "Software engineer with 3 years of experience."
    assert "Python" in profile.technical_skills
    assert provider.call_count == 1  # only ONE LLM call needed — no wasted tokens


@pytest.mark.asyncio
async def test_retries_once_on_malformed_json_then_succeeds(valid_llm_json_response):
    provider = FakeLLMProvider(["not valid json at all", valid_llm_json_response])

    profile = await extract_candidate_profile("some resume text", provider)

    assert profile.professional_summary == "Software engineer with 3 years of experience."
    assert provider.call_count == 2  # exactly one retry, not unlimited


@pytest.mark.asyncio
async def test_strips_markdown_fences_from_llm_response(valid_llm_json_response):
    fenced = f"```json\n{valid_llm_json_response}\n```"
    provider = FakeLLMProvider([fenced])

    profile = await extract_candidate_profile("some resume text", provider)

    assert "Python" in profile.technical_skills


@pytest.mark.asyncio
async def test_raises_after_two_failed_attempts():
    provider = FakeLLMProvider(["garbage response", "still garbage"])

    with pytest.raises(InvalidLLMOutputError):
        await extract_candidate_profile("some resume text", provider)

    assert provider.call_count == 2  # capped at 2 total calls — token conservation


@pytest.mark.asyncio
async def test_raises_when_llm_returns_json_not_matching_schema():
    # Valid JSON, but wrong shape (technical_skills should be a list, not a string).
    provider = FakeLLMProvider(
        ['{"technical_skills": "Python, FastAPI"}', '{"technical_skills": "still wrong"}']
    )

    with pytest.raises(InvalidLLMOutputError):
        await extract_candidate_profile("some resume text", provider)
