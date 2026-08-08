"""
MongoDB connection setup (Phase 1 scaffolding).

Establishes the async Motor client and exposes a database handle for
future phases to build repositories/CRUD logic on top of. This file
intentionally contains NO collection access, queries, or CRUD operations.
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

settings = get_settings()

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGODB_URI)
    return _client


def get_database() -> AsyncIOMotorDatabase:
    return get_client()[settings.MONGODB_DB_NAME]


async def ping_database() -> bool:
    """Simple connectivity check used only for Phase 1 health verification."""
    try:
        await get_client().admin.command("ping")
        return True
    except Exception:
        return False
