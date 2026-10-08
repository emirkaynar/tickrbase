import { describe, expect, it } from "vitest";
import type { MarketContext } from "../../../services/types";
import { BarStore, tickBucket } from "../barStore";
import { candleContext, extendedQuote, historySessions, regularBars, sessionBoundaries } from "../sessionPolicy";
import { observationGaps } from "../observationGaps";
import { marketStatus } from "../marketStatus";

const ts = (date: string) => Date.parse(date) / 1000;
const open = ts("2026-10-06T13:30:00Z"), close = ts("2026-10-06T20:00:00Z");
const context: MarketContext = {
    ticker: "TSLA", exchange: "XNAS", instrument_type: "EQUITY", exchange_timezone: "America/New_York", server_time: 0,
    calendar_coverage: { from: ts("2026-01-01"), to: ts("2027-01-01") },
    sessions: [0, 86400].map(offset => ({ trading_date: offset ? "2026-10-07" : "2026-10-06", regular_open: open + offset, regular_close: close + offset,
        windows: [{ kind: "pre", start: open + offset - 19800, end: open + offset }, { kind: "regular", start: open + offset, end: close + offset }, { kind: "post", start: close + offset, end: close + offset + 14400 }],
    })),
};
const tick = (time: number, price = 12) => ({ symbol: "TSLA", ts: time * 1000, price, source: "yahoo", timestamp_origin: "source" as const });
const bar = (time: number) => ({ time, open: 10, high: 10, low: 10, close: 10 });

describe("US regular candle policy", () => {
    it("requests regular US and fallback history while preserving other markets", () => {
        expect(historySessions(context, true)).toBe("regular");
        expect(historySessions({ ...context, instrument_type: "ETF" }, true)).toBe("regular");
        expect(historySessions(null, true)).toBe("regular");
        expect(historySessions({ ...context, exchange: null }, true)).toBe("regular");
        expect(historySessions({ ...context, exchange: "XIST" }, true)).toBe("extended");
        expect(historySessions({ ...context, exchange: "XIST" }, false)).toBe("regular");
    });
    it("rejects extended and unclassified ticks while admitting regular ticks", () => {
        expect(tickBucket(open - 60, "5m", context, null)).toBeNull();
        expect(tickBucket(close, "5m", context, null)).toBeNull();
        expect(tickBucket(close + 18000, "5m", context, null)).toBeNull();
        expect(tickBucket(open + 60, "5m", null, null)).toBeNull();
        expect(tickBucket(open + 60, "5m", { ...context, exchange: null }, null)).toBeNull();
        expect(tickBucket(open + 60, "5m", context, null)).toBe(open);
    });
    it("filters retained extended history and buffered ticks before display", () => {
        const store = new BarStore("1m");
        store.mergeHistory([bar(open - 60), bar(open), bar(close)], null, "yahoo");
        store.addTick(tick(close + 60), context);
        expect(store.bars(context)).toEqual([bar(open)]);
        expect(regularBars([bar(open), bar(close)], { ...context, instrument_type: "INDEX" })).toHaveLength(2);
    });
    it("does not add pre-market gaps or future session boundaries", () => {
        const bars = [bar(close - 60), bar(open + 86400)];
        expect(observationGaps(bars, "1m", candleContext(context))).toEqual([]);
        expect(sessionBoundaries([bar(open), bar(close - 60)], context)).toEqual([open, close]);
    });
});

describe("active extended quote", () => {
    it("changes from PRE to regular to POST to OVERNIGHT without carrying the previous phase", () => {
        expect(extendedQuote(context, tick(open - 60), (open - 30) * 1000)?.kind).toBe("pre");
        expect(extendedQuote(context, tick(open - 60), open * 1000)).toBeNull();
        expect(extendedQuote(context, tick(close + 10), (close + 20) * 1000)?.kind).toBe("post");
        expect(extendedQuote(context, tick(close + 10), (close + 14400) * 1000)).toBeNull();
        const overnight = close + 14400 + 60;
        expect(extendedQuote(context, tick(overnight), (overnight + 3600) * 1000)).toMatchObject({ kind: "overnight", stale: true });
        expect(extendedQuote(context, tick(overnight), (open + 86400 - 19800) * 1000)).toBeNull();
    });
    it("rejects delayed previous-session, synthetic, future, invalid and different-symbol quotes", () => {
        const now = (open + 86400 - 60) * 1000;
        expect(extendedQuote(context, tick(open - 60), now)).toBeNull();
        expect(extendedQuote(context, { ...tick(open + 86400 - 60), timestamp_origin: "receipt" }, now)).toBeNull();
        expect(extendedQuote(context, tick(now / 1000 + 6), now)).toBeNull();
        expect(extendedQuote(context, tick(now / 1000, NaN), now)).toBeNull();
        expect(extendedQuote(context, { ...tick(now / 1000), symbol: "NVDA" }, now)).toBeNull();
    });
    it("respects an early close and closes the label on holidays", () => {
        const early = { ...context, sessions: [{ ...context.sessions[0], regular_close: close - 10800, windows: context.sessions[0].windows.slice(0, 2).map(window => window.kind === "regular" ? { ...window, end: close - 10800 } : window) }] };
        expect(extendedQuote(early, tick(close - 10800 + 60), (close - 10800 + 60) * 1000)).toBeNull();
        expect(extendedQuote({ ...context, sessions: [] }, tick(open - 60), (open - 60) * 1000)).toBeNull();
    });
    it("keeps overnight identity across midnight and the daylight-saving change", () => {
        const before = ts("2026-11-01T00:30:00Z"); // Oct 31, 20:30 EDT
        const after = ts("2026-11-01T07:30:00Z"); // Nov 1, 02:30 EST
        expect(extendedQuote(context, tick(before), after * 1000)?.kind).toBe("overnight");
        expect(extendedQuote(context, tick(before), (after + 86400) * 1000)).toBeNull();
        expect(extendedQuote({ ...context, calendar_coverage: null }, tick(before), after * 1000)).toBeNull();
    });
    it("reports stale extended quotes even with regular-only history coverage", () => {
        const coverage = { sessions: ["regular" as const], overnight_history: false, delay_seconds: null };
        const status = marketStatus(context, tick(open - 120), coverage, (open - 30) * 1000);
        expect(status.stale).toBe(true);
        expect(status.delayed).toBe(false);
    });
});
