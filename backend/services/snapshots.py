from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
import redis.asyncio as aioredis
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.history_cache import get_history
from ..core.models_db import (
    OHLC,
    PortfolioLedgerSnapshot,
    PortfolioTransaction,
    PortfolioValueSnapshot,
    UserPortfolio,
)
from ..providers.base import DataProvider
from ..providers.yahoo import currency_for_ticker
from ..schemas.portfolio import PortfolioHistoryPoint, PortfolioHistoryResponse
from ..services.fx import get_historical_fx_rate

logger = logging.getLogger(__name__)


@dataclass
class LedgerEntry:
    ticker: str
    quantity: float
    avg_price_native: float
    avg_price_base: float
    net_invested_native: float
    net_invested_base: float


def current_time_ms() -> int:
    return int(time.time() * 1000)


def to_utc_midnight(ts: int) -> int:
    """Normalize any unix timestamp (seconds or ms) to UTC midnight epoch seconds."""
    sec = ts if ts < 1e11 else int(ts / 1000)
    dt = datetime.fromtimestamp(sec, tz=timezone.utc)
    midnight = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
    return int(midnight.timestamp())


def _replay_ledger(
    txs: list[PortfolioTransaction],
    as_of_ts: int,
) -> dict[str, LedgerEntry]:
    """
    Pure function — replays transaction history up to and including as_of_ts (seconds).
    Returns active holdings as of that date with WAC in native & base currency.
    """
    txs_by_ticker: dict[str, list[PortfolioTransaction]] = {}
    for tx in txs:
        tx_sec = tx.executed_at if tx.executed_at < 1e11 else int(tx.executed_at / 1000)
        if tx_sec <= as_of_ts + 86399:  # end of day tolerance
            txs_by_ticker.setdefault(tx.ticker, []).append(tx)

    holdings: dict[str, LedgerEntry] = {}

    for ticker, t_list in txs_by_ticker.items():
        # Sort by executed_at asc
        t_list.sort(key=lambda x: (x.executed_at, x.created_at))

        qty = 0.0
        total_cost_native = 0.0
        total_cost_base = 0.0
        avg_native = 0.0
        avg_base = 0.0

        for tx in t_list:
            if tx.type == "BUY":
                cost_nat = (tx.quantity * tx.unit_price) + tx.fee
                fx_exec = tx.fx_rate_to_base if tx.fx_rate_to_base and tx.fx_rate_to_base > 0 else 1.0
                cost_b = cost_nat * fx_exec

                total_cost_native += cost_nat
                total_cost_base += cost_b
                qty += tx.quantity
                avg_native = total_cost_native / qty if qty > 0 else 0.0
                avg_base = total_cost_base / qty if qty > 0 else 0.0

            elif tx.type == "SELL":
                if qty > 0:
                    sold_qty = min(tx.quantity, qty)
                    qty = max(0.0, qty - sold_qty)
                    total_cost_native = qty * avg_native
                    total_cost_base = qty * avg_base
                    if qty == 0:
                        avg_native = 0.0
                        avg_base = 0.0
                        total_cost_native = 0.0
                        total_cost_base = 0.0

        if qty > 1e-6:
            holdings[ticker] = LedgerEntry(
                ticker=ticker,
                quantity=qty,
                avg_price_native=avg_native,
                avg_price_base=avg_base,
                net_invested_native=total_cost_native,
                net_invested_base=total_cost_base,
            )

    return holdings


async def candle_interval_for_ticker(db: AsyncSession, ticker: str) -> str:
    """Check OHLC coverage for ticker in DB; default '1d', fallback to '1wk' or '1mo'."""
    stmt = select(OHLC.interval).where(OHLC.ticker == ticker).limit(1)
    res = await db.execute(stmt)
    interval = res.scalar_one_or_none()
    return interval or "1d"


