from __future__ import annotations

from apscheduler.schedulers.background import BackgroundScheduler

from .core.cache import TTLCache
from .core.config import ALERT_INTERVAL_SECONDS
from .core.history_cache import get_history
from .core.provider import DataProvider
from .services import alerts as alerts_service
from .services import watchlist as watchlist_service


def _refresh_history(provider: DataProvider, ticker: str, interval: str) -> None:
    try:
        get_history(provider, ticker, interval)
    except Exception:
        pass


def create_scheduler(provider: DataProvider, price_cache: TTLCache[float]) -> BackgroundScheduler:
    scheduler = BackgroundScheduler()

    def run_alert_cycle() -> None:
        alerts_service.evaluate_alerts(provider, price_cache)

    def refresh_watched_history() -> None:
        watch_items = watchlist_service.list_watchlist()
        for item in watch_items:
            _refresh_history(provider, item["ticker"], item["interval"])

    scheduler.add_job(
        run_alert_cycle, "interval", seconds=ALERT_INTERVAL_SECONDS, max_instances=1
    )
    scheduler.add_job(refresh_watched_history, "interval", seconds=300, max_instances=1)
    return scheduler
