import asyncio
from unittest.mock import AsyncMock, Mock

from sqlalchemy.dialects import postgresql
from backend.core import history_cache
from backend.core.models_db import OHLC, HistoryMeta
from backend.providers.base import DataProvider
from backend.providers.yahoo import YahooFinanceProvider
from backend.schemas.models import Candle
from backend.services.streaming import _extract_tick


class OtherProvider(DataProvider):
    source_id = "other"
    def get_price(self, ticker): return 1, 1
    def get_history(self, ticker, interval, period=None, start=None, end=None, sessions="regular"):
        self.request = (ticker, interval, sessions)
        return [Candle(time=100, open=1, high=1, low=1, close=1)]
    def get_company_info(self, ticker): return {}
    def get_quote_snapshot(self, ticker, groups=None): return {}, 1
    def lookup(self, query, count=1): return []


def test_normalized_adapter_supports_another_source():
    provider = OtherProvider()
    asyncio.run(provider.get_history_async("TEST", "1m", sessions="extended"))
    assert provider.source_id == "other"
    assert provider.request == ("TEST", "1m", "extended")


def test_cache_queries_and_conflict_keys_isolate_source_and_sessions():
    async def run():
        db = AsyncMock()
        db.execute.return_value = Mock()
        db.execute.return_value.all.return_value = []
        await history_cache._upsert_history(db, "TEST", "1m", [Candle(time=1, open=1, high=1, low=1, close=1)], "other", "extended")
        stmt = db.execute.call_args.args[0]
        sql = str(stmt.compile(dialect=postgresql.dialect()))
        assert "ON CONFLICT (source, sessions, ticker, interval, time)" in sql
        assert stmt.compile().params["source_m0"] == "other"
        await history_cache._read_history(db, "TEST", "1m", 0, source="other", sessions="extended")
        params = db.execute.call_args.args[0].compile().params
        assert "other" in params.values()
        assert "extended" in params.values()
    asyncio.run(run())
    assert list(OHLC.__table__.primary_key.columns.keys()) == ["source", "sessions", "ticker", "interval", "time"]
    assert list(HistoryMeta.__table__.primary_key.columns.keys()) == ["source", "sessions", "ticker", "interval"]


def test_yahoo_extended_option_stays_inside_adapter(monkeypatch):
    import pandas as pd
    import yfinance
    ticker = Mock()
    ticker.history = Mock(return_value=pd.DataFrame())
    monkeypatch.setattr(yfinance, "Ticker", lambda _: ticker)
    provider = YahooFinanceProvider()
    provider.get_history("TEST", "1m", sessions="extended")
    assert ticker.history.call_args.kwargs["prepost"] is True
    provider.get_history("TEST", "1d")
    assert ticker.history.call_args.kwargs["prepost"] is False


def test_stream_timestamps_keep_provenance_and_reject_nonfinite_prices():
    assert _extract_tick({"id": "TEST", "price": 1, "time": 1791370800})[2:] == (1791370800000, "source")
    assert _extract_tick({"id": "TEST", "price": 1})[-1] == "receipt"
    assert _extract_tick({"id": "TEST", "price": float("inf")}) is None


def test_large_extended_history_respects_postgres_parameter_limit():
    async def run():
        db = AsyncMock()
        bars = [Candle(time=t, open=1, high=1, low=1, close=1) for t in range(2001)]
        await history_cache._upsert_history(db, "TEST", "1m", bars, "other", "extended")
        assert db.execute.await_count == 2
        for call in db.execute.call_args_list:
            assert len(call.args[0].compile().params) < 32767
    asyncio.run(run())
