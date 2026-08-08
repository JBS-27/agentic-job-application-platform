"""
Phase 2 tests: CandidateProfile schema (app/schemas/resume.py).
"""

from app.schemas.resume import CandidateProfile


def test_candidate_profile_allows_fully_empty_input():
    profile = CandidateProfile()
    assert profile.contact_info.full_name is None
    assert profile.professional_summary is None
    assert profile.technical_skills == []
    assert profile.education == []
    assert profile.work_experience == []
    assert profile.internships == []
    assert profile.projects == []
    assert profile.certifications == []
    assert profile.achievements == []


def test_candidate_profile_accepts_partial_data_without_inventing_fields():
    data = {
        "contact_info": {"full_name": "Jane Doe", "email": "jane@example.com"},
        "technical_skills": ["Python", "FastAPI"],
    }
    profile = CandidateProfile(**data)
    assert profile.contact_info.full_name == "Jane Doe"
    assert profile.contact_info.phone is None  # not provided -> stays null
    assert profile.technical_skills == ["Python", "FastAPI"]
    assert profile.education == []  # untouched section stays empty, not fabricated


def test_candidate_profile_json_schema_includes_all_top_level_sections():
    schema = CandidateProfile.model_json_schema()
    expected_sections = {
        "contact_info",
        "professional_summary",
        "technical_skills",
        "soft_skills",
        "education",
        "work_experience",
        "internships",
        "projects",
        "certifications",
        "achievements",
        "languages",
        "additional_information",
    }
    assert expected_sections.issubset(schema["properties"].keys())
