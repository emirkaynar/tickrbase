from __future__ import annotations

from typing import Annotated
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.models_db import User
from ..providers import get_provider
from ..schemas.models import MessageResponse, PortfolioCreate, PortfolioPosition
from ..services import portfolio as portfolio_service
from ..api.deps import get_current_user, get_redis

router = APIRouter(prefix="/portfolio", tags=["Portfolio"])


@router.get("", response_model=list[PortfolioPosition])
async def get_portfolio(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
):
    provider = get_provider(current_user.tier)
    return await portfolio_service.list_positions(db, provider, redis, current_user.id)


@router.post("", response_model=MessageResponse, status_code=status.HTTP_200_OK)
async def upsert_portfolio(
    payload: PortfolioCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await portfolio_service.upsert_position(
        db, current_user.id, payload.ticker, payload.quantity, payload.avg_price
    )
    return MessageResponse(ok=True)


@router.delete("/{ticker}", response_model=MessageResponse)
async def delete_portfolio(
    ticker: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await portfolio_service.delete_position(db, current_user.id, ticker)
    return MessageResponse(ok=True)
