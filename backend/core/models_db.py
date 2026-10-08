from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    tier = Column(String(50), nullable=False, default="free")
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    portfolios = relationship("UserPortfolio", back_populates="user", cascade="all, delete-orphan")
    screens = relationship("UserScreen", back_populates="user", cascade="all, delete-orphan")
    watchlists = relationship("UserWatchlist", back_populates="user", cascade="all, delete-orphan")
    settings = relationship("UserSetting", back_populates="user", cascade="all, delete-orphan")


class UserScreen(Base):
    __tablename__ = "user_screens"

    id = Column(String(100), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    order = Column(Integer, nullable=False, default=0)
    created_at = Column(BigInteger, nullable=False)

    user = relationship("User", back_populates="screens")
    widgets = relationship("UserWidget", back_populates="screen", cascade="all, delete-orphan")


class UserWidget(Base):
    __tablename__ = "user_widgets"

    id = Column(String(100), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    screen_id = Column(String(100), ForeignKey("user_screens.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(100), nullable=False)
    x = Column(Integer, nullable=False)
    y = Column(Integer, nullable=False)
    w = Column(Integer, nullable=False)
    h = Column(Integer, nullable=False)
    min_w = Column(Integer, nullable=False, default=1)
    min_h = Column(Integer, nullable=False, default=1)
    created_at = Column(BigInteger, nullable=False)

    screen = relationship("UserScreen", back_populates="widgets")
    widget_state = relationship("UserWidgetState", back_populates="widget", uselist=False, cascade="all, delete-orphan")


class UserWidgetState(Base):
    __tablename__ = "user_widget_states"

    widget_id = Column(String(100), ForeignKey("user_widgets.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(50), nullable=True)
    interval = Column(String(20), nullable=True)
    state_json = Column(Text, nullable=True)

    widget = relationship("UserWidget", back_populates="widget_state")


class UserWatchlist(Base):
    __tablename__ = "user_watchlists"

    id = Column(String(100), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    name_lower = Column(String(255), nullable=False)
    order = Column(Integer, nullable=False, default=0)
    items_json = Column(Text, nullable=False, default="[]")
    row_state_json = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)

    user = relationship("User", back_populates="watchlists")


class UserSetting(Base):
    __tablename__ = "user_settings"
    __table_args__ = (
        PrimaryKeyConstraint("user_id", "key"),
    )

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key = Column(String(100), nullable=False)
    value_json = Column(Text, nullable=False)
    updated_at = Column(BigInteger, nullable=False)

    user = relationship("User", back_populates="settings")


class UserTablePref(Base):
    __tablename__ = "user_table_prefs"

    id = Column(String(100), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    scope_type = Column(String(50), nullable=False)
    scope_id = Column(String(100), nullable=False)
    table_id = Column(String(100), nullable=False)
    prefs_json = Column(Text, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


class UserPortfolio(Base):
    __tablename__ = "user_portfolios"

    id = Column(String(100), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    base_currency = Column(String(10), nullable=False, default="TRY")
    is_default = Column(String(10), nullable=False, default="false")  # "true" / "false"
    created_at = Column(BigInteger, nullable=False)

    user = relationship("User", back_populates="portfolios")
    positions = relationship("PortfolioPosition", back_populates="portfolio", cascade="all, delete-orphan")
    transactions = relationship("PortfolioTransaction", back_populates="portfolio", cascade="all, delete-orphan")
    goals = relationship("UserPortfolioGoal", back_populates="portfolio", cascade="all, delete-orphan")


class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"
    __table_args__ = (
        UniqueConstraint("portfolio_id", "ticker", name="uq_portfolio_ticker"),
    )

    id = Column(String(100), primary_key=True)
    portfolio_id = Column(String(100), ForeignKey("user_portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String(50), nullable=False)
    asset_class = Column(String(50), nullable=False, default="Equity")
    sector = Column(String(100), nullable=True)
    quantity = Column(Float, nullable=False, default=0.0)
    avg_price = Column(Float, nullable=False, default=0.0)
    target_weight_pct = Column(Float, nullable=True)
    tags_json = Column(Text, nullable=False, default="[]")
    is_closed = Column(String(10), nullable=False, default="false")  # "true" / "false"
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)

    portfolio = relationship("UserPortfolio", back_populates="positions")


class PortfolioTransaction(Base):
    __tablename__ = "portfolio_transactions"

    id = Column(String(100), primary_key=True)
    portfolio_id = Column(String(100), ForeignKey("user_portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String(50), nullable=False)
    type = Column(String(30), nullable=False)  # BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL, FEE, TAX, SPLIT
    quantity = Column(Float, nullable=False, default=0.0)
    unit_price = Column(Float, nullable=False, default=0.0)
    fee = Column(Float, nullable=False, default=0.0)
    tax = Column(Float, nullable=False, default=0.0)
    currency = Column(String(10), nullable=False, default="TRY")
    fx_rate_to_base = Column(Float, nullable=False, default=1.0)
    realized_pnl = Column(Float, nullable=True, default=0.0)
    realized_pnl_base = Column(Float, nullable=True, default=None)
    executed_at = Column(BigInteger, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False)

    portfolio = relationship("UserPortfolio", back_populates="transactions")


class UserPortfolioGoal(Base):
    __tablename__ = "user_portfolio_goals"

    id = Column(String(100), primary_key=True)
    portfolio_id = Column(String(100), ForeignKey("user_portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    target_amount = Column(Float, nullable=False)
    target_date = Column(BigInteger, nullable=False)
    created_at = Column(BigInteger, nullable=False)

    portfolio = relationship("UserPortfolio", back_populates="goals")


class OHLC(Base):
    source = Column(String(50), nullable=False, default="yahoo", server_default="yahoo")
    sessions = Column(String(20), nullable=False, default="regular", server_default="regular")
    __tablename__ = "ohlc"
    __table_args__ = (
        PrimaryKeyConstraint("source", "sessions", "ticker", "interval", "time"),
    )

    ticker = Column(String(50), nullable=False)
    interval = Column(String(20), nullable=False)
    time = Column(BigInteger, nullable=False)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Float, nullable=True)


class HistoryMeta(Base):
    source = Column(String(50), nullable=False, default="yahoo", server_default="yahoo")
    sessions = Column(String(20), nullable=False, default="regular", server_default="regular")
    __tablename__ = "history_meta"
    __table_args__ = (
        PrimaryKeyConstraint("source", "sessions", "ticker", "interval"),
    )

    ticker = Column(String(50), nullable=False)
    interval = Column(String(20), nullable=False)
    last_refresh = Column(BigInteger, nullable=False)


class SymbolsCache(Base):
    __tablename__ = "symbols_cache"

    id = Column(String(50), primary_key=True)
    payload = Column(Text, nullable=False)
    fetched_at = Column(BigInteger, nullable=False)


class LookupCache(Base):
    __tablename__ = "lookup_cache"

    query = Column(String(255), primary_key=True)
    payload = Column(Text, nullable=False)
    fetched_at = Column(BigInteger, nullable=False)


class PortfolioLedgerSnapshot(Base):
    __tablename__ = "portfolio_ledger_snapshots"
    __table_args__ = (
        PrimaryKeyConstraint("portfolio_id", "snap_date", "ticker"),
        Index("ix_ledger_snap_portfolio_date", "portfolio_id", "snap_date"),
    )

    portfolio_id = Column(String(100), ForeignKey("user_portfolios.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    snap_date = Column(BigInteger, nullable=False)
    ticker = Column(String(50), nullable=False)
    quantity = Column(Float, nullable=False)
    avg_price_native = Column(Float, nullable=False)
    avg_price_base = Column(Float, nullable=False)
    net_invested_native = Column(Float, nullable=False)
    net_invested_base = Column(Float, nullable=False)
    fx_rate_snap = Column(Float, nullable=False)


class PortfolioValueSnapshot(Base):
    __tablename__ = "portfolio_value_snapshots"
    __table_args__ = (
        PrimaryKeyConstraint("portfolio_id", "snap_date"),
    )

    portfolio_id = Column(String(100), ForeignKey("user_portfolios.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    snap_date = Column(BigInteger, nullable=False)
    market_value_base = Column(Float, nullable=False)
    net_invested_base = Column(Float, nullable=False)
    pnl_base = Column(Float, nullable=False)
    pnl_pct = Column(Float, nullable=False)
    fx_effect_base = Column(Float, nullable=False)
    last_updated = Column(BigInteger, nullable=False)
