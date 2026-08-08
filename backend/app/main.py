"""
FastAPI application entrypoint (Phase 1: Architecture & Initial Setup).

This file wires up the app instance, CORS, and a health-check endpoint
ONLY. Feature routers (resume, job, application, agent) are intentionally
NOT included yet — they will be registered in their respective phases.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.mongodb import ping_database

settings = get_settings()
configure_logging()
logger = get_logger(__name__)

app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description="Agentic AI Job Application Platform — API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phase 2: resume upload/extraction router is live.
from app.api.v1.routes import resume  # noqa: E402

app.include_router(resume.router, prefix=settings.API_V1_PREFIX)

# NOTE: job/application/agent routers belong to Phases 3-5 and are
# intentionally NOT included yet.
#
# from app.api.v1.routes import job, application, agent
# app.include_router(job.router, prefix=settings.API_V1_PREFIX)
# app.include_router(application.router, prefix=settings.API_V1_PREFIX)
# app.include_router(agent.router, prefix=settings.API_V1_PREFIX)


@app.get("/")
async def root():
    return {"message": settings.APP_NAME, "status": "running", "phase": 2}


@app.get("/health")
async def health_check():
    db_ok = await ping_database()
    return {
        "status": "ok",
        "database_connected": db_ok,
    }
