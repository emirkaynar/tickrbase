"""Fixed-name resource counters; never accept user-derived metric dimensions."""
from collections import Counter
from threading import Lock

_lock = Lock()
_values = Counter()
_NAMES = frozenset({
    'cache_get_hit', 'cache_get_miss', 'cache_read_failed', 'cache_write_failed',
    'singleflight_joined', 'singleflight_rejected', 'provider_inflight',
    'provider_rejected', 'provider_failed', 'provider_completed',
    'logo_provider_attempt', 'logo_provider_failed', 'logo_budget_rejected',
    'logo_coalesced', 'logo_inflight', 'logo_missing', 'logo_cache_hit',
})


def adjust(name: str, delta: int):
    if name not in _NAMES:
        raise ValueError('Unknown metric name')
    with _lock:
        _values[name] += delta


def increment(name: str):
    adjust(name, 1)


def snapshot():
    with _lock:
        return {name: _values[name] for name in sorted(_NAMES)}
