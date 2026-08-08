"""
OpenAI-compatible chat completions provider (Phase 2).

This single class is what makes the LLM layer "provider-agnostic" in
practice: OpenAI, Groq, Together AI, Fireworks, OpenRouter, and local
Ollama (in OpenAI-compat mode) all expose the same `/chat/completions`
shape. Switching providers on a free tier is therefore just an env-var
change (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL_NAME) — no code changes
anywhere else in the app.
"""

import httpx

from app.core.exceptions import LLMProviderError
from app.core.logging import get_logger
from app.services.llm.base import BaseLLMProvider

logger = get_logger(__name__)


class OpenAICompatibleProvider(BaseLLMProvider):
    def __init__(self, base_url: str, api_key: str, model: str, timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.0,
    ) -> str:
        if not self.api_key or not self.model:
            raise LLMProviderError(
                "LLM is not configured. Set LLM_API_KEY and LLM_MODEL_NAME in the backend .env file."
            )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            # Most OpenAI-compatible providers honor this hint to bias toward
            # valid JSON; harmless if a given provider ignores it.
            "response_format": {"type": "json_object"},
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions", headers=headers, json=payload
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "LLM provider returned an error status: %s %s",
                exc.response.status_code,
                exc.response.text[:500],
            )
            raise LLMProviderError(
                f"The LLM provider returned an error (HTTP {exc.response.status_code})."
            ) from exc
        except httpx.RequestError as exc:
            logger.error("Failed to reach LLM provider: %s", exc)
            raise LLMProviderError("Could not reach the LLM provider. Please try again.") from exc

        try:
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError) as exc:
            logger.error("Unexpected LLM response structure: %s", exc)
            raise LLMProviderError("Received an unexpected response structure from the LLM provider.") from exc
