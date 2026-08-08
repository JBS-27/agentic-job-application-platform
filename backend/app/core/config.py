"""
Application configuration (Phase 1).

Loads settings from environment variables / .env file using pydantic-settings.
This file ONLY defines configuration plumbing for later phases to consume —
it contains no business logic, no LLM calls, and no parsing logic.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- General ---
    APP_NAME: str = "Agentic AI Job Application Platform"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # --- API ---
    API_V1_PREFIX: str = "/api/v1"
    BACKEND_CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    # --- Database (MongoDB) ---
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "job_application_platform"

    # --- LLM provider (provider-agnostic) ---
    # LLM_BASE_URL must point to an OpenAI-compatible /chat/completions endpoint.
    # This lets you swap providers (OpenAI, Groq, Together AI, Fireworks, local
    # Ollama in OpenAI-compat mode, etc.) purely via env vars — no code changes.
    LLM_PROVIDER: str = "openai"  # informational label only, e.g. openai | groq | together
    LLM_BASE_URL: str = "https://api.openai.com/v1"
    LLM_API_KEY: str = ""
    LLM_MODEL_NAME: str = ""
    LLM_REQUEST_TIMEOUT_SECONDS: float = 60.0

    # --- File storage / upload limits ---
    RESUME_UPLOAD_DIR: str = "uploads/resumes"
    MAX_UPLOAD_SIZE_MB: int = 5
    MIN_EXTRACTED_TEXT_CHARS: int = 30  # below this, we treat the PDF as unreadable/empty

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor so .env is parsed only once."""
    return Settings()
