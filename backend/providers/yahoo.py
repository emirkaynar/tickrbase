from __future__ import annotations

import math
from datetime import datetime, timezone

from ..core.config import BIST_SUFFIX
from ..schemas.models import Candle
from .base import DataProvider


def normalize_ticker(ticker: str) -> str:
    cleaned = ticker.strip().upper()
    return cleaned


def _to_unix_seconds(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _coerce_float(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)
    return None


class YahooFinanceProvider(DataProvider):
    def get_price(self, ticker: str) -> tuple[float, int]:
        import yfinance as yf

        normalized = normalize_ticker(ticker)
        yf_ticker = yf.Ticker(normalized)

        price = None
        try:
            info = yf_ticker.fast_info
            if info:
                price = info.get("lastPrice") or info.get("last_price")
        except Exception:
            price = None

        if price is None:
            hist = yf_ticker.history(period="1d", interval="1m")
            if hist.empty:
                raise ValueError("No price data returned")
            price = float(hist["Close"].dropna().iloc[-1])

        return float(price), int(datetime.now(tz=timezone.utc).timestamp())

    def get_history(
        self,
        ticker: str,
        interval: str,
        period: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> list[Candle]:
        import yfinance as yf

        normalized = normalize_ticker(ticker)
        yf_ticker = yf.Ticker(normalized)

        kwargs: dict[str, object] = {
            "interval": interval,
            "auto_adjust": False,
            "actions": False,
        }
        if start is not None:
            kwargs["start"] = datetime.fromtimestamp(start, tz=timezone.utc)
        if end is not None:
            kwargs["end"] = datetime.fromtimestamp(end, tz=timezone.utc)
        if period is not None and start is None and end is None:
            kwargs["period"] = period

        hist = yf_ticker.history(**kwargs)
        if hist.empty:
            return []

        candles: list[Candle] = []
        for ts, row in hist.iterrows():
            dt = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts  # type: ignore
            time_sec = _to_unix_seconds(dt)  # type: ignore
            open_v = _coerce_float(row.get("Open"))
            high_v = _coerce_float(row.get("High"))
            low_v = _coerce_float(row.get("Low"))
            close_v = _coerce_float(row.get("Close"))
            if open_v is None or high_v is None or low_v is None or close_v is None:
                continue
            volume = _coerce_float(row.get("Volume"))
            candles.append(
                Candle(
                    time=time_sec,
                    open=open_v,
                    high=high_v,
                    low=low_v,
                    close=close_v,
                    volume=volume,
                )
            )

        candles.sort(key=lambda c: c.time)
        return candles

    def get_company_info(self, ticker: str) -> dict:
        import yfinance as yf

        normalized = normalize_ticker(ticker)
        yf_ticker = yf.Ticker(normalized)
        try:
            return yf_ticker.get_info() or {}
        except Exception:
            return {}

    def get_quote_snapshot(
        self,
        ticker: str,
        groups: set[str] | None = None,
    ) -> tuple[dict, int]:
        import yfinance as yf

        normalized = normalize_ticker(ticker)
        yf_ticker = yf.Ticker(normalized)
        requested = groups or {"session", "volume", "quote"}

        fast: dict[str, object] = {}
        try:
            fast_info = yf_ticker.fast_info
            if fast_info:
                fast = dict(fast_info)
        except Exception:
            fast = {}

        def pick(source: dict[str, object], *aliases: str) -> float | None:
            for alias in aliases:
                value = _coerce_float(source.get(alias))
                if value is not None:
                    return value
            return None

        current_price = pick(
            fast,
            "lastPrice",
            "last_price",
            "regularMarketPrice",
            "currentPrice",
        )
        previous_close = pick(
            fast,
            "regularMarketPreviousClose",
            "previousClose",
            "previous_close",
        )
        open_price = pick(fast, "regularMarketOpen", "open")
        day_low = pick(fast, "regularMarketDayLow", "dayLow", "low")
        day_high = pick(fast, "regularMarketDayHigh", "dayHigh", "high")
        volume = pick(fast, "lastVolume", "regularMarketVolume", "volume")
        bid = pick(fast, "bid")
        ask = pick(fast, "ask")
        change = pick(fast, "regularMarketChange")
        change_percent = pick(fast, "regularMarketChangePercent")

        needs_info_fallback = (
            current_price is None
            or ("session" in requested and previous_close is None)
            or ("session" in requested and open_price is None)
            or ("session" in requested and day_low is None)
            or ("session" in requested and day_high is None)
            or ("volume" in requested and volume is None)
            or ("quote" in requested and (bid is None or ask is None))
            or ("session" in requested and change_percent is None)
        )

        if needs_info_fallback:
            try:
                info = yf_ticker.get_info() or {}
            except Exception:
                info = {}

            if current_price is None:
                current_price = pick(info, "currentPrice", "regularMarketPrice")
            if "session" in requested:
                if previous_close is None:
                    previous_close = pick(
                        info,
                        "regularMarketPreviousClose",
                        "previousClose",
                    )
                if open_price is None:
                    open_price = pick(info, "regularMarketOpen", "open")
                if day_low is None:
                    day_low = pick(info, "regularMarketDayLow", "dayLow")
                if day_high is None:
                    day_high = pick(info, "regularMarketDayHigh", "dayHigh")
                if change is None:
                    change = pick(info, "regularMarketChange")
                if change_percent is None:
                    change_percent = pick(info, "regularMarketChangePercent")
            if "volume" in requested and volume is None:
                volume = pick(info, "regularMarketVolume", "volume")
            if "quote" in requested:
                if bid is None:
                    bid = pick(info, "bid")
                if ask is None:
                    ask = pick(info, "ask")

        if change is None and current_price is not None and previous_close is not None:
            change = current_price - previous_close

        if (
            change_percent is None
            and current_price is not None
            and previous_close is not None
            and previous_close != 0
        ):
            change_percent = ((current_price - previous_close) / previous_close) * 100.0

        volume_value = (
            current_price * volume
            if current_price is not None and volume is not None
            else None
        )

        payload = {
            "symbol": normalized,
            "current_price": current_price,
            "previous_close": previous_close if "session" in requested else None,
            "open": open_price if "session" in requested else None,
            "day_low": day_low if "session" in requested else None,
            "day_high": day_high if "session" in requested else None,
            "change": change if "session" in requested else None,
            "change_percent": change_percent if "session" in requested else None,
            "volume": volume if "volume" in requested else None,
            "volume_value": volume_value if "volume" in requested else None,
            "bid": bid if "quote" in requested else None,
            "ask": ask if "quote" in requested else None,
        }

        return payload, int(datetime.now(tz=timezone.utc).timestamp())

    def lookup(self, query: str, count: int) -> list[dict]:
        import yfinance as yf

        lookup_cls = getattr(yf, "Lookup", None)
        if lookup_cls is None:
            raise RuntimeError("Installed yfinance version does not expose Lookup API")

        lookup = lookup_cls(query=query, timeout=30, raise_errors=True)
        frame = lookup.get_all(count=count)
        if frame is None or frame.empty:
            return []

        frame = frame.reset_index()
        rows: list[dict] = []
        records = frame.to_dict(orient="records") if hasattr(frame, "to_dict") else []
        for row in records:
            symbol = str(row.get("symbol") or "").strip().upper()
            if not symbol:
                continue

            company_name = str(
                row.get("longName")
                or row.get("shortName")
                or row.get("name")
                or symbol
            ).strip()
            exchange = str(
                row.get("exchange")
                or row.get("exchDisp")
                or row.get("fullExchangeName")
                or ""
            ).strip()
            instrument_type = str(
                row.get("quoteType") or row.get("type") or "unknown"
            ).strip().lower()

            rows.append(
                {
                    "symbol": symbol,
                    "company_name": company_name,
                    "exchange": exchange,
                    "instrument_type": instrument_type,
                }
            )

        return rows
