from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    # Ready for future scheduled background tasks (e.g. market data pre-warming)
    return scheduler
