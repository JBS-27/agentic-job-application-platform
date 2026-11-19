# System Architecture — Agentic AI Job Application Platform

> This diagram shows the **eventual, full end-to-end flow** across all phases.
> Only the boxes involved in Phase 1 (Frontend shell, Backend shell, MongoDB
> connection plumbing) are actually wired up right now. Everything else is
> shown for context and will be implemented in later phases.

```
                                   ┌───────────────────────┐
                                   │         USER           │
                                   │ (uploads resume PDF,   │
                                   │  provides job URL/JD)  │
                                   └───────────┬────────────┘
                                               │
                                               ▼
                          ┌────────────────────────────────────┐
                          │         FRONTEND (React)            │
                          │  - Resume upload UI      (Phase 2)  │
                          │  - Job input UI           (Phase 3) │
                          │  - Answer review UI       (Phase 4) │
                          │  - Human-in-the-loop review (Ph. 5) │
                          └───────────────┬──────────────────────┘
                                          │ REST API (Axios)
                                          ▼
                          ┌────────────────────────────────────┐
                          │      BACKEND (FastAPI, Python)      │
                          │      /api/v1/* routes                │
                          └───────────────┬──────────────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                           ▼
  ┌────────────────────┐      ┌────────────────────────┐   ┌───────────────────────┐
  │  RESUME PROCESSING  │      │    JOB PROCESSING       │   │   DATABASE (MongoDB)  │
  │  (Phase 2)           │      │    (Phase 3)             │   │   - candidate profile │
  │  - PDF text extract  │      │  - Fetch job URL / JD    │   │   - job data          │
  │    (pypdf)            │      │  - Extract requirements │   │   - generated answers │
  │  - Structure into     │      │  - Normalize skills/    │   │   - application status│
  │    candidate profile  │      │    keywords              │   └───────────┬───────────┘
  └──────────┬───────────┘      └────────────┬─────────────┘               │
             │                                │                             │
             └───────────────┬────────────────┘                             │
                              ▼                                              │
                 ┌─────────────────────────────┐                            │
                 │   LLM PROCESSING LAYER        │◄───────────────────────────┘
                 │   (Phase 2–4, provider-       │
                 │    agnostic service)           │
                 │  - Candidate ↔ Job matching    │
                 │  - Gap analysis                │
                 │  - Answer generation           │
                 │    (via prompts/ templates)    │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌─────────────────────────────┐
                 │   AGENT ORCHESTRATION         │
                 │   (Phase 5)                    │
                 │  - Sequences: parse → match →  │
                 │    generate → automate         │
                 │  - Decides when human review    │
                 │    is required                  │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌─────────────────────────────┐
                 │  BROWSER AUTOMATION (Phase 5) │
                 │  - Playwright driver           │
                 │  - Detects target company form │
                 │  - Auto-fills fields with       │
                 │    generated answers            │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌─────────────────────────────┐
                 │      HUMAN REVIEW (Phase 5)   │
                 │  - User inspects filled form   │
                 │  - Edits / approves answers     │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌─────────────────────────────┐
                 │   FINAL SUBMISSION (Phase 5)  │
                 │  - Submits application to the  │
                 │    target company's site        │
                 └─────────────────────────────┘
```

## Phase 1 scope within this diagram

Only these are implemented right now:

- **Frontend (React)** — boots as an empty shell and calls `/health`.
- **Backend (FastAPI)** — exposes `/` and `/health` only; no feature routers registered.
- **Database (MongoDB)** — connection client configured (`app/db/mongodb.py`); no collections, models, or CRUD operations yet.

Every other box (Resume Processing, Job Processing, LLM Processing, Agent
Orchestration, Browser Automation, Human Review, Final Submission) is a
**folder placeholder only** — no logic has been written for them.
