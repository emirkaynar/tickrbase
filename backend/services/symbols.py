from __future__ import annotations

import json
import time
import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import (
    FALLBACK_SYMBOLS,
    SYMBOLS_TTL_SECONDS,
    TRADINGVIEW_SCANNER_URL,
)
from ..core.models_db import SymbolsCache


async def _fetch_from_tradingview() -> list[dict]:
    payload = {
        "filter": [{"left": "type", "operation": "in_range", "right": ["stock", "dr", "fund"]}],
        "options": {"active_symbols_only": True},
        "symbols": {"query": {"types": []}, "tickers": []},
        "markets": ["turkey"],
        "sort": {"sortBy": "name", "sortOrder": "asc"},
        "range": [0, 1000],
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(TRADINGVIEW_SCANNER_URL, json=payload)
        if res.status_code != 200:
            return FALLBACK_SYMBOLS
        data = res.json()
        items: list[dict] = []
        for row in data.get("data", []):
            symbol = row.get("s", "")
            if ":" in symbol:
                symbol = symbol.split(":")[-1]
            if symbol:
                items.append({"label": symbol, "value": f"{symbol}.IS"})
        return items or FALLBACK_SYMBOLS


async def get_symbol_items(db: AsyncSession) -> tuple[list[dict], bool, int]:
    now = int(time.time())
    result = await db.execute(select(SymbolsCache).where(SymbolsCache.id == "bist"))
    row = result.scalar_one_or_none()

    if row is not None:
        try:
            items = json.loads(row.payload)
            fetched_at = int(row.fetched_at)
            stale = (now - fetched_at) > SYMBOLS_TTL_SECONDS
            if not stale:
                return items, False, fetched_at
        except (json.JSONDecodeError, ValueError):
            pass

    try:
        items = await _fetch_from_tradingview()
    except Exception:
        if row is not None:
            return json.loads(row.payload), True, int(row.fetched_at)
        items = FALLBACK_SYMBOLS

    stmt = insert(SymbolsCache).values(id="bist", payload=json.dumps(items), fetched_at=now)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={"payload": json.dumps(items), "fetched_at": now},
    )
    await db.execute(stmt)

    return items, False, now
