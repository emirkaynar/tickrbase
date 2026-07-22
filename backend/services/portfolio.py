from __future__ import annotations

import redis.asyncio as aioredis
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.models_db import Portfolio
from ..providers.base import DataProvider
from ..providers.yahoo import normalize_ticker
from .prices import get_price


async def list_positions(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    user_id: int,
) -> list[dict]:
    stmt = select(Portfolio.ticker, Portfolio.quantity, Portfolio.avg_price).where(
        Portfolio.user_id == user_id
    )
    result = await db.execute(stmt)
    rows = result.all()

    results: list[dict] = []
    for row in rows:
        ticker = row.ticker
        qty = float(row.quantity)
        avg = float(row.avg_price)
        try:
            price, _, _ = await get_price(provider, redis, ticker)
        except Exception:
            price = avg

        pnl = (price - avg) * qty
        pnl_pct = ((price - avg) / avg * 100.0) if avg != 0 else 0.0
        results.append(
            {
                "ticker": ticker,
                "quantity": qty,
                "avg_price": avg,
                "current_price": price,
                "pnl": pnl,
                "pnl_percent": pnl_pct,
            }
        )
    return results


async def upsert_position(
    db: AsyncSession,
    user_id: int,
    ticker: str,
    quantity: float,
    avg_price: float,
) -> None:
    normalized = normalize_ticker(ticker)
    stmt = insert(Portfolio).values(
        user_id=user_id,
        ticker=normalized,
        quantity=quantity,
        avg_price=avg_price,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_user_ticker",
        set_={
            "quantity": quantity,
            "avg_price": avg_price,
        },
    )
    await db.execute(stmt)


async def delete_position(db: AsyncSession, user_id: int, ticker: str) -> None:
    normalized = normalize_ticker(ticker)
    stmt = delete(Portfolio).where(
        Portfolio.user_id == user_id, Portfolio.ticker == normalized
    )
    await db.execute(stmt)
