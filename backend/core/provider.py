from __future__ import annotations

from abc import ABC, abstractmethod

from .models import Candle


class DataProvider(ABC):
    @abstractmethod
    def get_price(self, ticker: str) -> tuple[float, int]:
        raise NotImplementedError

    @abstractmethod
    def get_history(
        self,
        ticker: str,
        interval: str,
        period: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> list[Candle]:
        raise NotImplementedError

    @abstractmethod
    def get_company_info(self, ticker: str) -> dict:
        raise NotImplementedError

    @abstractmethod
    def get_quote_snapshot(
        self,
        ticker: str,
        groups: set[str] | None = None,
    ) -> tuple[dict, int]:
        raise NotImplementedError

    @abstractmethod
    def lookup(self, query: str, count: int) -> list[dict]:
        raise NotImplementedError
