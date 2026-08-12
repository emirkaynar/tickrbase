from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


# --- User Portfolio Schemas ---
class PortfolioSummary(BaseModel):
    id: str
    name: str
    base_currency: str = "TRY"
    is_default: bool = False
    created_at: int


class PortfolioCreatePayload(BaseModel):
    name: str
    base_currency: str = "TRY"
    is_default: bool = False


# --- Position Schemas ---
class PositionResponse(BaseModel):
    id: str
    portfolio_id: str
    ticker: str
    asset_class: str = "EQUITY"
    sector: str | None = None
    quantity: float
    avg_price: float
    current_price: float
    market_value: float
    total_cost: float
    pnl: float
    pnl_percent: float
    weight_percent: float = 0.0
    target_weight_pct: float | None = None
    tags: list[str] = Field(default_factory=list)
    is_closed: bool = False
    created_at: int
    updated_at: int
    # Currency fields — values above are already converted to base_currency
    currency: str = "USD"          # native trading currency of the asset
    fx_rate_to_base: float = 1.0   # rate applied: native → base_currency
    # Native currency fields (raw asset values before FX conversion)
    avg_price_native: float = 0.0
    current_price_native: float = 0.0
    market_value_native: float = 0.0
    pnl_native: float = 0.0


class PositionQuickUpsertPayload(BaseModel):
    portfolio_id: str
    ticker: str
    quantity: float
    avg_price: float
    asset_class: str = "EQUITY"
    sector: str | None = None
    target_weight_pct: float | None = None
    tags: list[str] = Field(default_factory=list)


# --- Transaction Ledger Schemas ---
TransactionType = Literal[
    "BUY", "SELL", "DIVIDEND", "DEPOSIT", "WITHDRAWAL", "FEE", "TAX", "SPLIT"
]


class TransactionResponse(BaseModel):
    id: str
    portfolio_id: str
    ticker: str
    asset_class: str = "Equity"
    type: TransactionType
    quantity: float
    unit_price: float
    fee: float
    tax: float
    currency: str
    fx_rate_to_base: float
    realized_pnl: float | None = 0.0
    executed_at: int
    notes: str | None = None
    created_at: int
    # Base currency equivalents for subtitle display
    unit_price_base: float = 0.0
    total_cost_base: float = 0.0
    realized_pnl_base: float | None = None
    buy_fx_rate: float | None = None


class TransactionCreatePayload(BaseModel):
    portfolio_id: str
    ticker: str
    type: TransactionType
    quantity: float = Field(default=0.0, gt=0, description="Quantity must be greater than zero")
    unit_price: float = Field(default=0.0, ge=0, description="Unit price cannot be negative")
    fee: float = Field(default=0.0, ge=0, description="Fee cannot be negative")
    tax: float = Field(default=0.0, ge=0, description="Tax cannot be negative")
    currency: str = "TRY"
    fx_rate_to_base: float = 1.0
    executed_at: int | None = None
    notes: str | None = None


# --- Portfolio Overview / Aggregation Schemas ---
class PortfolioKPIs(BaseModel):
    total_net_worth: float
    total_cost: float
    unrealized_pnl: float
    unrealized_pnl_percent: float
    realized_pnl: float
    cash_balance: float
    holding_count: int
    pnl_period: str = "all"        # which period the unrealized_pnl covers
    fx_rates_as_of: int = 0        # unix timestamp when FX rates were fetched


class PortfolioOverviewResponse(BaseModel):
    portfolio: PortfolioSummary | None = None
    kpis: PortfolioKPIs
    positions: list[PositionResponse]


class PortfolioHistoryPoint(BaseModel):
    time: int
    portfolio_value: float | None = None
    market_value_base: float | None = None
    net_invested_base: float | None = None
    pnl_base: float | None = None
    pnl_pct: float | None = None
    pnl_delta_pct: float | None = None
    fx_effect_base: float | None = None
    portfolio_percent: float | None = None
    benchmark_percent: float | None = None


class PortfolioHistoryResponse(BaseModel):
    portfolio_id: str
    timeframe: str
    benchmark: str | None = None
    points: list[PortfolioHistoryPoint]