async def compute_and_save_snapshot(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    portfolio_id: str,
    user_id: int,
    base_currency: str,
    snap_date_ts: int,
) -> PortfolioValueSnapshot | None:
    """
    Computes ledger state & value snapshot for a single UTC midnight date.
    Upserts both portfolio_ledger_snapshots and portfolio_value_snapshots.
    """
    snap_date_ts = to_utc_midnight(snap_date_ts)

    # 1. Fetch all transactions for this portfolio
    tx_stmt = select(PortfolioTransaction).where(
        PortfolioTransaction.user_id == user_id,
        PortfolioTransaction.portfolio_id == portfolio_id,
    ).order_by(PortfolioTransaction.executed_at.asc(), PortfolioTransaction.created_at.asc())

    tx_res = await db.execute(tx_stmt)
    all_txs = tx_res.scalars().all()

    if not all_txs:
        return None

    # 2. Replay ledger as of snap_date_ts
    holdings = _replay_ledger(all_txs, snap_date_ts)
    if not holdings:
        return None

    now_sec = int(time.time())

    # 3. Process each holding's historical price and FX
    market_val_base_total = 0.0
    net_invested_base_total = 0.0
    fx_effect_base_total = 0.0

    ledger_values = []

    for ticker, h in holdings.items():
        native_currency = currency_for_ticker(ticker)

        # Get FX rate on snapshot date
        fx_rate_snap = await get_historical_fx_rate(
            db, provider, redis, native_currency, base_currency, snap_date_ts
        )

        # Get close price on snapshot date (fallback: 1d -> 1wk -> 1mo)
        close_price = None
        for interval in ["1d", "1wk", "1mo"]:
            try:
                candles, _, _ = await get_history(db, provider, ticker, interval, "max")
                if candles:
                    # Find candle on or immediately before snap_date_ts
                    matching = [c for c in candles if c.time <= snap_date_ts + 86400]
                    if matching:
                        close_price = float(matching[-1].close)
                        break
            except Exception:
                pass

        if close_price is None or close_price <= 0:
            close_price = h.avg_price_native  # Fallback to cost if price unavailable

        mkt_val_base = close_price * h.quantity * fx_rate_snap
        market_val_base_total += mkt_val_base
        net_invested_base_total += h.net_invested_base

        # FX effect: (current FX - buy FX) * native asset value
        fx_diff = fx_rate_snap - (h.avg_price_base / h.avg_price_native if h.avg_price_native > 0 else fx_rate_snap)
        fx_effect_base_total += (close_price * h.quantity) * fx_diff

        ledger_values.append({
            "portfolio_id": portfolio_id,
            "user_id": user_id,
            "snap_date": snap_date_ts,
            "ticker": ticker,
            "quantity": h.quantity,
            "avg_price_native": h.avg_price_native,
            "avg_price_base": h.avg_price_base,
            "net_invested_native": h.net_invested_native,
            "net_invested_base": h.net_invested_base,
            "fx_rate_snap": fx_rate_snap,
        })

    # Bulk upsert ledger snapshots
    if ledger_values:
        stmt_l = insert(PortfolioLedgerSnapshot).values(ledger_values)
        stmt_l = stmt_l.on_conflict_do_update(
            index_elements=["portfolio_id", "snap_date", "ticker"],
            set_={
                "quantity": stmt_l.excluded.quantity,
                "avg_price_native": stmt_l.excluded.avg_price_native,
                "avg_price_base": stmt_l.excluded.avg_price_base,
                "net_invested_native": stmt_l.excluded.net_invested_native,
                "net_invested_base": stmt_l.excluded.net_invested_base,
                "fx_rate_snap": stmt_l.excluded.fx_rate_snap,
            },
        )
        await db.execute(stmt_l)

    pnl_base = market_val_base_total - net_invested_base_total
    pnl_pct = (pnl_base / net_invested_base_total * 100.0) if net_invested_base_total > 0 else 0.0

    # Upsert value snapshot
    val_row = {
        "portfolio_id": portfolio_id,
        "user_id": user_id,
        "snap_date": snap_date_ts,
        "market_value_base": round(market_val_base_total, 4),
        "net_invested_base": round(net_invested_base_total, 4),
        "pnl_base": round(pnl_base, 4),
        "pnl_pct": round(pnl_pct, 4),
        "fx_effect_base": round(fx_effect_base_total, 4),
        "last_updated": now_sec,
    }

    stmt_v = insert(PortfolioValueSnapshot).values(val_row)
    stmt_v = stmt_v.on_conflict_do_update(
        index_elements=["portfolio_id", "snap_date"],
        set_={
            "market_value_base": stmt_v.excluded.market_value_base,
            "net_invested_base": stmt_v.excluded.net_invested_base,
            "pnl_base": stmt_v.excluded.pnl_base,
            "pnl_pct": stmt_v.excluded.pnl_pct,
            "fx_effect_base": stmt_v.excluded.fx_effect_base,
            "last_updated": stmt_v.excluded.last_updated,
        },
    )
    await db.execute(stmt_v)
    await db.commit()

    return PortfolioValueSnapshot(**val_row)


