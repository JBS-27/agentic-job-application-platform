"""
Phase 2 tests: OpenAICompatibleProvider (app/services/llm/providers/openai_compatible.py).

HTTP calls are mocked with respx — no real network calls or API tokens
are used.
"""

import httpx
import pytest
import respx

from app.core.exceptions import LLMProviderError
from app.services.llm.providers.openai_compatible import OpenAICompatibleProvider


def _provider() -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        base_url="https://fake-llm.example.com/v1",
        api_key="fake-key",
        model="fake-model",
    )


@pytest.mark.asyncio
@respx.mock
async def test_generate_json_returns_message_content():
    respx.post("https://fake-llm.example.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"technical_skills": []}'}}]},
        )
    )

    provider = _provider()
    result = await provider.generate_json("system prompt", "user prompt")

    assert result == '{"technical_skills": []}'


@pytest.mark.asyncio
@respx.mock
async def test_generate_json_raises_on_http_error_status():
    respx.post("https://fake-llm.example.com/v1/chat/completions").mock(
        return_value=httpx.Response(401, json={"error": "invalid api key"})
    )

    provider = _provider()
    with pytest.raises(LLMProviderError):
        await provider.generate_json("system prompt", "user prompt")


@pytest.mark.asyncio
@respx.mock
async def test_generate_json_raises_on_network_error():
    respx.post("https://fake-llm.example.com/v1/chat/completions").mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    provider = _provider()
    with pytest.raises(LLMProviderError):
        await provider.generate_json("system prompt", "user prompt")


@pytest.mark.asyncio
@respx.mock
async def test_generate_json_raises_on_unexpected_response_shape():
    respx.post("https://fake-llm.example.com/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"unexpected": "shape"})
    )

    provider = _provider()
    with pytest.raises(LLMProviderError):
        await provider.generate_json("system prompt", "user prompt")


@pytest.mark.asyncio
async def test_generate_json_raises_if_unconfigured():
    provider = OpenAICompatibleProvider(base_url="https://fake-llm.example.com/v1", api_key="", model="")
    with pytest.raises(LLMProviderError):
        await provider.generate_json("system prompt", "user prompt")
