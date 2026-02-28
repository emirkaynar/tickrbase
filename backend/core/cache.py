from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass
class CacheEntry(Generic[T]):
    value: T
    fetched_at: int
    ttl_seconds: int

    @property
    def stale(self) -> bool:
        return int(time.time()) - self.fetched_at > self.ttl_seconds


class TTLCache(Generic[T]):
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl_seconds = ttl_seconds
        self._items: dict[str, CacheEntry[T]] = {}

    def get(self, key: str) -> CacheEntry[T] | None:
        return self._items.get(key)

    def set(self, key: str, value: T, fetched_at: int | None = None) -> None:
        self._items[key] = CacheEntry(
            value=value,
            fetched_at=fetched_at or int(time.time()),
            ttl_seconds=self._ttl_seconds,
        )

    def clear(self) -> None:
        self._items.clear()
