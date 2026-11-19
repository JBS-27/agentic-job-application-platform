"""
Prompt templates for resume understanding (Phase 2).

Kept deliberately separate from the route handler and the LLM service so
prompts can be iterated on independently. The user prompt embeds
`CandidateProfile.model_json_schema()` directly, so the schema shown to
the LLM can never drift out of sync with the Pydantic model that
validates its output.
"""

import json

from app.schemas.resume import CandidateProfile

RESUME_EXTRACTION_SYSTEM_PROMPT = """You are a meticulous resume-parsing assistant. \
Your only job is to convert raw resume text into a structured JSON object.

STRICT RULES — follow all of them:
1. Extract ONLY information that is explicitly present in the resume text provided.
2. NEVER invent, guess, infer, or embellish any detail (no fabricated dates, \
employers, skills, degrees, or contact details).
3. If a piece of information is not present in the resume, set it to null \
(for single-value fields) or an empty list [] (for list fields). Do not omit \
fields — include every field from the schema with the appropriate empty value.
4. Do not summarize or rewrite the candidate's own wording beyond light cleanup \
of whitespace/formatting artifacts from PDF extraction.
5. Output ONLY a single valid JSON object that matches the provided JSON schema \
exactly. Do not include markdown code fences, explanations, or any text outside \
the JSON object.
"""


def build_resume_extraction_user_prompt(resume_text: str) -> str:
    """Builds the user-turn prompt, embedding the live Pydantic schema."""
    schema_json = json.dumps(CandidateProfile.model_json_schema(), indent=2)

    return f"""JSON schema you must strictly follow for your response:
{schema_json}

Resume text (raw text extracted from a PDF; whitespace/line breaks may be imperfect):
\"\"\"
{resume_text}
\"\"\"

Return only the JSON object described by the schema above. Remember: never \
invent information that is not present in the resume text.
"""
