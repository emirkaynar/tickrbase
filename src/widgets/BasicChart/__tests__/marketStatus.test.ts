import { describe, expect, it } from "vitest";
import { marketStatus, marketTooltip } from "../marketStatus";
import type { LiveTick } from "../../../services/livePrices";
import type { MarketContext, DataCoverage } from "../../../services/types";

const context: MarketContext = { ticker: "TEST", exchange: "XNYS", exchange_timezone: "America/New_York", instrument_type: "EQUITY", server_time: 0, calendar_coverage: { from: 0, to: 5000 }, sessions: [{ trading_date: "test", regular_open: 100, regular_close: 1000, windows: [{ kind: "regular", start: 100, end: 1000 }] }] };
const coverage: DataCoverage = { sessions: ["regular"], overnight_history: false, delay_seconds: null };
const tick = { symbol: "TEST", price: 1, ts: 200_000, source: "test", timestamp_origin: "source" as const };

describe("market status", () => {
    it("reports source lag beyond the 60-second tolerance", () => {
        expect(marketStatus(context, tick, coverage, 260_000).stale).toBe(false);
        const status = marketStatus(context, tick, coverage, 261_000);
        expect(status.stale).toBe(true);
        expect(status.delayed).toBe(true);
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
        expect(marketStatus(context, tick, { ...coverage, delay_seconds: 900 }, 220_000).delayed).toBe(false);
    });
});

const seconds = (iso: string) => Date.parse(iso) / 1000;
const calendar: MarketContext = {
    ...context,
    calendar_coverage: { from: seconds("2026-10-08T00:00:00Z"), to: seconds("2026-10-10T00:00:00Z") },
    sessions: [{
        trading_date: "2026-10-08", regular_open: seconds("2026-10-08T13:30:00Z"), regular_close: seconds("2026-10-08T20:00:00Z"),
        windows: [
            { kind: "pre", start: seconds("2026-10-08T08:00:00Z"), end: seconds("2026-10-08T13:30:00Z") },
            { kind: "regular", start: seconds("2026-10-08T13:30:00Z"), end: seconds("2026-10-08T16:00:00Z") },
            { kind: "regular", start: seconds("2026-10-08T17:00:00Z"), end: seconds("2026-10-08T20:00:00Z") },
            { kind: "post", start: seconds("2026-10-08T20:00:00Z"), end: seconds("2026-10-09T00:00:00Z") },
            { kind: "overnight", start: seconds("2026-10-09T00:00:00Z"), end: seconds("2026-10-09T08:00:00Z") },
        ],
    }],
};
const at = (iso: string) => Date.parse(iso);

describe("source timestamp delay", () => {
    it.each([0, 30, 60, 61, 900])("measures %s seconds of quote lag with a 60-second tolerance", lag => {
        const status = marketStatus(context, { ...tick, ts: 950_000 - lag * 1000 }, coverage, 950_000);
        expect(status.delaySeconds).toBe(lag);
        expect(status.delayed).toBe(lag > 60);
    });
    it("does not classify an idle closed market as delayed", () => {
        expect(marketStatus(context, tick, coverage, 1100_000)).toMatchObject({ delayed: false, delaySeconds: 900 });
    });
    it("requires a trusted source stamp, not receipt time or declared feed metadata", () => {
        expect(marketStatus(context, null, { ...coverage, delay_seconds: 900 }, 950_000).delaySeconds).toBeNull();
        expect(marketStatus(context, { ...tick, timestamp_origin: "receipt" }, coverage, 950_000).delaySeconds).toBeNull();
    });
});

