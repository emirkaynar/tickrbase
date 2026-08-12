from __future__ import annotations

import asyncio
import json
import math
import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
import redis.asyncio as aioredis
from sqlalchemy import delete, select, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.models_db import (
    UserPortfolio,
    PortfolioPosition,
    PortfolioTransaction,
    UserPortfolioGoal,
)
from ..providers.base import DataProvider
from ..providers.yahoo import normalize_ticker, currency_for_ticker
from ..services.prices import get_price
from ..services.fx import get_fx_rate, get_fx_rates_timestamp
from ..core.history_cache import get_history
from .snapshots import get_portfolio_history_data, invalidate_from_date
from ..schemas.portfolio import (
    PortfolioSummary,
    PortfolioCreatePayload,
    PositionResponse,
    PositionQuickUpsertPayload,
    TransactionCreatePayload,
    TransactionResponse,
    PortfolioKPIs,
    PortfolioOverviewResponse,
    PortfolioHistoryPoint,
    PortfolioHistoryResponse,
)


def current_time_ms() -> int:
    return int(time.time() * 1000)


def to_utc_midnight(ts: int) -> int:
    """Normalize any unix timestamp to UTC midnight of its calendar date."""
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return int(datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc).timestamp())


# --- Portfolio Management ---
async def list_user_portfolios(db: AsyncSession, user_id: int) -> list[PortfolioSummary]:
    stmt = (
        select(UserPortfolio)
        .where(UserPortfolio.user_id == user_id)
        .order_by(UserPortfolio.created_at.asc())
    )
    res = await db.execute(stmt)
    portfolios = res.scalars().all()

    if not portfolios:
        # Auto-create default portfolio
        default_p = await create_user_portfolio(
            db, user_id, name="Main Portfolio", base_currency="TRY", is_default=True
        )
        return [default_p]

    return [
        PortfolioSummary(
            id=p.id,
            name=p.name,
            base_currency=p.base_currency,
            is_default=p.is_default == "true",
            created_at=p.created_at,
        )
        for p in portfolios
    ]


async def create_user_portfolio(
    db: AsyncSession,
    user_id: int,
    name: str,
    base_currency: str = "TRY",
    is_default: bool = False,
) -> PortfolioSummary:
    now = current_time_ms()
    p_id = f"port_{uuid.uuid4().hex[:12]}"

    if is_default:
        # Reset existing default portfolios for user
        stmt_reset = (
            select(UserPortfolio)
            .where(UserPortfolio.user_id == user_id, UserPortfolio.is_default == "true")
        )
        existing_defaults = (await db.execute(stmt_reset)).scalars().all()
        for p in existing_defaults:
            p.is_default = "false"

    new_p = UserPortfolio(
        id=p_id,
        user_id=user_id,
        name=name,
        base_currency=base_currency,
        is_default="true" if is_default else "false",
        created_at=now,
    )
    db.add(new_p)
    await db.commit()
    await db.refresh(new_p)

    return PortfolioSummary(
        id=new_p.id,
        name=new_p.name,
        base_currency=new_p.base_currency,
        is_default=new_p.is_default == "true",
        created_at=new_p.created_at,
    )


async def get_or_create_default_portfolio(db: AsyncSession, user_id: int) -> UserPortfolio:
    stmt = (
        select(UserPortfolio)
        .where(UserPortfolio.user_id == user_id, UserPortfolio.is_default == "true")
    )
    res = await db.execute(stmt)
    p = res.scalar_one_or_none()

    if p:
        return p

    # Fallback to first existing or create one
    stmt_any = (
        select(UserPortfolio)
        .where(UserPortfolio.user_id == user_id)
        .order_by(UserPortfolio.created_at.asc())
    )
    p = (await db.execute(stmt_any)).scalars().first()
    if p:
        return p

    # Create new default portfolio
    now = current_time_ms()
    p_id = f"port_{uuid.uuid4().hex[:12]}"
    new_p = UserPortfolio(
        id=p_id,
        user_id=user_id,
        name="Main Portfolio",
        base_currency="TRY",
        is_default="true",
        created_at=now,
    )
    db.add(new_p)
    await db.commit()
    await db.refresh(new_p)
    return new_p


