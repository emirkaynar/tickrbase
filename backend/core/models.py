from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Candle(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


class PriceResponse(BaseModel):
    ticker: str
    current_price: float
    timestamp: str
    stale: bool = False
    last_updated: str


class HistoryResponse(BaseModel):
    ticker: str
    interval: str
    candles: list[Candle]
    stale: bool = False
    last_updated: str


class PortfolioPosition(BaseModel):
    ticker: str
    quantity: float
    avg_price: float
    current_price: float
    pnl: float
    pnl_percent: float


class PortfolioCreate(BaseModel):
    ticker: str
    quantity: float
    avg_price: float


class AlertCreate(BaseModel):
    ticker: str
    condition: Literal["above", "below"]
    threshold: float


class AlertRecord(BaseModel):
    id: int
    ticker: str
    condition: Literal["above", "below"]
    threshold: float
    active: bool
    created_at: str
    last_triggered_at: str | None = None


class WatchlistItem(BaseModel):
    ticker: str
    interval: str


class WatchlistUpdate(BaseModel):
    items: list[WatchlistItem] = Field(default_factory=list)


class SymbolItem(BaseModel):
    label: str
    value: str


class SymbolsResponse(BaseModel):
    items: list[SymbolItem]
    stale: bool = False
    last_updated: str


class LookupItem(BaseModel):
    symbol: str
    company_name: str
    exchange: str
    instrument_type: str


class LookupResponse(BaseModel):
    query: str
    items: list[LookupItem]
    stale: bool = False
    last_updated: str


class ErrorResponse(BaseModel):
    error: bool = True
    message: str