_ACTIVE_BACKFILLS: set[str] = set()


async def _run_background_backfill(
    provider: DataProvider,
    redis: aioredis.Redis,
    portfolio_id: str,
    user_id: int,
    base_currency: str,
    start_ts: int,
    end_ts: int,
) -> None:
    if portfolio_id in _ACTIVE_BACKFILLS:
        return

    _ACTIVE_BACKFILLS.add(portfolio_id)
    try:
        from ..core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            await backfill_portfolio_snapshots(
                db, provider, redis, portfolio_id, user_id, base_currency, start_ts, end_ts
            )
    except Exception as exc:
        logger.warning(
            "[BACKGROUND BACKFILL ERROR] portfolio=%r: %r",
            portfolio_id,
            exc,
        )
    finally:
        _ACTIVE_BACKFILLS.discard(portfolio_id)


async def backfill_portfolio_snapshots(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    portfolio_id: str,
    user_id: int,
    base_currency: str,
    start_ts: int,
    end_ts: int,
) -> None:
    """Bulk pre-fetches OHLC and FX rates, replays ledger in-memory, and bulk upserts snapshots."""
    start_midnight = to_utc_midnight(start_ts)
    end_midnight = to_utc_midnight(end_ts)

    # 1. Fetch all transactions for this portfolio
    tx_stmt = select(PortfolioTransaction).where(
        PortfolioTransaction.user_id == user_id,
        PortfolioTransaction.portfolio_id == portfolio_id,
    ).order_by(PortfolioTransaction.executed_at.asc(), PortfolioTransaction.created_at.asc())

    tx_res = await db.execute(tx_stmt)
    all_txs = tx_res.scalars().all()
    if not all_txs:
        return

    # Collect all unique tickers
    unique_tickers = list({tx.ticker for tx in all_txs})

    # 2. Pre-fetch OHLC maps for each ticker (1d, fallback to 1wk if empty)
    ohlc_maps: dict[str, dict[int, float]] = {}
    for ticker in unique_tickers:
        candle_dict: dict[int, float] = {}
        try:
            candles, _, _ = await get_history(db, provider, ticker, "1d", "max")
            if candles:
                for c in candles:
                    candle_dict[to_utc_midnight(c.time)] = c.close
            else:
                candles_wk, _, _ = await get_history(db, provider, ticker, "1wk", "max")
                if candles_wk:
                    for c in candles_wk:
                        candle_dict[to_utc_midnight(c.time)] = c.close
        except Exception as exc:
            logger.debug(f"[OHLC FETCH ERROR] ticker={ticker}: {exc}")
        ohlc_maps[ticker] = candle_dict

    # 3. Pre-fetch FX rate cache per native currency
    fx_rates_cache: dict[str, float] = {}
    for ticker in unique_tickers:
        cur = currency_for_ticker(ticker)
        if cur not in fx_rates_cache:
            try:
                rate = await get_historical_fx_rate(db, provider, redis, cur, base_currency, int(time.time()))
                fx_rates_cache[cur] = rate
            except Exception:
                fx_rates_cache[cur] = 1.0

    current = start_midnight
    one_day = 86400
    now_sec = int(time.time())

    all_ledger_rows = []
    all_value_rows = {}

    while current <= end_midnight:
        dt = datetime.fromtimestamp(current, tz=timezone.utc)
        # Skip Saturday (5) and Sunday (6)
        if dt.weekday() < 5:
            holdings = _replay_ledger(all_txs, current)
            if holdings:
                mkt_val_base_total = 0.0
                net_invested_base_total = 0.0
                fx_effect_base_total = 0.0

                for ticker, h in holdings.items():
                    native_cur = currency_for_ticker(ticker)
                    fx_rate_snap = fx_rates_cache.get(native_cur, 1.0)

                    ticker_candles = ohlc_maps.get(ticker, {})
                    close_price = ticker_candles.get(current)
                    if close_price is None:
                        preceding = [t for t in ticker_candles.keys() if t <= current]
                        if preceding:
                            close_price = ticker_candles[max(preceding)]
                        else:
                            close_price = h.avg_price_native

                    mkt_val_base = close_price * h.quantity * fx_rate_snap
                    mkt_val_base_total += mkt_val_base
                    net_invested_base_total += h.net_invested_base

                    fx_diff = fx_rate_snap - (h.avg_price_base / h.avg_price_native if h.avg_price_native > 0 else fx_rate_snap)
                    fx_effect_base_total += (close_price * h.quantity) * fx_diff

                    all_ledger_rows.append({
                        "portfolio_id": portfolio_id,
                        "user_id": user_id,
                        "snap_date": current,
                        "ticker": ticker,
                        "quantity": h.quantity,
                        "avg_price_native": h.avg_price_native,
                        "avg_price_base": h.avg_price_base,
                        "net_invested_native": h.net_invested_native,
                        "net_invested_base": h.net_invested_base,
                        "fx_rate_snap": fx_rate_snap,
                    })

                pnl_base = mkt_val_base_total - net_invested_base_total
                pnl_pct = (pnl_base / net_invested_base_total * 100.0) if net_invested_base_total > 0 else 0.0

                all_value_rows[current] = {
                    "portfolio_id": portfolio_id,
                    "user_id": user_id,
                    "snap_date": current,
                    "market_value_base": round(mkt_val_base_total, 4),
                    "net_invested_base": round(net_invested_base_total, 4),
                    "pnl_base": round(pnl_base, 4),
                    "pnl_pct": round(pnl_pct, 4),
                    "fx_effect_base": round(fx_effect_base_total, 4),
                    "last_updated": now_sec,
                }
        current += one_day

    # 4. Bulk upsert ledger snapshots
    if all_ledger_rows:
        stmt_l = insert(PortfolioLedgerSnapshot).values(all_ledger_rows)
        stmt_l = stmt_l.on_conflict_do_update(
            index_elements=["portfolio_id", "snap_date", "ticker"],
            set_={
                "quantity": stmt_l.excluded.quantity,
                "avg_price_native": stmt_l.excluded.avg_price_native,
                "avg_price_base": stmt_l.excluded.avg_price_base,
                "net_invested_native": stmt_l.excluded.net_invested_native,
                "net_invested_base": stmt_l.excluded.net_invested_base,
                "fx_rate_snap": stmt_l.excluded.fx_rate_snap,
            },
        )
        await db.execute(stmt_l)

    # 5. Bulk upsert value snapshots
    val_list = list(all_value_rows.values())
    if val_list:
        stmt_v = insert(PortfolioValueSnapshot).values(val_list)
        stmt_v = stmt_v.on_conflict_do_update(
            index_elements=["portfolio_id", "snap_date"],
            set_={
                "market_value_base": stmt_v.excluded.market_value_base,
                "net_invested_base": stmt_v.excluded.net_invested_base,
                "pnl_base": stmt_v.excluded.pnl_base,
                "pnl_pct": stmt_v.excluded.pnl_pct,
                "fx_effect_base": stmt_v.excluded.fx_effect_base,
                "last_updated": stmt_v.excluded.last_updated,
            },
        )
        await db.execute(stmt_v)

    await db.commit()


