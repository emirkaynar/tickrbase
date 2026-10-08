from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


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


class DataCoverage(BaseModel):
    intervals: list[str] = Field(default_factory=list)
    sessions: list[str] = Field(default_factory=list)
    overnight_history: bool | None = None
    delay_seconds: int | None = None


class SessionWindow(BaseModel):
    kind: str
    start: int
    end: int


class MarketSession(BaseModel):
    trading_date: str
    regular_open: int
    regular_close: int
    windows: list[SessionWindow]


class CalendarCoverage(BaseModel):
    from_: int = Field(alias="from")
    to: int


class MarketContextResponse(BaseModel):
    ticker: str
    exchange: str | None = None
    instrument_type: str | None = None
    exchange_timezone: str | None = None
    sessions: list[MarketSession] = Field(default_factory=list)
    calendar_coverage: CalendarCoverage | None = None
    server_time: int


class HistoryResponse(BaseModel):
    source: str = "unknown"
    sessions: str = "regular"
    coverage: DataCoverage = Field(default_factory=DataCoverage)
    snapshot_time: int | None = None

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
    source: str = "unknown"
    source_timestamp: int | None = None
    timestamp_origin: str = "unknown"
    delay_seconds: int | None = None

    symbol: str
    currency: str | None = None
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


class OverviewResponse(BaseModel):
    symbol: str
    currency: str | None = None
    company_name: str | None = None
    market_cap: float | None = None
    pe_ratio: float | None = None
    forward_pe: float | None = None
    eps: float | None = None
    forward_eps: float | None = None
    dividend_yield: float | None = None
    dividend_rate: float | None = None
    beta: float | None = None
    fifty_two_week_high: float | None = None
    fifty_two_week_low: float | None = None
    fifty_day_average: float | None = None
    two_hundred_day_average: float | None = None
    shares_outstanding: float | None = None
    float_shares: float | None = None
    sector: str | None = None
    industry: str | None = None
    description: str | None = None
    vwap: float | None = None
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

