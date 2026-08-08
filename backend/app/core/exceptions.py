"""
Application-level exceptions (introduced in Phase 2).

Each exception carries an HTTP status code and a user-safe message so
route handlers can translate them into clear API responses without
duplicating error-mapping logic in every endpoint.
"""


class AppError(Exception):
    """Base class for all application-level errors."""

    status_code: int = 500

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class InvalidFileError(AppError):
    """Raised when an uploaded file fails validation (type, size, integrity)."""

    status_code = 400


class ResumeExtractionError(AppError):
    """Raised when text cannot be reliably extracted from a resume PDF."""

    status_code = 422


class LLMProviderError(AppError):
    """Raised when the LLM provider call itself fails (network, auth, rate limit)."""

    status_code = 502


class InvalidLLMOutputError(AppError):
    """Raised when the LLM response cannot be parsed into the expected schema."""

    status_code = 502
