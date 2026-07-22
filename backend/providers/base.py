from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..schemas.models import Candle


class DataProvider(ABC):
    @abstractmethod
    def get_price(self, ticker: str) -> tuple[float, int]:
        """Fetch current price for a symbol. Returns (price, timestamp_seconds)."""
        pass

    @abstractmethod
    def get_history(
        self,
        ticker: str,
        interval: str,
        period: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> list[Candle]:
        """Fetch historical candles for a symbol."""
        pass

    @abstractmethod
    def get_company_info(self, ticker: str) -> dict:
        """Fetch general info about a symbol."""
        pass

    @abstractmethod
    def get_quote_snapshot(
        self,
        ticker: str,
        groups: set[str] | None = None,
    ) -> tuple[dict, int]:
        """Fetch structured quote payload for a symbol."""
        pass

    @abstractmethod
    def lookup(self, query: str, count: int) -> list[dict]:
        """Search symbol universe."""
        pass
