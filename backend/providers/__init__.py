from __future__ import annotations

from .base import DataProvider
from .yahoo import YahooFinanceProvider, normalize_ticker

_default_provider = YahooFinanceProvider()


def get_provider(tier: str = "free") -> DataProvider:
    # Future enhancement: route different tiers to premium providers
    return _default_provider


__all__ = ["DataProvider", "YahooFinanceProvider", "get_provider", "normalize_ticker"]
