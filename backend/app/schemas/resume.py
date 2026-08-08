"""
Resume / candidate profile schemas (Phase 2).

`CandidateProfile` is the single source of truth for what the LLM must
return. Its JSON schema is embedded directly into the extraction prompt
(see app/prompts/resume_prompts.py) so the prompt and the validator can
never drift out of sync.

Design rule: every field is Optional or defaults to an empty list/dict.
Nothing is required, because a real resume may legitimately omit any
given section — missing data must surface as null/empty, never as a
validation failure and never as invented content.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class ContactInfo(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None


class EducationEntry(BaseModel):
    institution: Optional[str] = None
    degree: Optional[str] = None
    field_of_study: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    gpa: Optional[str] = None
    relevant_coursework: List[str] = Field(default_factory=list)


class WorkExperienceEntry(BaseModel):
    job_title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_current: Optional[bool] = None
    responsibilities: List[str] = Field(default_factory=list)


class InternshipEntry(BaseModel):
    role: Optional[str] = None
    organization: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    responsibilities: List[str] = Field(default_factory=list)


class ProjectEntry(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    technologies: List[str] = Field(default_factory=list)
    link: Optional[str] = None


class CertificationEntry(BaseModel):
    name: Optional[str] = None
    issuing_organization: Optional[str] = None
    issue_date: Optional[str] = None
    credential_id: Optional[str] = None


class CandidateProfile(BaseModel):
    contact_info: ContactInfo = Field(default_factory=ContactInfo)
    professional_summary: Optional[str] = None
    technical_skills: List[str] = Field(default_factory=list)
    soft_skills: List[str] = Field(default_factory=list)
    education: List[EducationEntry] = Field(default_factory=list)
    work_experience: List[WorkExperienceEntry] = Field(default_factory=list)
    internships: List[InternshipEntry] = Field(default_factory=list)
    projects: List[ProjectEntry] = Field(default_factory=list)
    certifications: List[CertificationEntry] = Field(default_factory=list)
    achievements: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=list)
    # Free-text catch-all for anything real but not covered by a field above
    # (e.g. publications, volunteering, hobbies explicitly listed on the resume).
    additional_information: Optional[str] = None


class ResumeUploadResponse(BaseModel):
    filename: str
    extracted_text_length: int
    candidate_profile: CandidateProfile


class ErrorResponse(BaseModel):
    detail: str
