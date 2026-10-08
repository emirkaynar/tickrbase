from datetime import datetime, timezone

from backend.services.market_context import build_market_context


def ts(value):
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp())


def context(exchange, start, end):
    return build_market_context("TEST", {"exchange": exchange, "instrument_type": "EQUITY"}, ts(start), ts(end))


def test_us_holiday_early_close_and_dst():
    assert context("NMS", "2026-07-03", "2026-07-04")["sessions"] == []
    short = context("NYQ", "2026-11-27", "2026-11-28")["sessions"][0]
    assert short["regular_close"] == ts("2026-11-27T18:00:00")
    before = next(s for s in context("NMS", "2026-03-06", "2026-03-07")["sessions"] if s["trading_date"] == "2026-03-06")
    after = next(s for s in context("NMS", "2026-03-09", "2026-03-10")["sessions"] if s["trading_date"] == "2026-03-09")
    assert before["regular_open"] == ts("2026-03-06T14:30:00")
    assert after["regular_open"] == ts("2026-03-09T13:30:00")


def test_bist_holiday_and_half_day():
    assert context("IST", "2026-10-29", "2026-10-30")["sessions"] == []
    short = context("IST", "2026-10-28", "2026-10-29")["sessions"][0]
    assert short["regular_open"] == ts("2026-10-28T07:00:00")
    assert short["regular_close"] == ts("2026-10-28T09:30:00")


def test_europe_and_unknown_instruments():
    for exchange, name in [("LSE", "XLON"), ("GER", "XETR"), ("PAR", "XPAR")]:
        result = context(exchange, "2026-10-07", "2026-10-08")
        assert result["exchange"] == name
        assert len(result["sessions"]) == 1
    result = build_market_context("AAPL", {}, ts("2026-10-07"), ts("2026-10-08"))
    assert result["exchange"] is None
    assert result["sessions"] == []
    crypto = build_market_context("BTC-USD", {"exchange": "NMS", "instrument_type": "CRYPTOCURRENCY"}, ts("2026-10-07"), ts("2026-10-08"))
    assert crypto["exchange"] is None


def test_expired_calendar_is_explicit():
    result = context("IST", "2035-01-02", "2035-01-03")
    assert result["sessions"] == []
    assert result["calendar_coverage"]["to"] < ts("2035-01-02")
