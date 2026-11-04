from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore
from ..core.telemetry import adjust, increment

_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="market-provider")
_capacity = BoundedSemaphore(32)


async def _bounded_call(fn, *args):
    # Keep the slot until the synchronous call truly ends, even after timeout.
    if not _capacity.acquire(blocking=False):
        increment("provider_rejected")
        raise RuntimeError("Market provider capacity exhausted")
    try:
        future = _executor.submit(fn, *args)
    except BaseException:
        _capacity.release()
        raise
    adjust("provider_inflight", 1)
    def completed(result):
        _capacity.release()
        adjust("provider_inflight", -1)
        increment("provider_failed" if result.cancelled() or result.exception() else "provider_completed")
    future.add_done_callback(completed)
    return await asyncio.wait_for(asyncio.wrap_future(future), timeout=12)


if TYPE_CHECKING:
    from ..schemas.models import Candle


class DataProvider(ABC):
    source_id = "unknown"

    def normalize_symbol(self, ticker: str) -> str:
        return ticker.strip().upper()

    def history_capabilities(self, sessions: str = "regular") -> dict:
        return {"sessions": ["regular"], "overnight_history": None, "delay_seconds": None}

    def history_range(self, interval: str) -> str | None:
        return None

    def get_market_metadata(self, ticker: str) -> dict:
        return {}

    async def get_market_metadata_async(self, ticker: str) -> dict:
        return await _bounded_call(self.get_market_metadata, ticker)

    @abstractmethod
    def get_price(self, ticker: str) -> tuple[float, int]:
        """Fetch current price for a symbol. Returns (price, timestamp_seconds)."""
        pass

    async def get_price_async(self, ticker: str) -> tuple[float, int]:
        return await _bounded_call(self.get_price, ticker)

    @abstractmethod
    def get_history(
        self,
        ticker: str,
        interval: str,
        period: str | None = None,
        start: int | None = None,
        end: int | None = None,
        sessions: str = "regular",
    ) -> list[Candle]:
        """Fetch historical candles for a symbol."""
        pass

    async def get_history_async(
        self,
        ticker: str,
        interval: str,
        period: str | None = None,
        start: int | None = None,
        end: int | None = None,
        sessions: str = "regular",
    ) -> list[Candle]:
        return await _bounded_call(
            self.get_history, ticker, interval, period, start, end, sessions
        )

    @abstractmethod
    def get_company_info(self, ticker: str) -> dict:
        """Fetch general info about a symbol."""
        pass

    async def get_company_info_async(self, ticker: str) -> dict:
        return await _bounded_call(self.get_company_info, ticker)

    @abstractmethod
    def get_quote_snapshot(
        self,
        ticker: str,
        groups: set[str] | None = None,
    ) -> tuple[dict, int]:
        """Fetch structured quote payload for a symbol."""
        pass

    async def get_quote_snapshot_async(
        self,
        ticker: str,
        groups: set[str] | None = None,
    ) -> tuple[dict, int]:
        return await _bounded_call(self.get_quote_snapshot, ticker, groups)

    @abstractmethod
    def lookup(self, query: str, count: int) -> list[dict]:
        """Search symbol universe."""
        pass

    async def lookup_async(self, query: str, count: int) -> list[dict]:
        return await _bounded_call(self.lookup, query, count)

