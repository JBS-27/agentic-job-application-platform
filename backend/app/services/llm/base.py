"""
Provider-agnostic LLM interface (Phase 2).

Any concrete provider (OpenAI, Groq, Together AI, Fireworks, local Ollama
in OpenAI-compat mode, a native Gemini/Anthropic SDK later, etc.) must
implement this interface. The rest of the app only ever depends on
`BaseLLMProvider`, never on a specific vendor SDK — swapping providers is
a config change, not a code change.
"""

from abc import ABC, abstractmethod


class BaseLLMProvider(ABC):
    @abstractmethod
    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.0,
    ) -> str:
        """
        Sends a system+user prompt pair to the LLM and returns the raw text
        response (expected to be a JSON string). Implementations should
        raise `app.core.exceptions.LLMProviderError` on network/auth/API
        failures rather than letting vendor-specific exceptions leak out.
        """
        raise NotImplementedError
