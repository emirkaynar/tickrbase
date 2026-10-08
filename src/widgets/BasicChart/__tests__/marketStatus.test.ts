import { describe, expect, it } from "vitest";
import { marketStatus } from "../marketStatus";
import type { MarketContext, DataCoverage } from "../../../services/types";

const context: MarketContext = { ticker: "TEST", exchange: "XNYS", exchange_timezone: "America/New_York", instrument_type: "EQUITY", server_time: 0, calendar_coverage: { from: 0, to: 5000 }, sessions: [{ trading_date: "test", regular_open: 100, regular_close: 1000, windows: [{ kind: "regular", start: 100, end: 1000 }] }] };
const coverage: DataCoverage = { sessions: ["regular"], overnight_history: false, delay_seconds: null };
const tick = { symbol: "TEST", price: 1, ts: 200_000, source: "test", timestamp_origin: "source" as const };

describe("market status", () => {
    it("marks stale after 60 seconds without claiming a delayed feed", () => {
        expect(marketStatus(context, tick, coverage, 260_000).stale).toBe(false);
        const status = marketStatus(context, tick, coverage, 261_000);
        expect(status.stale).toBe(true);
        expect(status.delayed).toBe(false);
    });
    it("does not mark old quotes stale outside scheduled sessions", () => {
        const status = marketStatus(context, tick, coverage, 1100_000);
        expect(status.stale).toBe(false);
        expect(status.label).toBe("Closed");
    });
    it("does not measure quote age from synthetic timestamps or future prices", () => {
        expect(marketStatus(context, { ...tick, timestamp_origin: "receipt" }, coverage, 300_000).age).toBeNull();
        expect(marketStatus(context, tick, coverage, 100_000).age).toBeNull();
    });
    it("shows unknown outside calendar coverage and confirmed delay separately", () => {
        expect(marketStatus(context, tick, coverage, 6000_000).label).toBe("Session unknown");
        expect(marketStatus(context, tick, { ...coverage, delay_seconds: 900 }, 220_000).delayed).toBe(true);
    });
});
