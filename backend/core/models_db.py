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
