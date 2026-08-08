# Agentic AI Job Application Platform

An end-to-end agentic AI system that takes a candidate's resume and a target
job, understands the fit between them, generates tailored application
answers, and (in later phases) uses browser automation to help fill out the
company's application form under human review.

**Current status: Phase 2 — Backend Resume Data Extraction complete.**
Resume PDF upload, text extraction, and LLM-based structured profile
extraction are implemented. Job analysis, answer generation, and
browser automation do not exist yet.

## Tech Stack (finalized in Phase 1)

| Layer | Choice |
|---|---|
| Frontend | React (Vite) |
| Backend | Python + FastAPI |
| Database | MongoDB (Motor async driver + Beanie ODM, from Phase 2) |
| PDF Parsing | pypdf (from Phase 2) |
| Browser Automation | Playwright (from Phase 5) |
| LLM Layer | Provider-agnostic service interface (from Phase 2) |

See `docs/architecture.md` for the full end-to-end architecture diagram.

## Phase 1 Setup

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then fill in local values
uvicorn app.main:app --reload
```

Visit `http://localhost:8000/health` to confirm the API and MongoDB
connection plumbing are wired correctly, and `http://localhost:8000/docs`
for interactive Swagger UI to try `POST /api/v1/resume/upload`.

### Running the Phase 2 tests

```bash
cd backend
python -m pytest -v
```

All 33 tests run offline against fixture PDFs and a fake LLM provider —
no real API tokens are consumed.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Visit `http://localhost:5173` — it should show a status message reflecting
the backend's `/health` response.

## Project Structure

See the folder tree below (also mirrored on disk). Directories for Phase
2–5 features exist as placeholders with `# PLACEHOLDER` comments only.

```
job-application-platform/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI entrypoint; resume router live, others commented
│   │   ├── api/v1/routes/
│   │   │   ├── resume.py           # ✅ POST /resume/upload (Phase 2)
│   │   │   ├── job.py               # placeholder (Phase 3)
│   │   │   ├── application.py       # placeholder (Phase 4)
│   │   │   └── agent.py             # placeholder (Phase 5)
│   │   ├── core/                   # config.py, logging.py, exceptions.py (Phase 2)
│   │   ├── services/
│   │   │   ├── llm/
│   │   │   │   ├── base.py               # ✅ BaseLLMProvider interface
│   │   │   │   ├── factory.py            # ✅ get_llm_provider()
│   │   │   │   └── providers/
│   │   │   │       └── openai_compatible.py  # ✅ works with OpenAI/Groq/Together/etc.
│   │   │   ├── resume/
│   │   │   │   ├── validator.py          # ✅ file validation
│   │   │   │   ├── parser.py             # ✅ pypdf extraction + cleanup
│   │   │   │   └── profile_extractor.py  # ✅ LLM orchestration + validation
│   │   │   ├── job/                # analyzer.py (placeholder, Phase 3)
│   │   │   ├── agent/              # orchestrator.py (placeholder, Phase 5)
│   │   │   └── automation/         # playwright_driver.py (placeholder, Phase 5)
│   │   ├── prompts/
│   │   │   ├── resume_prompts.py   # ✅ schema-driven extraction prompt (Phase 2)
│   │   │   ├── job_prompts.py       # placeholder (Phase 3)
│   │   │   └── answer_prompts.py    # placeholder (Phase 4)
│   │   ├── models/                 # MongoDB document models (placeholders, Phase 3+)
│   │   ├── schemas/
│   │   │   ├── resume.py           # ✅ CandidateProfile + nested schemas (Phase 2)
│   │   │   ├── job.py               # placeholder (Phase 3)
│   │   │   └── application.py       # placeholder (Phase 4/5)
│   │   ├── db/                     # mongodb.py (connection setup only, unused this phase)
│   │   └── utils/                  # shared helpers (placeholders)
│   ├── tests/
│   │   ├── conftest.py             # ✅ fixture PDFs + FakeLLMProvider
│   │   ├── test_health.py          # Phase 1 sanity check
│   │   ├── api/test_resume_route.py        # ✅ endpoint integration tests
│   │   └── services/               # ✅ parser, validator, schema, extractor, provider tests
│   ├── pytest.ini
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx / main.jsx      # bare shell, calls /health
│   │   ├── components/, pages/, services/, hooks/, utils/, assets/  (placeholders)
│   ├── package.json
│   └── .env.example
├── docs/
│   └── architecture.md             # full end-to-end architecture diagram
├── .gitignore
└── README.md
```

## Development Phases

1. **Phase 1** — Architecture, folder structure, config, empty scaffolding. ✅
2. **Phase 2 (this phase)** — Resume upload + PDF parsing + candidate profile extraction. ✅
3. **Phase 3** — Job URL/description ingestion + requirement analysis + matching.
4. **Phase 4** — LLM-powered application answer generation.
5. **Phase 5** — Agent orchestration + Playwright browser automation + human review + submission.

## Phase 2 API

### `POST /api/v1/resume/upload`

Multipart form upload, field name `file`, PDF only.

**Success (200)**
```json
{
  "filename": "resume.pdf",
  "extracted_text_length": 1423,
  "candidate_profile": {
    "contact_info": { "full_name": "...", "email": "...", "...": null },
    "professional_summary": "...",
    "technical_skills": ["..."],
    "soft_skills": [],
    "education": [ { "institution": "...", "degree": "...", "...": null } ],
    "work_experience": [ { "...": "..." } ],
    "internships": [],
    "projects": [ { "...": "..." } ],
    "certifications": [],
    "achievements": [],
    "languages": [],
    "additional_information": null
  }
}
```

**Error responses**
| Status | Meaning |
|---|---|
| 400 | Invalid file (wrong type/extension, empty, oversized, not a real PDF) |
| 422 | PDF opened but no usable text could be extracted (scanned/blank/corrupt) |
| 502 | LLM provider failure, or LLM output could not be parsed into the schema after one retry |
| 500 | Unexpected server error |
