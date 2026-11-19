"""
LLM provider factory (Phase 2).

Callers ask for "the configured LLM provider" without knowing or caring
which concrete class backs it. Today every supported free/paid tier
speaks the OpenAI-compatible API, so one class covers them all; a native
SDK-based provider can be added here later without touching call sites.
"""

from app.core.config import get_settings
from app.services.llm.base import BaseLLMProvider
from app.services.llm.providers.openai_compatible import OpenAICompatibleProvider


def get_llm_provider() -> BaseLLMProvider:
    settings = get_settings()
    return OpenAICompatibleProvider(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY,
        model=settings.LLM_MODEL_NAME,
        timeout=settings.LLM_REQUEST_TIMEOUT_SECONDS,
    )
