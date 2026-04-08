from __future__ import annotations

from apscheduler.schedulers.background import BackgroundScheduler

from .core.cache import TTLCache
from .core.config import ALERT_INTERVAL_SECONDS
from .core.provider import DataProvider
from .services import alerts as alerts_service


def create_scheduler(provider: DataProvider, price_cache: TTLCache[float]) -> BackgroundScheduler:
    scheduler = BackgroundScheduler()

    def run_alert_cycle() -> None:
        alerts_service.evaluate_alerts(provider, price_cache)

    scheduler.add_job(
        run_alert_cycle, "interval", seconds=ALERT_INTERVAL_SECONDS, max_instances=1
    )
    return scheduler
