"""Watchlist-only bounded, rotating market-cache warmup."""
import json
import logging

from sqlalchemy import select

from ..core.models_db import UserWatchlist
from ..providers.yahoo import normalize_ticker

logger = logging.getLogger(__name__)
_cursor = ('', '')


def parse_symbols(raw):
    try:
        items = json.loads(raw or '[]')
        if not isinstance(items, list):
            raise ValueError('Expected list')
        symbols = set()
        for item in items:
            value = item if isinstance(item, str) else (item.get('symbol') or item.get('value')) if isinstance(item, dict) else None
            if isinstance(value, str) and 0 < len(value.strip()) <= 32:
                symbols.add(normalize_ticker(value))
        return sorted(symbols)
    except (ValueError, TypeError):
        logger.warning('watchlist_prewarm_parse_failed')
        return []


async def select_watchlist_batch(db, limit=25):
    global _cursor
    rows = (await db.execute(select(UserWatchlist.id, UserWatchlist.items_json).where(
        UserWatchlist.id >= _cursor[0]
    ).order_by(UserWatchlist.id).limit(100))).all()
    selected = []
    for row in rows:
        for symbol in parse_symbols(row.items_json):
            if (row.id, symbol) <= _cursor:
                continue
            _cursor = (row.id, symbol)
            selected.append(symbol)
            if len(selected) >= limit:
                return list(dict.fromkeys(selected))
        _cursor = (row.id, '\uffff')
    # Next run wraps after reaching the end; every page eventually gets a turn.
    if len(rows) < 100:
        _cursor = ('', '')
    return list(dict.fromkeys(selected))
