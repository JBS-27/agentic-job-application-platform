"""Job analysis: rules first, optional LLM only to restate lines already in the text."""

import json

from app.core.exceptions import JobSourceError
from app.core.logging import get_logger
from app.prompts.job_prompts import JOB_ANALYSIS_SYSTEM_PROMPT, build_job_analysis_prompt
from app.schemas.job import JobAnalysis
from app.services.job.fetcher import fetch_job_text
from app.services.job.parser import analyze_job_text
from app.services.llm.base import BaseLLMProvider
from app.utils.text_utils import extract_json_object, normalize

logger = get_logger(__name__)

_RETRY = (
    "\n\nIMPORTANT: Respond again with ONLY one JSON object. "
    "No markdown fences and no commentary."
)


async def analyze_job(
    job_text: str,
    job_url: str | None,
    *,
    use_llm: bool,
    llm: BaseLLMProvider | None,
) -> JobAnalysis:
    source = "job_text"
    text = (job_text or "").strip()
    url = (job_url or "").strip()
    if url:
        fetched = await fetch_job_text(url)
        text = f"{text}\n{fetched}".strip() if text else fetched
        source = "job_url"
    if len(text) < 20:
        raise JobSourceError("Paste a job description or a public job URL.")

    analysis = analyze_job_text(text, url=url, source="job_url" if url else "job_text")
    analysis.source = source  # type: ignore[assignment]
    if not use_llm or llm is None:
        return analysis

    prompt = build_job_analysis_prompt(text)
    try:
        raw = await _complete(llm, prompt)
        data = _parse_enrichment(raw)
        if data is None:
            logger.warning("Job LLM response was not valid JSON. Retrying once.")
            raw = await _complete(llm, prompt + _RETRY)
            data = _parse_enrichment(raw)
    except Exception as exc:
        logger.warning("Job LLM enrichment skipped: %s", exc)
        return analysis
    if data is None:
        logger.warning("Job LLM enrichment skipped after retry. Keeping the rules analysis.")
        return analysis
    return _merge_copied_facts(analysis, data, text)


async def _complete(llm: BaseLLMProvider, prompt: str) -> str:
    return await llm.generate_json(JOB_ANALYSIS_SYSTEM_PROMPT, prompt)


def _parse_enrichment(raw: str) -> dict | None:
    try:
        data = extract_json_object(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _merge_copied_facts(analysis: JobAnalysis, data: dict, source_text: str) -> JobAnalysis:
    lowered = source_text.lower()
    seen = {normalize(item) for item in analysis.requirements}
    for item in data.get("requirements") or []:
        line = str(item).strip()
        key = normalize(line)
        if line and line.lower() in lowered and key not in seen:
            analysis.requirements.append(line)
            seen.add(key)
    for field in ("title", "company", "location"):
        value = str(data.get(field) or "").strip()
        if value and value.lower() in lowered and not getattr(analysis, field):
            setattr(analysis, field, value[:160])
    return analysis


def analysis_json(analysis: JobAnalysis) -> str:
    return json.dumps(analysis.model_dump())
