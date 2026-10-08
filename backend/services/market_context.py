"""Exchange schedules are independent of a data provider's coverage.

Regular calendars: exchange_calendars 4.13.2. BIST 2026 exceptions are
checked against https://www.borsaistanbul.com/files/equity-market-2026-holiday-schedule.pdf
Extended rules: Nasdaq market-activity/stock-market-holiday-schedule and
cashmarket.deutsche-boerse.com/cash-en/trading/trading-calendar-and-trading-hours.
Dates beyond the reviewed calendar horizon intentionally return unknown.
"""
from datetime import datetime, time, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

import exchange_calendars as xcals

EXCHANGES = {"NMS": "XNAS", "NGM": "XNAS", "NCM": "XNAS", "NASDAQ": "XNAS", "NYQ": "XNYS", "NYSE": "XNYS", "ASE": "XNYS", "PCX": "XNYS", "IST": "XIST", "LSE": "XLON", "GER": "XETR", "XETRA": "XETR", "PAR": "XPAR"}
TIMEZONES = {"XNAS": "America/New_York", "XNYS": "America/New_York", "XIST": "Europe/Istanbul", "XLON": "Europe/London", "XETR": "Europe/Berlin", "XPAR": "Europe/Paris"}
COVERAGE_START = "2000-01-01"
COVERAGE_END = "2026-12-31"
BIST_2026_CLOSED = {"2026-01-01", "2026-03-20", "2026-04-23", "2026-05-01", "2026-05-19", "2026-05-27", "2026-05-28", "2026-05-29", "2026-07-15", "2026-10-29"}
BIST_2026_SHORT = {"2026-03-19", "2026-05-26", "2026-10-28"}


@lru_cache(maxsize=6)
def _calendar(exchange):
    return xcals.get_calendar("XNYS" if exchange == "XNAS" else exchange, start=COVERAGE_START, end=COVERAGE_END)


def build_market_context(ticker: str, metadata: dict, start: int, end: int) -> dict:
    kind = str(metadata.get("instrument_type") or "").upper()
    raw_exchange = str(metadata.get("exchange") or "").upper()
    exchange = EXCHANGES.get(raw_exchange, raw_exchange if raw_exchange in TIMEZONES else None)
    if kind not in {"EQUITY", "ETF", "INDEX"}:
        exchange = None
    result = {"ticker": ticker, "exchange": exchange, "instrument_type": kind or None, "exchange_timezone": TIMEZONES.get(exchange), "sessions": [], "server_time": int(datetime.now(timezone.utc).timestamp() * 1000), "calendar_coverage": None}
    if exchange is None:
        return result
    zone = ZoneInfo(TIMEZONES[exchange])
    floor = int(datetime(2000, 1, 1, tzinfo=zone).timestamp())
    ceiling = int(datetime(2027, 1, 1, tzinfo=zone).timestamp())
    result["calendar_coverage"] = {"from": floor, "to": ceiling}
    if end <= floor or start >= ceiling:
        return result
    start_day = datetime.fromtimestamp(max(start, floor), zone).date()
    end_day = datetime.fromtimestamp(min(end - 1, ceiling - 1), zone).date()
    calendar = _calendar(exchange)
    schedule = calendar.schedule.loc[str(start_day):str(end_day)]
    for day, row in schedule.iterrows():
        label = day.date().isoformat()
        if exchange == "XIST" and label in BIST_2026_CLOSED:
            continue
        opened, closed = int(row["open"].timestamp()), int(row["close"].timestamp())
        if exchange == "XIST" and label in BIST_2026_SHORT:
            closed = int(datetime.combine(day.date(), time(12, 30), zone).timestamp())
        windows = [{"kind": "regular", "start": opened, "end": closed}]
        def local(hour, minute=0):
            return int(datetime.combine(day.date(), time(hour, minute), zone).timestamp())
        if exchange in {"XNAS", "XNYS"} and kind != "INDEX":
            # Early-close extended windows need venue-specific confirmation.
            windows.insert(0, {"kind": "pre", "start": local(4), "end": opened})
            if exchange == "XNAS" and label >= "2026-12-07":
                # Effective 2026-12-06 evening; each overnight belongs to the
                # following trading date. The 20:00–21:00 pause stays closed.
                previous_date = day.date() - timedelta(days=1)
                windows.insert(0, {"kind": "overnight", "start": int(datetime.combine(previous_date, time(21), zone).timestamp()), "end": local(4)})
            if closed == local(16):
                windows.append({"kind": "post", "start": closed, "end": local(20)})
        elif exchange == "XETR" and kind != "INDEX" and label >= "2025-12-01":
            windows.insert(0, {"kind": "pre", "start": local(8), "end": local(8, 55)})
            # Start depends on the closing auction: do not claim an exact boundary.
        if not any(window["start"] < end and window["end"] > start for window in windows):
            continue
        result["sessions"].append({"trading_date": label, "regular_open": opened, "regular_close": closed, "windows": windows})
    return result