# --- Positions Service ---
async def list_positions_for_portfolio(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    user_id: int,
    portfolio_id: str | None = None,
    base_currency: str | None = None,
) -> list[PositionResponse]:
    if not portfolio_id or portfolio_id == "all":
        p_def = await get_or_create_default_portfolio(db, user_id)
        portfolio_id = p_def.id

    stmt_p = select(UserPortfolio).where(UserPortfolio.id == portfolio_id)
    p_obj = (await db.execute(stmt_p)).scalar_one_or_none()
    base_currency = p_obj.base_currency if p_obj else "TRY"

    await recalculate_positions_for_portfolio(db, user_id, portfolio_id, provider=provider)
    stmt = select(PortfolioPosition).where(
        PortfolioPosition.user_id == user_id,
        PortfolioPosition.portfolio_id == portfolio_id,
        PortfolioPosition.is_closed == "false",
    )

    res = await db.execute(stmt)
    rows = res.scalars().all()

    # Batch fetch FX rates for all unique native currencies in parallel
    unique_currencies = list({currency_for_ticker(row.ticker) for row in rows})
    fetched_rates = await asyncio.gather(
        *[get_fx_rate(redis, provider, cur, base_currency) for cur in unique_currencies]
    )
    fx_rate_map: dict[str, float] = dict(zip(unique_currencies, fetched_rates))

    raw_positions = []
    total_market_val_base = 0.0

    for row in rows:
        ticker = row.ticker
        qty = float(row.quantity)
        avg = float(row.avg_price)
        native_currency = currency_for_ticker(ticker)

        try:
            price, _, _ = await get_price(provider, redis, ticker)
        except Exception:
            price = avg

        fx_rate = fx_rate_map.get(native_currency, 1.0)
        market_val_base = price * qty * fx_rate

        # Replay transactions for historical base cost basis
        tx_stmt = select(PortfolioTransaction).where(
            PortfolioTransaction.user_id == user_id,
            PortfolioTransaction.portfolio_id == row.portfolio_id,
            PortfolioTransaction.ticker == ticker,
        ).order_by(PortfolioTransaction.executed_at.asc(), PortfolioTransaction.created_at.asc())
        tx_res = await db.execute(tx_stmt)
        txs = tx_res.scalars().all()

        running_qty = 0.0
        running_cost_native = 0.0
        running_cost_base = 0.0
        avg_native = 0.0
        avg_base = 0.0

        if txs:
            for tx in txs:
                if tx.type == "BUY":
                    cost_nat = (tx.quantity * tx.unit_price) + tx.fee
                    fx_exec = tx.fx_rate_to_base if tx.fx_rate_to_base and tx.fx_rate_to_base > 0 else 1.0
                    cost_b = cost_nat * fx_exec
                    running_cost_native += cost_nat
                    running_cost_base += cost_b
                    running_qty += tx.quantity
                    avg_native = running_cost_native / running_qty if running_qty > 0 else 0.0
                    avg_base = running_cost_base / running_qty if running_qty > 0 else 0.0
                elif tx.type == "SELL":
                    if running_qty > 0:
                        sold_qty = min(tx.quantity, running_qty)
                        running_qty = max(0.0, running_qty - sold_qty)
                        running_cost_native = running_qty * avg_native
                        running_cost_base = running_qty * avg_base
                        if running_qty == 0:
                            avg_native = 0.0
                            avg_base = 0.0
                            running_cost_native = 0.0
                            running_cost_base = 0.0

        total_cost_base = running_cost_base if running_qty > 0 else (avg * qty * fx_rate)
        total_cost_native = running_cost_native if running_cost_native > 0 else (avg * qty)
        avg_price_base = (total_cost_base / qty) if qty > 0 else (avg * fx_rate)

        pnl_base = market_val_base - total_cost_base
        pnl_pct_base = (pnl_base / total_cost_base * 100.0) if total_cost_base > 0 else 0.0

        total_market_val_base += market_val_base
        raw_positions.append((row, price, market_val_base, total_cost_base, pnl_base, pnl_pct_base, native_currency, fx_rate, avg_price_base, total_cost_native))

    fx_ts = get_fx_rates_timestamp()
    positions: list[PositionResponse] = []
    for row, price, market_val_base, total_cost_base, pnl_base, pnl_pct_base, native_currency, fx_rate, avg_price_base, total_cost_native in raw_positions:
        weight_pct = (market_val_base / total_market_val_base * 100.0) if total_market_val_base > 0 else 0.0
        try:
            tags = json.loads(row.tags_json or "[]")
        except Exception:
            tags = []

        qty = float(row.quantity)
        avg = float(row.avg_price)
        mkt_val_native = price * qty
        cost_nat = total_cost_native if total_cost_native > 0 else (avg * qty)
        avg_nat = (cost_nat / qty) if qty > 0 else avg
        pnl_native = mkt_val_native - cost_nat
        pnl_pct_native = ((price - avg_nat) / avg_nat * 100.0) if avg_nat > 0 else 0.0

        positions.append(
            PositionResponse(
                id=row.id,
                portfolio_id=row.portfolio_id,
                ticker=row.ticker,
                asset_class=row.asset_class,
                sector=row.sector,
                quantity=row.quantity,
                avg_price=round(avg_price_base, 4),
                current_price=round(price * fx_rate, 4),
                market_value=round(market_val_base, 4),
                total_cost=round(total_cost_base, 4),
                pnl=round(pnl_base, 4),
                pnl_percent=round(pnl_pct_base, 4),
                weight_percent=round(weight_pct, 2),
                target_weight_pct=row.target_weight_pct,
                tags=tags,
                is_closed=row.is_closed == "true",
                created_at=row.created_at,
                updated_at=row.updated_at,
                currency=native_currency,
                fx_rate_to_base=fx_rate,
                avg_price_native=round(avg_nat, 4),
                current_price_native=round(price, 4),
                market_value_native=round(mkt_val_native, 4),
                pnl_native=round(pnl_native, 4),
                pnl_percent_native=round(pnl_pct_native, 4),
            )
        )

    return positions


