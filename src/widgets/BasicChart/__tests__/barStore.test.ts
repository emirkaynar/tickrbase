import { describe, expect, it } from "vitest";
import { BarStore, exchangeMidnight, tickBucket } from "../barStore";
import type { MarketContext } from "../../../services/types";

const bar = (time: number, close = 10) => ({ time, open: close, high: close, low: close, close });
const tick = (ts: number, price = 12) => ({ symbol: "TEST", ts: ts * 1000, price, source: "test", timestamp_origin: "source" as const });
const intradayContext: MarketContext = { ticker: "TEST", exchange: "XIST", instrument_type: "EQUITY", exchange_timezone: "Europe/Istanbul", sessions: [], calendar_coverage: null, server_time: 0 };

describe("history and live reconciliation", () => {
    it("repairs older gaps after a live tick has advanced the chart", () => {
        const store = new BarStore("1m");
        store.mergeHistory([bar(60)], 90_000, "test");
        store.addTick(tick(600), intradayContext);
        expect(store.historySince()).toBe(-60);
        store.mergeHistory([bar(120), bar(180)], 240_000, "test");
        expect(store.bars().map(b => b.time)).toEqual([60, 120, 180, 600]);
        expect(store.bars().at(-1)?.open).toBe(12);
    });

    it("buffers ticks before history and replays ticks newer than its snapshot", () => {
        const store = new BarStore("1m");
        store.addTick(tick(125, 15), intradayContext);
        store.mergeHistory([bar(120)], 123_000, "test");
        expect(store.bars().at(-1)).toEqual({ time: 120, open: 10, high: 15, low: 10, close: 15 });
        store.mergeHistory([bar(120, 14)], 130_000, "test");
        expect(store.bars().at(-1)?.close).toBe(14);
    });

    it("rejects duplicate and out-of-order prices", () => {
        const store = new BarStore("1m");
        expect(store.addTick(tick(125), intradayContext)).toBe(true);
        expect(store.addTick(tick(124, 99), intradayContext)).toBe(false);
        expect(store.addTick(tick(125, 99), intradayContext)).toBe(false);
        expect(store.bars().at(-1)?.close).toBe(12);
    });

    it("isolates sources instead of mixing their candles", () => {
        const store = new BarStore("1m");
        store.mergeHistory([bar(60)], 90_000, "first");
        store.mergeHistory([bar(120, 20)], 130_000, "second");
        expect(store.bars()).toEqual([bar(120, 20)]);
        expect(store.addTick(tick(180), null)).toBe(false);
    });

    it("uses exchange trading dates and leaves extended prices out of daily candles", () => {
        const opened = Date.parse("2026-10-07T07:00:00Z") / 1000;
        const closed = Date.parse("2026-10-07T15:00:00Z") / 1000;
        const context: MarketContext = { ticker: "TEST", exchange: "XIST", instrument_type: "EQUITY", exchange_timezone: "Europe/Istanbul", server_time: 0, calendar_coverage: null, sessions: [{ trading_date: "2026-10-07", regular_open: opened, regular_close: closed, windows: [{ kind: "regular", start: opened, end: closed }] }] };
        expect(tickBucket(opened + 60, "1d", context, null)).toBe(Date.parse("2026-10-06T21:00:00Z") / 1000);
        expect(tickBucket(closed + 60, "1d", context, null)).toBeNull();
        expect(tickBucket(opened + 60, "1wk", context, null)).toBe(Date.parse("2026-10-04T21:00:00Z") / 1000);
        expect(exchangeMidnight(2026, 3, 9, "America/New_York")).toBe(Date.parse("2026-03-09T04:00:00Z") / 1000);
    });
});
