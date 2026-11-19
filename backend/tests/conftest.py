"""
Shared pytest fixtures for Phase 2 tests.
"""

import json
from io import BytesIO

import pytest
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.schemas.resume import CandidateProfile
from app.services.llm.base import BaseLLMProvider

SAMPLE_RESUME_TEXT = [
    "Jane Doe",
    "jane.doe@example.com | +1-555-123-4567 | San Francisco, CA",
    "linkedin.com/in/janedoe | github.com/janedoe",
    "",
    "PROFESSIONAL SUMMARY",
    "Software engineer with 3 years of experience building web applications.",
    "",
    "TECHNICAL SKILLS",
    "Python, JavaScript, React, FastAPI, MongoDB",
    "",
    "WORK EXPERIENCE",
    "Software Engineer, Acme Corp, Jan 2022 - Present",
    "Built and maintained backend services in Python.",
    "",
    "EDUCATION",
    "B.S. Computer Science, State University, 2018 - 2022",
]


def _build_pdf_bytes(lines: list[str]) -> bytes:
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    text_object = c.beginText(50, 750)
    for line in lines:
        text_object.textLine(line)
    c.drawText(text_object)
    c.showPage()
    c.save()
    return buffer.getvalue()


@pytest.fixture
def valid_resume_pdf_bytes() -> bytes:
    return _build_pdf_bytes(SAMPLE_RESUME_TEXT)


@pytest.fixture
def blank_pdf_bytes() -> bytes:
    """A structurally valid PDF with no text content on the page."""
    return _build_pdf_bytes([])


@pytest.fixture
def not_a_pdf_bytes() -> bytes:
    return b"This is just a plain text file, not a PDF."


class FakeLLMProvider(BaseLLMProvider):
    """Test double that returns pre-programmed responses instead of calling a real API."""

    def __init__(self, responses: list[str]):
        self._responses = list(responses)
        self.call_count = 0

    async def generate_json(self, system_prompt: str, user_prompt: str, *, temperature: float = 0.0) -> str:
        self.call_count += 1
        if not self._responses:
            raise AssertionError("FakeLLMProvider ran out of programmed responses")
        return self._responses.pop(0)


@pytest.fixture
def valid_llm_json_response() -> str:
    profile = CandidateProfile(
        professional_summary="Software engineer with 3 years of experience.",
        technical_skills=["Python", "JavaScript", "React", "FastAPI", "MongoDB"],
    )
    return profile.model_dump_json()