async def upsert_position_quick(
    db: AsyncSession,
    user_id: int,
    payload: PositionQuickUpsertPayload,
) -> PositionResponse:
    now = current_time_ms()
    normalized = normalize_ticker(payload.ticker)
    tags_str = json.dumps(payload.tags)

    stmt = select(PortfolioPosition).where(
        PortfolioPosition.user_id == user_id,
        PortfolioPosition.portfolio_id == payload.portfolio_id,
        PortfolioPosition.ticker == normalized,
    )
    res = await db.execute(stmt)
    pos = res.scalar_one_or_none()

    if pos:
        pos.quantity = payload.quantity
        pos.avg_price = payload.avg_price
        pos.asset_class = payload.asset_class
        pos.sector = payload.sector
        pos.target_weight_pct = payload.target_weight_pct
        pos.tags_json = tags_str
        pos.is_closed = "true" if payload.quantity == 0 else "false"
        pos.updated_at = now
    else:
        pos_id = f"pos_{uuid.uuid4().hex[:12]}"
        pos = PortfolioPosition(
            id=pos_id,
            portfolio_id=payload.portfolio_id,
            user_id=user_id,
            ticker=normalized,
            asset_class=payload.asset_class,
            sector=payload.sector,
            quantity=payload.quantity,
            avg_price=payload.avg_price,
            target_weight_pct=payload.target_weight_pct,
            tags_json=tags_str,
            is_closed="false",
            created_at=now,
            updated_at=now,
        )
        db.add(pos)

    await db.commit()
    await db.refresh(pos)

    total_cost = pos.quantity * pos.avg_price
    return PositionResponse(
        id=pos.id,
        portfolio_id=pos.portfolio_id,
        ticker=pos.ticker,
        asset_class=pos.asset_class,
        sector=pos.sector,
        quantity=pos.quantity,
        avg_price=pos.avg_price,
        current_price=pos.avg_price,
        market_value=total_cost,
        total_cost=total_cost,
        pnl=0.0,
        pnl_percent=0.0,
        weight_percent=0.0,
        target_weight_pct=pos.target_weight_pct,
        tags=payload.tags,
        is_closed=pos.is_closed == "true",
        created_at=pos.created_at,
        updated_at=pos.updated_at,
    )


async def delete_position(db: AsyncSession, user_id: int, position_id: str) -> None:
    stmt = delete(PortfolioPosition).where(
        PortfolioPosition.user_id == user_id,
        PortfolioPosition.id == position_id,
    )
    await db.execute(stmt)
    await db.commit()


