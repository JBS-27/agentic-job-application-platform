"""Phase 3–5 campaign tests. No network and no browser."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.resume import CandidateProfile, ContactInfo, WorkExperienceEntry
from app.services.agent.store import reset_store
from app.services.automation.form_filler import fill_html

client = TestClient(app)

JOB = """
Title: Backend Engineer
Company: Northwind
Location: Remote
Requirements
- Python
- FastAPI
- MongoDB
"""

CLEARANCE_JOB = """
Title: Cleared Analyst
Company: Shield
Must have security clearance required.
- 10+ years COBOL
"""


@pytest.fixture(autouse=True)
def _clean_store():
    reset_store()
    yield
    reset_store()


def _profile() -> dict:
    profile = CandidateProfile(
        contact_info=ContactInfo(full_name="Jane Doe", email="jane.doe@example.com", location="San Francisco"),
        professional_summary="Software engineer with 3 years of experience.",
        technical_skills=["Python", "FastAPI", "MongoDB"],
        work_experience=[
            WorkExperienceEntry(
                job_title="Software Engineer",
                company="Acme",
                start_date="2022",
                is_current=True,
                responsibilities=["Built FastAPI services."],
            )
        ],
    )
    return profile.model_dump()


def test_analyze_scores_overlapping_skills():
    response = client.post(
        "/api/v1/jobs/analyze",
        json={"candidate_profile": _profile(), "job_text": JOB, "use_llm": False},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["analysis"]["title"] == "Backend Engineer"
    assert body["analysis"]["company"] == "Northwind"
    assert body["match"]["score"] == 100
    assert body["match"]["recommendation"] == "prepare"


def test_low_match_recommends_skip():
    response = client.post(
        "/api/v1/jobs/analyze",
        json={"candidate_profile": _profile(), "job_text": CLEARANCE_JOB},
    )
    assert response.status_code == 200
    match = response.json()["match"]
    assert match["recommendation"] == "skip"
    assert match["deal_breakers"]


def test_private_job_url_is_rejected():
    response = client.post(
        "/api/v1/jobs/analyze",
        json={"candidate_profile": _profile(), "job_url": "http://127.0.0.1/secret"},
    )
    assert response.status_code == 400


def test_campaign_approve_fill_never_submits():
    created = client.post(
        "/api/v1/applications",
        json={
            "candidate_profile": _profile(),
            "job_text": JOB,
            "questions": ["Gender identity"],
            "request_package": True,
        },
    )
    assert created.status_code == 200
    session = created.json()
    sensitive = next(item for item in session["package"]["answers"] if item["sensitive"])
    assert sensitive["status"] == "refused"
    assert sensitive["value"] == ""

    decided = client.post(f"/api/v1/applications/{session['id']}/decision", json={"decision": "approve"})
    assert decided.status_code == 200
    assert decided.json()["phase"] == "approved"

    filled = client.post(f"/api/v1/applications/{session['id']}/fill", json={"engine": "html"})
    assert filled.status_code == 200
    report = filled.json()
    assert report["submit_clicked"] is False
    assert report["phase"] == "awaiting_submit"
    assert any(item["label"] == "Full name" and item["value"] == "Jane Doe" for item in report["wrote"])

    done = client.post(f"/api/v1/applications/{session['id']}/submitted")
    assert done.status_code == 200
    body = done.json()
    assert body["phase"] == "submitted"
    assert body["submit_clicked_by_system"] is False
    assert "Northwind" in body["follow_up_draft"]


def test_fill_before_approval_is_rejected():
    created = client.post(
        "/api/v1/applications",
        json={"candidate_profile": _profile(), "job_text": JOB},
    )
    session_id = created.json()["id"]
    response = client.post(f"/api/v1/applications/{session_id}/fill", json={})
    assert response.status_code == 409


def test_html_filler_does_not_activate_submit():
    html, report = fill_html("", [])
    assert report.submit_clicked is False
    assert 'type="submit"' in html
    assert "value=" not in html.split("<button")[0] or report.wrote == []


def test_years_question_without_evidence_stays_blank():
    created = client.post(
        "/api/v1/agent/run",
        json={
            "candidate_profile": _profile(),
            "job_text": JOB,
            "questions": ["How many years of COBOL?"],
        },
    )
    answers = created.json()["package"]["answers"]
    cobol = next(item for item in answers if "COBOL" in item["label"])
    assert cobol["value"] == ""
    assert cobol["confidence"] == "unknown"