describe("market presentation", () => {
    it("adds calendar facts without changing existing status fields", () => {
        expect(marketStatus(context, tick, coverage, 261_000)).toEqual({
            label: "Regular session", stale: true, delayed: true, age: 61, next: 1000, current: "regular",
            known: true, window: context.sessions[0].windows[0], nextOpen: null, delaySeconds: 61,
        });
    });

    it.each([
        [900, 60, 900], [0, 900, 0], [undefined, 900, 900], [null, 0, 0],
        [-1, 60, 60], [NaN, 60, 60], [Infinity, 60, 60], [undefined, null, null],
        [undefined, -1, null], [undefined, NaN, null], [undefined, Infinity, null],
    ])("ignores tick delay %s and coverage delay %s in favor of source age", (tickDelay, coverageDelay, _expected) => {
        const quote: LiveTick = { ...tick, delay_seconds: tickDelay };
        expect(marketStatus(context, quote, { ...coverage, delay_seconds: coverageDelay }, 220_000).delaySeconds).toBe(20);
    });

    it("ignores invalid provider metadata when the source stamp is current", () => {
        const result = marketStatus(context, { ...tick, delay_seconds: Infinity }, coverage, 220_000);
        expect(result.delayed).toBe(false);
        expect(result.delaySeconds).toBe(20);
    });

    it("shows the actual delay, closing countdown and exchange-local segment range", () => {
        expect(marketTooltip(calendar, { ...tick, ts: at("2026-10-08T13:31:00Z") }, coverage, at("2026-10-08T13:46:00Z"))).toEqual({
            title: "Market open · 15m delayed", timing: "Closes in 2h 14m",
            range: "Regular session: 09:30–12:00", timezone: "Exchange time · America/New_York", session: "regular", known: true,
        });
    });

    it.each([
        [null, "Market open · Delay unknown"], [0, "Market open"], [30, "Market open"],
        [120, "Market open · 2m delayed"], [3660, "Market open · 1h 1m delayed"],
    ])("communicates delay %s without promising real-time data", (delay, title) => {
        const now = at("2026-10-08T13:46:00Z");
                const tooltip = marketTooltip(calendar, delay === null ? null : { ...tick, ts: now - delay * 1000 }, coverage, now);
        expect(tooltip.title).toBe(title);
        expect(tooltip.timing).toBe("Closes in 2h 14m");
        expect(tooltip.range).toBe("Regular session: 09:30–12:00");
        expect(tooltip.timezone).toBe("Exchange time · America/New_York");
    });

    it.each([
        ["2026-10-08T09:00:00Z", "pre", "Pre-market", "Ends in 4h 30m"],
        ["2026-10-08T21:00:00Z", "post", "Post-market", "Ends in 3h 0m"],
        ["2026-10-09T02:00:00Z", "overnight", "Overnight session", "Ends in 6h 0m"],
    ])("presents verified %s sessions", (time, session, title, timing) => {
        const tooltip = marketTooltip(calendar, null, coverage, at(time));
        expect(tooltip).toMatchObject({ session, title: `${title} · Delay unknown`, timing, known: true });
    });

    it.each([
        ["2026-10-08T09:00:00Z", "Pre-market"],
        ["2026-10-08T21:00:00Z", "Post-market"],
        ["2026-10-09T02:00:00Z", "Overnight session"],
        ["2026-10-08T16:00:00Z", "Market closed"],
    ])("omits the zero-delay suffix for %s", (time, title) => {
        expect(marketTooltip(calendar, { ...tick, ts: at(time) }, coverage, at(time)).title).toBe(title);
    });

    it("treats a break as closed and uses the next start, not an arbitrary end", () => {
        const now = at("2026-10-08T16:00:00Z");
        const status = marketStatus(calendar, null, coverage, now);
        expect(status.window).toBeNull();
        expect(status.nextOpen).toBe(seconds("2026-10-08T17:00:00Z"));
        expect(marketTooltip(calendar, null, coverage, now)).toEqual({
            title: "Market closed · Delay unknown", timing: "Opens Oct 8, 2026, 13:00 · America/New_York",
            range: null, timezone: "Exchange time · America/New_York", session: "closed", known: true,
        });
    });

    it("finds the earliest opening across all sessions even in unsorted calendars", () => {
        const unsorted = { ...calendar, sessions: calendar.sessions.map(s => ({ ...s, windows: [...s.windows].reverse() })) };
        expect(marketStatus(unsorted, null, coverage, at("2026-10-08T07:00:00Z")).nextOpen).toBe(seconds("2026-10-08T08:00:00Z"));
        expect(marketStatus(calendar, null, coverage, at("2026-10-09T08:00:00Z")).nextOpen).toBeNull();
    });

    it("distinguishes the next boundary from the next opening while open", () => {
        expect(marketStatus(calendar, null, coverage, at("2026-10-08T14:00:00Z"))).toMatchObject({
            next: seconds("2026-10-08T16:00:00Z"), nextOpen: seconds("2026-10-08T17:00:00Z"),
        });
        expect(marketTooltip(calendar, null, coverage, at("2026-10-08T17:00:00Z")))
            .toMatchObject({ session: "regular", timing: "Closes in 3h 0m", range: "Regular session: 13:00–16:00" });
    });

    it("finds next-day pre-market across unsorted trading dates", () => {
        const start = seconds("2026-10-09T10:00:00Z");
        const data: MarketContext = { ...calendar, sessions: [{
            trading_date: "2026-10-09", regular_open: start + 3600, regular_close: start + 7200,
            windows: [{ kind: "pre", start, end: start + 3600 }],
        }, ...calendar.sessions] };
        const now = at("2026-10-09T08:00:00Z");
        expect(marketStatus(data, null, coverage, now).nextOpen).toBe(start);
        expect(marketTooltip(data, null, coverage, now).timing).toBe("Opens Oct 9, 2026, 06:00 · America/New_York");
    });

    it("uses tick delay in the tooltip and keeps missing feed metadata unknown", () => {
        expect(marketTooltip(context, { ...tick, delay_seconds: 0 }, { ...coverage, delay_seconds: 900 }, 220_000).title)
            .toBe("Market open");
        expect(marketTooltip(context, null, null, 220_000).title).toBe("Market open · Delay unknown");
    });

    it("includes both local dates when a window crosses midnight", () => {
        expect(marketTooltip(calendar, null, coverage, at("2026-10-09T02:00:00Z")).range)
            .toBe("Overnight session: Oct 8, 2026, 20:00–Oct 9, 2026, 04:00");
    });

    it("does not claim a session outside coverage or without a calendar", () => {
        for (const data of [null, { ...calendar, calendar_coverage: null }, calendar]) {
            expect(marketTooltip(data, null, coverage, at("2026-10-10T00:00:00Z"))).toMatchObject({
                title: "Session unknown · Delay unknown", session: null, known: false, timing: null, range: null,
            });
            expect(marketStatus(data, null, coverage, at("2026-10-10T00:00:00Z"))).toMatchObject({
                known: false, window: null, nextOpen: null, next: null,
            });
        }
    });

    it("keeps unverified overnight activity explanatory rather than assigning a pill session", () => {
        const data = { ...calendar, sessions: [] };
        const now = at("2026-10-09T02:00:00Z");
        expect(marketTooltip(data, { ...tick, ts: now }, coverage, now)).toMatchObject({
            title: "Overnight activity · venue unverified", session: null, known: true, range: null,
        });
    });

    it("restricts next boundaries and openings to the exclusive coverage horizon", () => {
        const data = { ...calendar, calendar_coverage: { from: seconds("2026-10-08T00:00:00Z"), to: seconds("2026-10-08T17:00:00Z") } };
        expect(marketStatus(data, null, coverage, at("2026-10-08T16:00:00Z"))).toMatchObject({ next: null, nextOpen: null });
        expect(marketTooltip(data, null, coverage, at("2026-10-08T16:00:00Z")).timing).toBeNull();
    });

    it("does not show full ranges or closing estimates outside known coverage", () => {
        const data = { ...calendar, calendar_coverage: { from: seconds("2026-10-08T14:00:00Z"), to: seconds("2026-10-08T15:00:00Z") } };
        const now = at("2026-10-08T14:30:00Z");
        expect(marketStatus(data, null, coverage, now).window).toBe(calendar.sessions[0].windows[1]);
        expect(marketTooltip(data, null, coverage, now)).toMatchObject({ session: "regular", timing: null, range: null });
    });

    it("uses a supplied closing boundary at the coverage end without extrapolating", () => {
        const data = { ...calendar, calendar_coverage: { from: seconds("2026-10-08T00:00:00Z"), to: seconds("2026-10-08T16:00:00Z") } };
        expect(marketTooltip(data, null, coverage, at("2026-10-08T15:59:30Z"))).toMatchObject({
            timing: "Closes in 0h 1m", range: "Regular session: 09:30–12:00",
        });
    });

    it("does not fabricate local times when the exchange timezone is missing", () => {
        expect(marketTooltip({ ...calendar, exchange_timezone: null }, null, coverage, at("2026-10-08T16:00:00Z")))
            .toMatchObject({ timing: null, range: null, timezone: null, session: "closed" });
    });

    it("retains verified remaining time even without an exchange timezone", () => {
        expect(marketTooltip({ ...calendar, exchange_timezone: null }, null, coverage, at("2026-10-08T14:00:00Z")))
            .toMatchObject({ timing: "Closes in 2h 0m", range: null, timezone: null });
    });

    it("uses the exchange timezone's actual DST offset", () => {
        const data: MarketContext = { ...calendar,
            calendar_coverage: { from: seconds("2026-11-02T00:00:00Z"), to: seconds("2026-11-03T00:00:00Z") },
            sessions: [{ trading_date: "2026-11-02", regular_open: seconds("2026-11-02T14:30:00Z"), regular_close: seconds("2026-11-02T21:00:00Z"),
                windows: [{ kind: "regular", start: seconds("2026-11-02T14:30:00Z"), end: seconds("2026-11-02T21:00:00Z") }] }],
        };
        expect(marketTooltip(data, null, coverage, at("2026-11-02T14:00:00Z")).timing).toBe("Opens Nov 2, 2026, 09:30 · America/New_York");
    });
});