ASSET_CLASS_MAP = {
    "EQUITY": "Equity",
    "COMMONSTOCK": "Equity",
    "ETF": "ETF",
    "CRYPTOCURRENCY": "Crypto",
    "CRYPTO": "Crypto",
    "CURRENCY": "Forex",
    "MONEYMARKET": "Forex",
    "MUTUALFUND": "Mutual Fund",
    "FUTURE": "Commodity",
    "COMMODITY": "Commodity",
    "INDEX": "Index",
}


def resolve_asset_class(provider: DataProvider | None, ticker: str) -> str:
    norm = normalize_ticker(ticker)
    if provider:
        try:
            info = provider.get_company_info(norm)
            q_type = str(info.get("quoteType") or "").upper()
            if q_type in ASSET_CLASS_MAP:
                return ASSET_CLASS_MAP[q_type]
        except Exception:
            pass

    if "-USD" in norm or "-EUR" in norm:
        return "Crypto"
    if norm.endswith("=X"):
        return "Forex"
    if norm.endswith("=F"):
        return "Commodity"
    if norm.startswith("^"):
        return "Index"

    return "Equity"


# --- Position Recalculation Service ---
async def recalculate_positions_for_portfolio(
    db: AsyncSession,
    user_id: int,
    portfolio_id: str,
    ticker: str | None = None,
    provider: DataProvider | None = None,
) -> None:
    """
    Chronologically recalculate position holdings (quantity, avg_price) and
    transaction-level realized_pnl from portfolio_transactions source of truth.
    """
    stmt = select(PortfolioTransaction).where(
        PortfolioTransaction.user_id == user_id,
        PortfolioTransaction.portfolio_id == portfolio_id,
    )
    if ticker:
        stmt = stmt.where(PortfolioTransaction.ticker == ticker)

    stmt = stmt.order_by(PortfolioTransaction.executed_at.asc(), PortfolioTransaction.created_at.asc())
    res = await db.execute(stmt)
    txs = res.scalars().all()

    txs_by_ticker: dict[str, list[PortfolioTransaction]] = {}
    for tx in txs:
        txs_by_ticker.setdefault(tx.ticker, []).append(tx)

    if ticker and ticker not in txs_by_ticker:
        txs_by_ticker[ticker] = []

    stmt_p = select(UserPortfolio).where(UserPortfolio.id == portfolio_id)
    port_obj = (await db.execute(stmt_p)).scalar_one_or_none()

    now = current_time_ms()

    for t_symbol, t_list in txs_by_ticker.items():
        qty = 0.0
        total_cost_native = 0.0
        total_cost_base = 0.0
        avg_price_native = 0.0
        avg_price_base = 0.0

        for tx in t_list:
            if tx.type == "BUY":
                cost_native = (tx.quantity * tx.unit_price) + tx.fee
                fx = tx.fx_rate_to_base if tx.fx_rate_to_base and tx.fx_rate_to_base > 0 else 1.0
                cost_base = cost_native * fx

                total_cost_native += cost_native
                total_cost_base += cost_base
                qty += tx.quantity
                avg_price_native = total_cost_native / qty if qty > 0 else 0.0
                avg_price_base = total_cost_base / qty if qty > 0 else 0.0
                tx.realized_pnl = 0.0
                tx.realized_pnl_base = None

            elif tx.type == "SELL":
                if qty > 0:
                    sold_qty = min(tx.quantity, qty)
                    sell_fx = tx.fx_rate_to_base if tx.fx_rate_to_base and tx.fx_rate_to_base > 0 else 1.0

                    gross_proceeds_native = tx.unit_price * sold_qty
                    net_proceeds_native = gross_proceeds_native - tx.fee - tx.tax
                    tx.realized_pnl = round(net_proceeds_native - avg_price_native * sold_qty, 4)

                    net_proceeds_base = net_proceeds_native * sell_fx
                    cost_basis_base = avg_price_base * sold_qty
                    tx.realized_pnl_base = round(net_proceeds_base - cost_basis_base, 4)

                    qty = max(0.0, qty - sold_qty)
                    total_cost_native = qty * avg_price_native
                    total_cost_base = qty * avg_price_base
                    if qty == 0:
                        avg_price_native = 0.0
                        avg_price_base = 0.0
                else:
                    tx.realized_pnl = 0.0
                    tx.realized_pnl_base = None

        qty = round(qty, 4)
        avg_price = round(avg_price_native, 4)

        pos_stmt = select(PortfolioPosition).where(
            PortfolioPosition.user_id == user_id,
            PortfolioPosition.portfolio_id == portfolio_id,
            PortfolioPosition.ticker == t_symbol,
        )
        pos_res = await db.execute(pos_stmt)
        pos = pos_res.scalar_one_or_none()

        if qty > 0:
            if pos:
                pos.quantity = qty
                pos.avg_price = avg_price
                pos.is_closed = "false"
                pos.updated_at = now
            else:
                pos_id = f"pos_{uuid.uuid4().hex[:12]}"
                pos = PortfolioPosition(
                    id=pos_id,
                    portfolio_id=portfolio_id,
                    user_id=user_id,
                    ticker=t_symbol,
                    asset_class=resolve_asset_class(provider, t_symbol),
                    quantity=qty,
                    avg_price=avg_price,
                    is_closed="false",
                    created_at=now,
                    updated_at=now,
                )
                db.add(pos)
        else:
            if pos:
                pos.quantity = 0.0
                pos.avg_price = 0.0
                pos.is_closed = "true"
                pos.updated_at = now

    await db.commit()


