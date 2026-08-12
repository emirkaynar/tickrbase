from __future__ import annotations

import json
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from .core.database import AsyncSessionLocal
from .core.models_db import PortfolioPosition, UserWatchlist
from .core.redis import get_redis_client
from .providers.yahoo import YahooFinanceProvider
from .services import prices as prices_service
from .services import quotes as quotes_service

logger = logging.getLogger(__name__)


async def prewarm_market_cache() -> None:
    """Pre-warm Redis cache for tickers used in active watchlists and portfolios."""
    try:
        async with AsyncSessionLocal() as db:
            # Collect unique tickers from watchlists
            res_wl = await db.execute(select(UserWatchlist.items_json))
            wl_rows = res_wl.scalars().all()
            tickers: set[str] = set()
            for items_str in wl_rows:
                if items_str:
                    try:
                        items = json.loads(items_str)
                        for item in items:
                            sym = item.get("symbol") or item.get("value")
                            if sym:
                                tickers.add(str(sym).strip().upper())
                    except Exception:
                        pass

            # Collect unique tickers from active portfolio positions
            res_pos = await db.execute(
                select(PortfolioPosition.ticker).where(PortfolioPosition.is_closed == "false")
            )
            for pos_ticker in res_pos.scalars().all():
                if pos_ticker:
                    tickers.add(str(pos_ticker).strip().upper())

        if not tickers:
            return

        redis = get_redis_client()
        provider = YahooFinanceProvider()

        # Limit batch to top 25 active tickers
        ticker_list = sorted(list(tickers))[:25]

        # Pre-warm prices & quotes non-blockingly
        await quotes_service.get_quotes(provider, redis, ticker_list, {"session", "volume", "quote"})
        for sym in ticker_list:
            try:
                await prices_service.get_price(provider, redis, sym)
            except Exception:
                pass
    except Exception as exc:
        logger.debug(f"[PREWARM ERROR] {exc}")


async def refresh_today_snapshots() -> None:
    """Daily job at 23:00 UTC to compute snapshots for active portfolios (visited in last 7 days)."""
    try:
        redis = get_redis_client()
        provider = YahooFinanceProvider()

        # Scan active portfolio keys
        keys = []
        async for key in redis.scan_iter(match="pf:active:*"):
            keys.append(key.decode("utf-8") if isinstance(key, bytes) else str(key))

        portfolio_ids = [k.replace("pf:active:", "") for k in keys][:100]  # Cap at 100
        if not portfolio_ids:
            return

        semaphore = asyncio.Semaphore(5)

        async def _snapshot_one(pid: str):
            async with semaphore:
                try:
                    async with AsyncSessionLocal() as db:
                        stmt = select(UserPortfolio).where(UserPortfolio.id == pid)
                        p_obj = (await db.execute(stmt)).scalar_one_or_none()
                        if p_obj:
                            now_sec = int(time.time())
                            from .services.snapshots import compute_and_save_snapshot
                            await compute_and_save_snapshot(
                                db, provider, redis, pid, p_obj.user_id, p_obj.base_currency, now_sec
                            )
                except Exception as exc:
                    logger.warning(f"[SCHEDULER SNAPSHOT ERROR] portfolio={pid}: {exc}")

        await asyncio.gather(*[_snapshot_one(pid) for pid in portfolio_ids])
    except Exception as exc:
        logger.debug(f"[REFRESH SNAPSHOTS ERROR] {exc}")


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        prewarm_market_cache,
        "interval",
        seconds=30,
        id="prewarm_market_cache_job",
        replace_existing=True,
    )
    scheduler.add_job(
        refresh_today_snapshots,
        "cron",
        hour=23,
        minute=0,
        id="refresh_today_snapshots_job",
        replace_existing=True,
    )
    return scheduler
