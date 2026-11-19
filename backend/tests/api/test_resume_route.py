"""
Phase 2 integration tests: POST /api/v1/resume/upload
(app/api/v1/routes/resume.py).

The LLM provider is monkeypatched at the route's import location so these
tests exercise the real validator + real pypdf extraction end-to-end,
without making real network/LLM calls.
"""

import pytest
from fastapi.testclient import TestClient

import app.api.v1.routes.resume as resume_route
from app.main import app
from tests.conftest import FakeLLMProvider

client = TestClient(app)


def test_root_and_health_still_work():
    # Sanity check that Phase 1 scaffolding wasn't broken by Phase 2 changes.
    assert client.get("/").status_code == 200


def test_upload_valid_resume_returns_candidate_profile(
    monkeypatch, valid_resume_pdf_bytes, valid_llm_json_response
):
    fake_provider = FakeLLMProvider([valid_llm_json_response])
    monkeypatch.setattr(resume_route, "get_llm_provider", lambda: fake_provider)

    response = client.post(
        "/api/v1/resume/upload",
        files={"file": ("resume.pdf", valid_resume_pdf_bytes, "application/pdf")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "resume.pdf"
    assert body["extracted_text_length"] > 0
    assert "Python" in body["candidate_profile"]["technical_skills"]
    assert fake_provider.call_count == 1


def test_upload_rejects_non_pdf_file(monkeypatch, valid_llm_json_response):
    fake_provider = FakeLLMProvider([valid_llm_json_response])
    monkeypatch.setattr(resume_route, "get_llm_provider", lambda: fake_provider)

    response = client.post(
        "/api/v1/resume/upload",
        files={"file": ("resume.txt", b"just some text", "text/plain")},
    )

    assert response.status_code == 400
    assert fake_provider.call_count == 0  # rejected before any LLM call — no tokens spent


def test_upload_rejects_blank_pdf(monkeypatch, blank_pdf_bytes, valid_llm_json_response):
    fake_provider = FakeLLMProvider([valid_llm_json_response])
    monkeypatch.setattr(resume_route, "get_llm_provider", lambda: fake_provider)

    response = client.post(
        "/api/v1/resume/upload",
        files={"file": ("resume.pdf", blank_pdf_bytes, "application/pdf")},
    )

    assert response.status_code == 422
    assert fake_provider.call_count == 0  # extraction failed before reaching the LLM


def test_upload_returns_502_on_malformed_llm_output_after_retry(
    monkeypatch, valid_resume_pdf_bytes
):
    fake_provider = FakeLLMProvider(["garbage", "still garbage"])
    monkeypatch.setattr(resume_route, "get_llm_provider", lambda: fake_provider)

    response = client.post(
        "/api/v1/resume/upload",
        files={"file": ("resume.pdf", valid_resume_pdf_bytes, "application/pdf")},
    )

    assert response.status_code == 502
    assert fake_provider.call_count == 2