# --- Transaction Ledger Service ---
async def add_transaction(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    user_id: int,
    payload: TransactionCreatePayload,
) -> TransactionResponse:
    now = current_time_ms()
    tx_id = f"tx_{uuid.uuid4().hex[:12]}"
    normalized = normalize_ticker(payload.ticker)
    executed_at = payload.executed_at or now

    # 0. Portfolio ID validation
    if not payload.portfolio_id or not payload.portfolio_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Portfolio ID is required.",
        )

    # 1. Date validation (no future dates)
    tx_sec = executed_at if executed_at < 1e11 else int(executed_at / 1000)
    current_sec = int(time.time())
    if tx_sec > current_sec + 300:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transaction execution date cannot be in the future.",
        )

    # 2. Quantity & Price validation
    if payload.type in ("BUY", "SELL") and payload.quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quantity must be greater than zero.",
        )
    if payload.unit_price < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unit price cannot be negative.",
        )

    # 3. Overselling validation for SELL
    if payload.type == "SELL":
        pos_stmt = select(PortfolioPosition).where(
            PortfolioPosition.user_id == user_id,
            PortfolioPosition.portfolio_id == payload.portfolio_id,
            PortfolioPosition.ticker == normalized,
            PortfolioPosition.is_closed == "false",
        )
        pos = (await db.execute(pos_stmt)).scalar_one_or_none()
        held_qty = pos.quantity if pos else 0.0
        if payload.quantity > held_qty:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient stock balance: You hold {held_qty:g} shares of {normalized}, but attempted to sell {payload.quantity:g}.",
            )

    # 4. Auto currency detection & Historical FX resolution
    currency = currency_for_ticker(normalized) if (not payload.currency or payload.currency == "TRY" and not normalized.endswith(".IS")) else payload.currency

    stmt_p = select(UserPortfolio).where(UserPortfolio.id == payload.portfolio_id)
    port_obj = (await db.execute(stmt_p)).scalar_one_or_none()
    port_base_currency = port_obj.base_currency if port_obj else "TRY"

    fx_rate_to_base = payload.fx_rate_to_base
    if currency != port_base_currency and (payload.fx_rate_to_base == 1.0 or payload.fx_rate_to_base <= 0):
        try:
            from ..services.fx import get_historical_fx_rate
            fx_rate_to_base = await get_historical_fx_rate(db, provider, redis, currency, port_base_currency, executed_at)
        except Exception:
            fx_rate_to_base = 1.0

    tx = PortfolioTransaction(
        id=tx_id,
        portfolio_id=payload.portfolio_id,
        user_id=user_id,
        ticker=normalized,
        type=payload.type,
        quantity=round(payload.quantity, 4),
        unit_price=round(payload.unit_price, 4),
        fee=round(payload.fee, 4),
        tax=round(payload.tax, 4),
        currency=currency,
        fx_rate_to_base=fx_rate_to_base,
        realized_pnl=0.0,
        executed_at=tx_sec,
        notes=payload.notes,
        created_at=now,
    )
    db.add(tx)
    await db.commit()

    await recalculate_positions_for_portfolio(db, user_id, payload.portfolio_id, normalized, provider=provider)
    await invalidate_from_date(db, payload.portfolio_id, tx_sec)
    await db.refresh(tx)

    return TransactionResponse(
        id=tx.id,
        portfolio_id=tx.portfolio_id,
        ticker=tx.ticker,
        asset_class=resolve_asset_class(provider, tx.ticker),
        type=tx.type,
        quantity=tx.quantity,
        unit_price=tx.unit_price,
        fee=tx.fee,
        tax=tx.tax,
        currency=tx.currency,
        fx_rate_to_base=tx.fx_rate_to_base,
        realized_pnl=tx.realized_pnl,
        executed_at=tx.executed_at,
        notes=tx.notes,
        created_at=tx.created_at,
        unit_price_base=round(tx.unit_price * tx.fx_rate_to_base, 4),
        total_cost_base=round((tx.quantity * tx.unit_price + tx.fee) * tx.fx_rate_to_base, 4),
        realized_pnl_base=tx.realized_pnl_base,
    )


