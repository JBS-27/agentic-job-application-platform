"""Prompt for optional job enrichment.

The schema is embedded from `JobAnalysis` the same way resume extraction
embeds `CandidateProfile`, so the model and the validator stay aligned.
The analyzer still drops any requirement that is not copied from the posting.
"""

import json

from app.schemas.job import JobAnalysis

JOB_ANALYSIS_SYSTEM_PROMPT = """You extract one job posting into JSON.

STRICT RULES:
1. Copy only words that appear in the job text.
2. Never invent a title, company, location, skill, or years requirement.
3. requirements is a list of requirement lines copied from the posting.
4. If a field is missing, use an empty string or an empty list.
5. Return only one JSON object. No markdown and no commentary.
"""


def build_job_analysis_prompt(job_text: str) -> str:
    schema = JobAnalysis.model_json_schema()
    kept = {
        "title": schema["properties"]["title"],
        "company": schema["properties"]["company"],
        "location": schema["properties"]["location"],
        "requirements": schema["properties"]["requirements"],
    }
    schema_json = json.dumps(
        {"type": "object", "properties": kept, "required": ["title", "company", "location", "requirements"]},
        indent=2,
    )
    return f"""JSON object you must return:
{schema_json}

Job text:
\"\"\"
{job_text[:12000]}
\"\"\"

Return only that JSON object. Every requirement string must be copied from the job text.
"""
