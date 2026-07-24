from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserMeResponse(BaseModel):
    id: int
    email: str
    tier: str
    created_at: datetime


class MessageResponse(BaseModel):
    ok: bool = True
    message: str | None = None


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


class QuoteSnapshot(BaseModel):
    symbol: str
    current_price: float | None = None
    previous_close: float | None = None
    open: float | None = None
    day_low: float | None = None
    day_high: float | None = None
    change: float | None = None
    change_percent: float | None = None
    volume: float | None = None
    volume_value: float | None = None
    bid: float | None = None
    ask: float | None = None
    stale: bool = False
    last_updated: str


class QuotesResponse(BaseModel):
    symbols: list[str]
    quotes: list[QuoteSnapshot]
    stale: bool = False
    last_updated: str


class ErrorResponse(BaseModel):
    error: bool = True
    message: str


# Layout Schemas
class WidgetSchema(BaseModel):
    id: str
    screenId: str
    type: str
    x: int
    y: int
    w: int
    h: int
    minW: int = 1
    minH: int = 1
    createdAt: int


class ScreenSchema(BaseModel):
    id: str
    name: str
    order: int = 0
    createdAt: int


class LayoutPayload(BaseModel):
    screens: list[ScreenSchema]
    activeScreenId: str
    widgets: list[WidgetSchema]


class WidgetStatePayload(BaseModel):
    symbol: str | None = None
    interval: str | None = None
    state: dict | None = None


# Watchlist Schemas
class WatchlistSchema(BaseModel):
    id: str
    name: str
    order: int = 0
    items: list[str] = []
    rowState: dict | None = None
    createdAt: int
    updatedAt: int


class WatchlistSavePayload(BaseModel):
    name: str
    order: int = 0
    items: list[str] = []
    rowState: dict | None = None


# Settings Schemas
class SettingsPayload(BaseModel):
    settings: dict[str, object]


# Table Preferences Schemas
class TablePrefPayload(BaseModel):
    scopeType: str
    scopeId: str
    tableId: str
    prefs: dict[str, object]