async def list_transactions(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    user_id: int,
    portfolio_id: str | None = None,
    base_currency: str | None = None,
) -> list[TransactionResponse]:
    if not portfolio_id or portfolio_id == "all":
        p_def = await get_or_create_default_portfolio(db, user_id)
        portfolio_id = p_def.id

    stmt = (
        select(PortfolioTransaction)
        .where(
            PortfolioTransaction.user_id == user_id,
            PortfolioTransaction.portfolio_id == portfolio_id,
        )
        .order_by(PortfolioTransaction.executed_at.desc())
    )

    res = await db.execute(stmt)
    rows = res.scalars().all()

    # Self-heal historic transactions with wrong currency saved in DB
    db_changed = False
    for tx in rows:
        effective_cur = currency_for_ticker(tx.ticker) if (not tx.currency or (tx.currency == "TRY" and not tx.ticker.endswith(".IS"))) else tx.currency
        if tx.currency != effective_cur:
            tx.currency = effective_cur
            db_changed = True

    if db_changed:
        await db.commit()

    response_items = []
    for tx in rows:
        effective_cur = tx.currency or currency_for_ticker(tx.ticker)
        fx_rate = tx.fx_rate_to_base if tx.fx_rate_to_base and tx.fx_rate_to_base > 0 else 1.0

        unit_p = float(tx.unit_price) if tx.unit_price is not None else 0.0
        qty = float(tx.quantity) if tx.quantity is not None else 0.0
        fee_val = float(tx.fee) if tx.fee is not None else 0.0
        tax_val = float(tx.tax) if tx.tax is not None else 0.0

        unit_p_base = round(unit_p * fx_rate, 4)
        cost_base = round((qty * unit_p + fee_val) * fx_rate, 4)

        buy_fx_rate = None
        if tx.type == "SELL" and tx.realized_pnl_base is not None and tx.realized_pnl is not None:
            net_native = (unit_p * qty) - fee_val - tax_val
            net_base = net_native * fx_rate
            cost_basis_base = net_base - tx.realized_pnl_base
            cost_basis_native = net_native - tx.realized_pnl
            if cost_basis_native > 0 and cost_basis_base > 0:
                buy_fx_rate = round(cost_basis_base / cost_basis_native, 4)
            else:
                buy_fx_rate = round(fx_rate, 4)

        response_items.append(
            TransactionResponse(
                id=tx.id,
                portfolio_id=tx.portfolio_id,
                ticker=tx.ticker,
                asset_class=resolve_asset_class(provider, tx.ticker),
                type=tx.type,
                quantity=tx.quantity,
                unit_price=tx.unit_price,
                fee=tx.fee,
                tax=tx.tax,
                currency=effective_cur,
                fx_rate_to_base=round(fx_rate, 4),
                realized_pnl=tx.realized_pnl,
                executed_at=tx.executed_at,
                notes=tx.notes,
                created_at=tx.created_at,
                unit_price_base=unit_p_base,
                total_cost_base=cost_base,
                realized_pnl_base=tx.realized_pnl_base,
                buy_fx_rate=buy_fx_rate,
            )
        )

    return response_items


