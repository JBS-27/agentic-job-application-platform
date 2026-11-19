"""Score a CandidateProfile against a JobAnalysis using only profile facts."""

import re
from datetime import date

from app.schemas.job import JobAnalysis, MatchGap, MatchOverlap, MatchResult
from app.schemas.resume import CandidateProfile
from app.utils.text_utils import normalize


def score_match(profile: CandidateProfile, analysis: JobAnalysis, threshold: int = 60) -> MatchResult:
    corpus = _profile_corpus(profile)
    skills = _skills(profile)
    overlaps: list[MatchOverlap] = []
    gaps: list[MatchGap] = []
    deal_breakers: list[str] = []

    requirements = analysis.requirements or []
    for requirement in requirements:
        evidence = _evidence_for(requirement, corpus, skills)
        if evidence:
            overlaps.append(MatchOverlap(requirement=requirement, evidence=evidence[0], profile_field=evidence[1]))
        else:
            gaps.append(MatchGap(requirement=requirement, reason="missing"))

    years_note = _years_gap(profile, analysis.description_text)
    if years_note:
        gaps.append(MatchGap(requirement=years_note[0], reason="missing"))
        if years_note[1]:
            deal_breakers.append(years_note[0])

    if re.search(r"security clearance|clearance required", analysis.description_text, re.I):
        if "clearance" not in corpus:
            note = "Security clearance is required and is not on the profile."
            deal_breakers.append(note)
            gaps.append(MatchGap(requirement=note, reason="missing"))

    if not requirements:
        score = 50
    else:
        score = round(100 * len(overlaps) / len(requirements))

    if deal_breakers or score < threshold:
        recommendation = "skip"
    elif abs(score - threshold) <= 5:
        recommendation = "review"
    else:
        recommendation = "prepare"

    recommendations: list[str] = []
    if recommendation == "skip":
        recommendations.append("Skip is the default. Approve only if you still want to prepare this job.")
    if gaps:
        recommendations.append("Blank answers stay blank until you type them.")

    return MatchResult(
        job_id=analysis.id,
        score=score,
        threshold=threshold,
        recommendation=recommendation,
        overlaps=overlaps,
        gaps=gaps,
        deal_breakers=deal_breakers,
        recommendations=recommendations,
        model="rules",
    )


def _skills(profile: CandidateProfile) -> list[str]:
    names = list(profile.technical_skills) + list(profile.soft_skills) + list(profile.languages)
    for project in profile.projects:
        names.extend(project.technologies)
    for cert in profile.certifications:
        if cert.name:
            names.append(cert.name)
    return [normalize(name) for name in names if normalize(name)]


def _profile_corpus(profile: CandidateProfile) -> str:
    parts = [
        profile.professional_summary or "",
        " ".join(profile.technical_skills),
        " ".join(profile.soft_skills),
        " ".join(profile.achievements),
    ]
    for job in profile.work_experience:
        parts.extend([job.job_title or "", job.company or "", " ".join(job.responsibilities)])
    for project in profile.projects:
        parts.extend([project.name or "", project.description or "", " ".join(project.technologies)])
    return normalize(" ".join(parts))


def _evidence_for(requirement: str, corpus: str, skills: list[str]) -> tuple[str, str] | None:
    wanted = normalize(requirement)
    for skill in skills:
        if skill and (skill in wanted or wanted in skill):
            return skill, "technical_skills"
    tokens = [token for token in wanted.split() if len(token) > 2]
    if not tokens:
        return None
    hits = [token for token in tokens if token in corpus]
    if len(hits) / len(tokens) >= 0.6:
        return " ".join(hits[:6]), "profile_text"
    return None


def _years_gap(profile: CandidateProfile, description: str) -> tuple[str, bool] | None:
    match = re.search(r"(\d+)\s*\+?\s*(?:years|yrs)", description, re.I)
    if not match:
        return None
    required = int(match.group(1))
    have = _overall_years(profile)
    if have is None:
        return (f"{required}+ years requested. Overall years are not stated on the profile.", False)
    if have + 1 < required:
        far = have + 3 < required
        return (f"Role asks for {required}+ years. Profile supports about {have}.", far)
    return None


def _overall_years(profile: CandidateProfile) -> int | None:
    summary = profile.professional_summary or ""
    explicit = re.search(r"(\d+)\s*\+?\s*(?:years|yrs)", summary, re.I)
    if explicit:
        return int(explicit.group(1))
    years: list[int] = []
    for job in profile.work_experience:
        for raw in (job.start_date, job.end_date):
            found = re.search(r"(19|20)\d{2}", raw or "")
            if found:
                years.append(int(found.group(0)))
        if job.is_current:
            years.append(date.today().year)
    if not years:
        return None
    return max(0, date.today().year - min(years))
