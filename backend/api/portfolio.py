from __future__ import annotations

from typing import Annotated
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.models_db import User
from ..providers import get_provider
from ..schemas.models import MessageResponse
from ..schemas.portfolio import (
    PortfolioSummary,
    PortfolioCreatePayload,
    PositionResponse,
    PositionQuickUpsertPayload,
    TransactionCreatePayload,
    TransactionResponse,
    PortfolioOverviewResponse,
    PortfolioHistoryResponse,
)
from ..services import portfolio as portfolio_service
from ..api.deps import get_current_user, get_redis

router = APIRouter(prefix="/portfolio", tags=["Portfolio"])


# --- Portfolio Management Endpoints ---
@router.get("/portfolios", response_model=list[PortfolioSummary])
async def list_portfolios(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await portfolio_service.list_user_portfolios(db, current_user.id)


@router.post("/portfolios", response_model=PortfolioSummary)
async def create_portfolio(
    payload: PortfolioCreatePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await portfolio_service.create_user_portfolio(
        db, current_user.id, payload.name, payload.base_currency, payload.is_default
    )


# --- Overview & KPI Endpoint ---
@router.get("/overview", response_model=PortfolioOverviewResponse)
async def get_overview(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
    portfolio_id: str | None = Query(None, description="Portfolio ID (defaults to default portfolio)"),
    base_currency: str | None = Query(None, description="Target currency for valuations"),
    pnl_period: str = Query("all", description="PnL period: daily, weekly, monthly, all"),
):
    provider = get_provider(current_user.tier)
    if not portfolio_id:
        p_default = await portfolio_service.get_or_create_default_portfolio(db, current_user.id)
        portfolio_id = p_default.id

    return await portfolio_service.get_portfolio_overview(
        db, provider, redis, current_user.id, portfolio_id,
        base_currency=base_currency,
        pnl_period=pnl_period,
    )


@router.get("/history", response_model=PortfolioHistoryResponse)
async def get_portfolio_history(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
    portfolio_id: str | None = Query(None, description="Portfolio ID"),
    timeframe: str = Query("all", description="Timeframe: 1w, 1m, 3m, 6m, 1y, all"),
    interval: str = Query("1d", description="Candle interval: 1d, 1wk, 1mo, 1y"),
    benchmark: str | None = Query("^GSPC", description="Benchmark ticker e.g. ^GSPC, ^IXIC, XU100.IS"),
    base_currency: str | None = Query(None, description="Target currency for portfolio values"),
):
    provider = get_provider(current_user.tier)

    # Track portfolio activity for snapshot prewarm scheduler
    if portfolio_id:
        try:
            await redis.setex(f"pf:active:{portfolio_id}", 7 * 86400, "1")
        except Exception:
            pass

    result = await portfolio_service.get_portfolio_history(
        db, provider, redis, current_user.id, portfolio_id,
        timeframe=timeframe, interval=interval, benchmark=benchmark, base_currency=base_currency,
    )
    return result



# --- Positions Endpoints ---
@router.get("/positions", response_model=list[PositionResponse])
async def list_positions(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
    portfolio_id: str | None = Query(None, description="Portfolio ID"),
):
    provider = get_provider(current_user.tier)
    if not portfolio_id:
        p_default = await portfolio_service.get_or_create_default_portfolio(db, current_user.id)
        portfolio_id = p_default.id

    return await portfolio_service.list_positions_for_portfolio(
        db, provider, redis, current_user.id, portfolio_id
    )


@router.post("/positions/quick", response_model=PositionResponse)
async def upsert_position_quick(
    payload: PositionQuickUpsertPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await portfolio_service.upsert_position_quick(db, current_user.id, payload)


@router.delete("/positions/{position_id}", response_model=MessageResponse)
async def delete_position(
    position_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await portfolio_service.delete_position(db, current_user.id, position_id)
    return MessageResponse(ok=True)


# --- Transaction Ledger Endpoints ---
@router.get("/transactions", response_model=list[TransactionResponse])
async def list_transactions(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
    portfolio_id: str | None = Query(None, description="Portfolio ID"),
    base_currency: str | None = Query(None, description="Target base currency for valuations"),
):
    provider = get_provider(current_user.tier)
    return await portfolio_service.list_transactions(
        db, provider, redis, current_user.id, portfolio_id, base_currency=base_currency
    )


@router.post("/transactions", response_model=TransactionResponse)
async def add_transaction(
    payload: TransactionCreatePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
):
    provider = get_provider(current_user.tier)
    return await portfolio_service.add_transaction(db, provider, redis, current_user.id, payload)


@router.put("/transactions/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: str,
    payload: TransactionCreatePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
):
    provider = get_provider(current_user.tier)
    return await portfolio_service.update_transaction(
        db, provider, redis, current_user.id, transaction_id, payload
    )


@router.delete("/transactions/{transaction_id}", response_model=MessageResponse)
async def delete_transaction(
    transaction_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    provider = get_provider(current_user.tier)
    await portfolio_service.delete_transaction(db, current_user.id, transaction_id, provider=provider)
    return MessageResponse(ok=True)