async def update_transaction(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    user_id: int,
    transaction_id: str,
    payload: TransactionCreatePayload,
) -> TransactionResponse:
    stmt = select(PortfolioTransaction).where(
        PortfolioTransaction.id == transaction_id,
        PortfolioTransaction.user_id == user_id,
    )
    res = await db.execute(stmt)
    tx = res.scalar_one_or_none()
    if tx is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction {transaction_id} not found",
        )

    executed_at = payload.executed_at or tx.executed_at
    tx_sec = executed_at if executed_at < 1e11 else int(executed_at / 1000)
    current_sec = int(time.time())
    if tx_sec > current_sec + 300:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transaction execution date cannot be in the future.",
        )

    if payload.type in ("BUY", "SELL") and payload.quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quantity must be greater than zero.",
        )
    if payload.unit_price < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unit price cannot be negative.",
        )

    old_portfolio_id = tx.portfolio_id
    old_ticker = tx.ticker

    new_ticker = normalize_ticker(payload.ticker)
    new_portfolio_id = payload.portfolio_id

    currency = payload.currency if payload.currency and payload.currency != "TRY" else currency_for_ticker(new_ticker)

    stmt_p = select(UserPortfolio).where(UserPortfolio.id == new_portfolio_id)
    port_obj = (await db.execute(stmt_p)).scalar_one_or_none()
    port_base_currency = port_obj.base_currency if port_obj else "TRY"

    fx_rate_to_base = payload.fx_rate_to_base
    if currency != port_base_currency and (payload.fx_rate_to_base == 1.0 or payload.fx_rate_to_base <= 0):
        try:
            from ..services.fx import get_historical_fx_rate
            fx_rate_to_base = await get_historical_fx_rate(db, provider, redis, currency, port_base_currency, executed_at)
        except Exception:
            fx_rate_to_base = 1.0

    tx.portfolio_id = new_portfolio_id
    tx.ticker = new_ticker
    tx.type = payload.type
    tx.quantity = round(payload.quantity, 4)
    tx.unit_price = round(payload.unit_price, 4)
    tx.fee = round(payload.fee, 4)
    tx.tax = round(payload.tax, 4)
    tx.currency = currency
    tx.fx_rate_to_base = fx_rate_to_base
    if payload.executed_at is not None:
        tx.executed_at = payload.executed_at
    tx.notes = payload.notes

    await db.commit()

    await recalculate_positions_for_portfolio(db, user_id, old_portfolio_id, old_ticker, provider=provider)
    await invalidate_from_date(db, old_portfolio_id, tx_sec)
    if new_portfolio_id != old_portfolio_id or new_ticker != old_ticker:
        await recalculate_positions_for_portfolio(db, user_id, new_portfolio_id, new_ticker, provider=provider)
        await invalidate_from_date(db, new_portfolio_id, tx_sec)

    await db.refresh(tx)

    return TransactionResponse(
        id=tx.id,
        portfolio_id=tx.portfolio_id,
        ticker=tx.ticker,
        asset_class=resolve_asset_class(provider, tx.ticker),
        type=tx.type,
        quantity=tx.quantity,
        unit_price=tx.unit_price,
        fee=tx.fee,
        tax=tx.tax,
        currency=tx.currency,
        fx_rate_to_base=tx.fx_rate_to_base,
        realized_pnl=tx.realized_pnl,
        executed_at=tx.executed_at,
        notes=tx.notes,
        created_at=tx.created_at,
        unit_price_base=round(tx.unit_price * tx.fx_rate_to_base, 4),
        total_cost_base=round((tx.quantity * tx.unit_price + tx.fee) * tx.fx_rate_to_base, 4),
        realized_pnl_base=tx.realized_pnl_base,
    )


async def delete_transaction(
    db: AsyncSession,
    user_id: int,
    transaction_id: str,
    provider: DataProvider | None = None,
) -> None:
    stmt = select(PortfolioTransaction).where(
        PortfolioTransaction.user_id == user_id,
        PortfolioTransaction.id == transaction_id,
    )
    res = await db.execute(stmt)
    tx = res.scalar_one_or_none()
    if tx is None:
        return

    portfolio_id = tx.portfolio_id
    ticker = tx.ticker
    executed_at = tx.executed_at

    await db.delete(tx)
    await db.commit()

    await recalculate_positions_for_portfolio(db, user_id, portfolio_id, ticker, provider=provider)
    await invalidate_from_date(db, portfolio_id, executed_at)