async def invalidate_from_date(
    db: AsyncSession,
    portfolio_id: str,
    from_ts: int,
) -> None:
    """Invalidate ledger & value snapshots from a given timestamp onwards."""
    from_midnight = to_utc_midnight(from_ts)

    await db.execute(
        delete(PortfolioLedgerSnapshot).where(
            PortfolioLedgerSnapshot.portfolio_id == portfolio_id,
            PortfolioLedgerSnapshot.snap_date >= from_midnight,
        )
    )
    await db.execute(
        delete(PortfolioValueSnapshot).where(
            PortfolioValueSnapshot.portfolio_id == portfolio_id,
            PortfolioValueSnapshot.snap_date >= from_midnight,
        )
    )
    await db.commit()


async def get_portfolio_history_data(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    user_id: int,
    portfolio_id: str,
    interval: str = "1d",
    benchmark: str | None = "^GSPC",
    base_currency: str | None = None,
) -> PortfolioHistoryResponse:
    """Main query handler for portfolio history & benchmark calculation."""
    stmt_p = select(UserPortfolio).where(UserPortfolio.id == portfolio_id)
    p_obj = (await db.execute(stmt_p)).scalar_one_or_none()
    base_currency = p_obj.base_currency if p_obj else "TRY"

    # Find earliest transaction date
    tx_stmt = select(PortfolioTransaction.executed_at).where(
        PortfolioTransaction.user_id == user_id,
        PortfolioTransaction.portfolio_id == portfolio_id,
    ).order_by(PortfolioTransaction.executed_at.asc()).limit(1)

    first_tx_res = await db.execute(tx_stmt)
    first_tx_ts = first_tx_res.scalar_one_or_none()

    now_sec = int(time.time())
    if first_tx_ts is None:
        return PortfolioHistoryResponse(
            portfolio_id=portfolio_id,
            timeframe="all",
            benchmark=benchmark,
            points=[],
        )

    start_ts = to_utc_midnight(first_tx_ts)
    end_ts = to_utc_midnight(now_sec)

    # Fetch existing snapshots
    stmt_snaps = select(PortfolioValueSnapshot).where(
        PortfolioValueSnapshot.portfolio_id == portfolio_id,
        PortfolioValueSnapshot.snap_date >= start_ts,
    ).order_by(PortfolioValueSnapshot.snap_date.asc())

    snap_rows = (await db.execute(stmt_snaps)).scalars().all()

    # Calculate expected trading days count approx
    days_span = max(1, int((end_ts - start_ts) / 86400))
    expected_trading_days = int(days_span * 5 / 7)

    # Trigger non-blocking background backfill if sparse or missing (< 50% coverage)
    if len(snap_rows) < max(1, int(expected_trading_days * 0.5)):
        asyncio.create_task(
            _run_background_backfill(
                provider, redis, portfolio_id, user_id, base_currency, start_ts, end_ts
            )
        )

    if not snap_rows:
        return PortfolioHistoryResponse(
            portfolio_id=portfolio_id,
            timeframe="all",
            benchmark=benchmark,
            points=[],
        )

    # Fetch benchmark OHLC candles if benchmark specified
    bench_map: dict[int, float] = {}
    if benchmark and benchmark.lower() != "none":
        try:
            candles, _, _ = await get_history(db, provider, benchmark, "1d", "max")
            if candles:
                for c in candles:
                    bench_map[to_utc_midnight(c.time)] = c.close
        except Exception:
            pass

    bench_start_price = None
    if bench_map:
        # Find nearest benchmark price at or before start_ts
        first_snap_date = snap_rows[0].snap_date
        matching_bench_times = [t for t in bench_map.keys() if t <= first_snap_date]
        if matching_bench_times:
            bench_start_price = bench_map[max(matching_bench_times)]

    points: list[PortfolioHistoryPoint] = []
    prev_val = 0.0

    for i, s in enumerate(snap_rows):
        # Calculate benchmark % relative to start
        bench_pct = None
        if bench_start_price and bench_start_price > 0:
            current_bench = bench_map.get(s.snap_date)
            if current_bench:
                bench_pct = round(((current_bench - bench_start_price) / bench_start_price) * 100.0, 2)

        # Delta % calculation for bars
        pnl_delta_pct = None
        if i > 0 and prev_val > 0:
            pnl_delta_pct = round(((s.market_value_base - prev_val) / prev_val) * 100.0, 2)
        elif i == 0:
            pnl_delta_pct = 0.0
        prev_val = s.market_value_base

        points.append(
            PortfolioHistoryPoint(
                time=s.snap_date,
                market_value_base=round(s.market_value_base, 2),
                net_invested_base=round(s.net_invested_base, 2),
                pnl_base=round(s.pnl_base, 2),
                pnl_pct=round(s.pnl_pct, 2),
                pnl_delta_pct=pnl_delta_pct,
                fx_effect_base=round(s.fx_effect_base, 2),
                benchmark_percent=bench_pct,
            )
        )

    return PortfolioHistoryResponse(
        portfolio_id=portfolio_id,
        timeframe="all",
        benchmark=benchmark,
        points=points,
    )
