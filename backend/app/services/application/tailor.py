"""Draft application answers from CandidateProfile facts. Never invents employers or years."""

import hashlib
import re
from datetime import datetime, timezone

from app.schemas.application import GeneratedApplicationPackage, PackageAnswer, PackageBullet
from app.schemas.job import JobAnalysis, MatchResult
from app.schemas.resume import CandidateProfile
from app.services.job.matcher import _overall_years
from app.utils.text_utils import normalize

_SENSITIVE = re.compile(
    r"gender|race|ethnicity|veteran|disability|lgbt|sexual|religion|hispanic",
    re.I,
)


def draft_package(
    profile: CandidateProfile,
    analysis: JobAnalysis,
    match: MatchResult,
    questions: list[str] | None = None,
    *,
    request_package: bool = False,
) -> GeneratedApplicationPackage:
    answers = _contact_answers(profile)
    for question in questions or []:
        label = " ".join(question.split())
        if not label:
            continue
        answers.append(_answer_question(profile, label))

    unresolved = [item.label for item in answers if item.confidence == "unknown" and not item.sensitive]
    bullets: list[PackageBullet] = []
    cover = ""
    if request_package:
        bullets = _bullets(profile, match)
        cover = _cover_letter(profile, analysis)

    return GeneratedApplicationPackage(
        job_id=analysis.id,
        bullets=bullets[:4],
        cover_letter=cover,
        answers=answers,
        unresolved=unresolved,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def _contact_answers(profile: CandidateProfile) -> list[PackageAnswer]:
    contact = profile.contact_info
    rows = [
        ("Full name", contact.full_name, "contact_info.full_name"),
        ("Email", contact.email, "contact_info.email"),
        ("Phone", contact.phone, "contact_info.phone"),
        ("City", contact.location, "contact_info.location"),
        ("LinkedIn URL", contact.linkedin_url, "contact_info.linkedin_url"),
        ("GitHub URL", contact.github_url, "contact_info.github_url"),
        ("Portfolio URL", contact.portfolio_url, "contact_info.portfolio_url"),
    ]
    answers = []
    for label, value, field in rows:
        text = (value or "").strip()
        answers.append(
            _row(
                label,
                text,
                "fact" if text else "unknown",
                field if text else "",
            )
        )
    years = _overall_years(profile)
    if years is None:
        answers.append(_row("Years of experience", "", "unknown", ""))
    else:
        answers.append(
            _row(
                "Years of experience",
                str(years),
                "fact",
                "professional_summary or work dates",
                kind="years",
            )
        )
    if profile.technical_skills:
        answers.append(
            _row(
                "Technical skills",
                ", ".join(profile.technical_skills),
                "fact",
                "technical_skills",
            )
        )
    return answers


def _answer_question(profile: CandidateProfile, label: str) -> PackageAnswer:
    if _SENSITIVE.search(label):
        return _row(label, "", "unknown", "", status="refused", sensitive=True)
    years = re.search(r"how many years|years of|years with", label, re.I)
    if years:
        skill = _skill_from_question(label)
        explicit = _explicit_skill_years(profile, skill)
        if explicit:
            return _row(label, explicit[0], "fact", explicit[1], kind="years")
        return _row(label, "", "unknown", "", kind="years")
    if re.match(r"^(are|do|have|will|can|would|is)\b", label, re.I):
        return _row(label, "", "unknown", "", kind="yesno")
    blob = normalize(profile.professional_summary or "")
    if blob and normalize(label) and normalize(label) in blob:
        return _row(label, profile.professional_summary or "", "fact", "professional_summary", kind="long_text")
    return _row(label, "", "unknown", "", kind="long_text")


def _skill_from_question(label: str) -> str:
    match = re.search(r"(?:with|of|in|using)\s+(.+?)\??$", label, re.I)
    return normalize(match.group(1) if match else "")


def _explicit_skill_years(profile: CandidateProfile, skill: str) -> tuple[str, str] | None:
    if not skill:
        return None
    texts = [profile.professional_summary or ""]
    for job in profile.work_experience:
        texts.extend(job.responsibilities)
    pattern = re.compile(rf"(\d+)\s*\+?\s*(?:years|yrs).{{0,40}}{re.escape(skill)}", re.I)
    for text in texts:
        found = pattern.search(normalize(text))
        if found:
            return found.group(1), text.strip()[:240]
    return None


def _bullets(profile: CandidateProfile, match: MatchResult) -> list[PackageBullet]:
    bullets: list[PackageBullet] = []
    overlap_blob = normalize(" ".join(item.requirement for item in match.overlaps))
    for job in profile.work_experience:
        for duty in job.responsibilities:
            if overlap_blob and not any(token in normalize(duty) for token in overlap_blob.split() if len(token) > 3):
                continue
            bullets.append(PackageBullet(text=duty.strip(), evidence=duty.strip()[:240]))
            if len(bullets) >= 4:
                return bullets
    return bullets


def _cover_letter(profile: CandidateProfile, analysis: JobAnalysis) -> str:
    contact = profile.contact_info
    sentences = []
    if contact.full_name and analysis.title:
        target = f"{analysis.title} at {analysis.company}" if analysis.company else analysis.title
        sentences.append(f"I am applying for {target}.")
    if profile.work_experience:
        job = profile.work_experience[0]
        if job.job_title and job.company:
            sentences.append(f"I have worked as {job.job_title} at {job.company}.")
    if profile.technical_skills:
        sentences.append("Skills listed on my resume include " + ", ".join(profile.technical_skills[:8]) + ".")
    return " ".join(sentences)[:1200]


def _row(
    label: str,
    value: str,
    confidence: str,
    evidence: str,
    *,
    kind: str = "text",
    status: str = "draft",
    sensitive: bool = False,
) -> PackageAnswer:
    return PackageAnswer(
        field_key=hashlib.sha256(normalize(label).encode()).hexdigest()[:12],
        label=label,
        kind=kind,  # type: ignore[arg-type]
        value=value,
        status=status,  # type: ignore[arg-type]
        confidence=confidence,  # type: ignore[arg-type]
        evidence=evidence,
        sensitive=sensitive,
    )