# --- Overview Aggregator ---
async def get_portfolio_overview(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    user_id: int,
    portfolio_id: str | None = None,
    base_currency: str | None = None,
    pnl_period: str = "all",
) -> PortfolioOverviewResponse:
    if not portfolio_id or portfolio_id == "all":
        p_def = await get_or_create_default_portfolio(db, user_id)
        portfolio_id = p_def.id

    stmt_p = select(UserPortfolio).where(
        UserPortfolio.id == portfolio_id, UserPortfolio.user_id == user_id
    )
    p_obj = (await db.execute(stmt_p)).scalar_one_or_none()
    base_currency = p_obj.base_currency if p_obj else "TRY"

    positions = await list_positions_for_portfolio(
        db, provider, redis, user_id, portfolio_id, base_currency=base_currency
    )

    total_net_worth = sum(p.market_value for p in positions)
    total_cost = sum(p.total_cost for p in positions)
    unrealized_pnl = sum(p.pnl for p in positions)

    # Period-aware PnL: for non-"all" periods, compute value N days ago from candle history
    if pnl_period != "all" and positions:
        period_days = {"daily": 2, "weekly": 9, "monthly": 33}.get(pnl_period, 0)
        period_map_str = {"daily": "2d", "weekly": "9d", "monthly": "33d"}.get(pnl_period)
        if period_days > 0 and period_map_str:
            past_val = 0.0
            for pos in positions:
                try:
                    candles, _, _ = await get_history(db, provider, pos.ticker, "1d", period_map_str)
                    native_currency = currency_for_ticker(pos.ticker)
                    fx_rate = await get_fx_rate(redis, provider, native_currency, base_currency)
                    if candles:
                        first_price = float(candles[0].close)
                        past_val += first_price * float(pos.quantity) * fx_rate
                except Exception:
                    past_val += pos.total_cost
    unrealized_pnl = total_net_worth - total_cost
    unrealized_pnl_pct = (
        (unrealized_pnl / total_cost * 100.0) if total_cost > 0 else 0.0
    )

    # Realized PnL summary across all transactions of this specific portfolio
    r_stmt = select(func.sum(PortfolioTransaction.realized_pnl_base)).where(
        PortfolioTransaction.user_id == user_id,
        PortfolioTransaction.portfolio_id == portfolio_id,
        PortfolioTransaction.type == "SELL",
    )
    r_res = await db.execute(r_stmt)
    realized_pnl = float(r_res.scalar() or 0.0)

    kpis = PortfolioKPIs(
        total_net_worth=round(total_net_worth, 2),
        total_cost=round(total_cost, 2),
        unrealized_pnl=round(unrealized_pnl, 2),
        unrealized_pnl_percent=round(unrealized_pnl_pct, 2),
        realized_pnl=round(realized_pnl, 2),
        cash_balance=0.0,
        holding_count=len(positions),
        pnl_period=pnl_period,
        fx_rates_as_of=get_fx_rates_timestamp(),
    )

    p_summary = None
    if p_obj:
        p_summary = PortfolioSummary(
            id=p_obj.id,
            name=p_obj.name,
            base_currency=p_obj.base_currency,
            is_default=p_obj.is_default == "true",
            created_at=p_obj.created_at,
        )

    return PortfolioOverviewResponse(portfolio=p_summary, kpis=kpis, positions=positions)


# --- Portfolio History Service ---
async def get_portfolio_history(
    db: AsyncSession,
    provider: DataProvider,
    redis: aioredis.Redis,
    user_id: int,
    portfolio_id: str | None = None,
    timeframe: str = "all",
    interval: str = "1d",
    benchmark: str | None = "^GSPC",
    base_currency: str | None = None,
) -> PortfolioHistoryResponse:
    if not portfolio_id or portfolio_id == "all":
        p_def = await get_or_create_default_portfolio(db, user_id)
        portfolio_id = p_def.id

    return await get_portfolio_history_data(
        db, provider, redis, user_id, portfolio_id,
        interval=interval, benchmark=benchmark, base_currency=base_currency
    )
