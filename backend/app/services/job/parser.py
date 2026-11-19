"""Turn pasted or fetched job text into a JobAnalysis without inventing facts."""

import re
import uuid
from datetime import datetime, timezone

from app.schemas.job import JobAnalysis
from app.utils.text_utils import normalize

_SECTION_HEADERS = {
    "requirements",
    "qualifications",
    "responsibilities",
    "about the job",
    "what you will need",
    "nice to have",
}


_LABELS = {
    "title": ("job title", "title", "position", "role"),
    "company": ("company", "employer", "organization"),
    "location": ("location", "city"),
}


def analyze_job_text(text: str, *, url: str = "", source: str = "job_text") -> JobAnalysis:
    raw = (text or "").strip()
    clipped = raw[:20_000]
    lines = [line.strip(" \t-•*") for line in clipped.splitlines()]
    lines = [line for line in lines if line]

    title = _labeled(lines, _LABELS["title"]) or (lines[0][:140] if lines else "")
    company = _labeled(lines, _LABELS["company"])
    location = _labeled(lines, _LABELS["location"])
    workplace = _workplace(clipped)
    requirements = _requirements(clipped)

    return JobAnalysis(
        id=uuid.uuid4().hex[:12],
        url=url or "",
        title=title,
        company=company,
        location=location,
        workplace=workplace,
        description_text=clipped,
        requirements=requirements,
        captured_at=datetime.now(timezone.utc).isoformat(),
        source=source,
    )


def _labeled(lines: list[str], names: tuple[str, ...]) -> str:
    for line in lines:
        lowered = line.lower()
        for name in names:
            prefix = f"{name}:"
            if lowered.startswith(prefix):
                return line.split(":", 1)[1].strip()[:160]
    return ""


def _workplace(text: str) -> str:
    lowered = text.lower()
    if "hybrid" in lowered:
        return "hybrid"
    if re.search(r"\bremote\b", lowered):
        return "remote"
    if re.search(r"\bon-?site\b", lowered):
        return "onsite"
    return "unknown"


def _requirements(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        is_bullet = bool(re.match(r"^(\s*[-•*]|\s*\d+[.)])\s+\S", line))
        looks_required = bool(re.search(r"experience|proficient|required|years|familiar", cleaned, re.I))
        if not is_bullet and not looks_required:
            continue
        item = re.sub(r"^(\s*[-•*]|\s*\d+[.)])\s+", "", cleaned).strip()
        if len(item) < 3 or len(item) > 240:
            continue
        key = normalize(item)
        if key in _SECTION_HEADERS or key in seen:
            continue
        seen.add(key)
        found.append(item)
        if len(found) >= 30:
            break
    return found
