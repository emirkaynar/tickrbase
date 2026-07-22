from __future__ import annotations

import json
import time
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import (
    LOOKUP_MAX_RESULTS,
    LOOKUP_MIN_QUERY_LENGTH,
    LOOKUP_TTL_SECONDS,
)
from ..core.models_db import LookupCache
from ..providers.base import DataProvider


async def search_lookup(
    db: AsyncSession,
    provider: DataProvider,
    query: str,
) -> tuple[str, list[dict], bool, int]:
    cleaned = query.strip()
    if len(cleaned) < LOOKUP_MIN_QUERY_LENGTH:
        raise ValueError(
            f"Query must be at least {LOOKUP_MIN_QUERY_LENGTH} characters"
        )

    now = int(time.time())
    result = await db.execute(
        select(LookupCache).where(LookupCache.query == cleaned.lower())
    )
    row = result.scalar_one_or_none()

    if row is not None:
        try:
            items = json.loads(row.payload)
            fetched_at = int(row.fetched_at)
            stale = (now - fetched_at) > LOOKUP_TTL_SECONDS
            if not stale:
                return cleaned, items, False, fetched_at
        except (json.JSONDecodeError, ValueError):
            pass

    try:
        items = provider.lookup(cleaned, count=LOOKUP_MAX_RESULTS)
    except Exception:
        if row is not None:
            return cleaned, json.loads(row.payload), True, int(row.fetched_at)
        raise

    stmt = insert(LookupCache).values(
        query=cleaned.lower(), payload=json.dumps(items), fetched_at=now
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["query"],
        set_={"payload": json.dumps(items), "fetched_at": now},
    )
    await db.execute(stmt)

    return cleaned, items, False, now
