from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Float,
    ForeignKey,
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

    portfolios = relationship("Portfolio", back_populates="user", cascade="all, delete-orphan")
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


class Portfolio(Base):
    __tablename__ = "portfolio"
    __table_args__ = (
        UniqueConstraint("user_id", "ticker", name="uq_user_ticker"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String(50), nullable=False)
    quantity = Column(Float, nullable=False)
    avg_price = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    user = relationship("User", back_populates="portfolios")


class OHLC(Base):
    __tablename__ = "ohlc"
    __table_args__ = (
        PrimaryKeyConstraint("ticker", "interval", "time"),
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
    __tablename__ = "history_meta"
    __table_args__ = (
        PrimaryKeyConstraint("ticker", "interval"),
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

