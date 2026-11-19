"""Phase 3: job text becomes requirements, then a match against CandidateProfile."""

from app.schemas.resume import CandidateProfile, ContactInfo
from app.services.job.analyzer import _merge_copied_facts
from app.services.job.matcher import score_match
from app.services.job.parser import analyze_job_text

JOB = """
Title: Backend Engineer
Company: Northwind
Location: Remote

Requirements
- Python
- FastAPI
- MongoDB
"""


def _profile() -> CandidateProfile:
    return CandidateProfile(
        contact_info=ContactInfo(full_name="Jane Doe"),
        professional_summary="Software engineer with 3 years of experience.",
        technical_skills=["Python", "FastAPI", "MongoDB"],
    )


def test_parser_reads_labels_and_skips_the_requirements_heading():
    analysis = analyze_job_text(JOB)
    assert analysis.title == "Backend Engineer"
    assert analysis.company == "Northwind"
    assert analysis.location == "Remote"
    assert analysis.workplace == "remote"
    assert analysis.requirements == ["Python", "FastAPI", "MongoDB"]


def test_matcher_prepares_when_every_requirement_is_on_the_profile():
    analysis = analyze_job_text(JOB)
    match = score_match(_profile(), analysis, threshold=60)
    assert match.score == 100
    assert match.recommendation == "prepare"
    assert match.model == "rules"
    assert {item.requirement for item in match.overlaps} == {"Python", "FastAPI", "MongoDB"}


def test_matcher_skips_a_clearance_role_the_profile_cannot_support():
    analysis = analyze_job_text(
        "Title: Analyst\nCompany: Shield\nSecurity clearance required.\n- 10+ years COBOL\n"
    )
    match = score_match(_profile(), analysis, threshold=60)
    assert match.recommendation == "skip"
    assert match.deal_breakers


def test_llm_requirement_is_kept_only_when_it_is_copied_from_the_posting():
    analysis = analyze_job_text("Title: Engineer\nCompany: Northwind\n- Python\n")
    merged = _merge_copied_facts(
        analysis,
        {"requirements": ["Python", "10 years of COBOL invented by the model"], "title": ""},
        analysis.description_text,
    )
    assert merged.requirements == ["Python"]
