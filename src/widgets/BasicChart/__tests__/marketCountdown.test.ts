import { describe, expect, it } from "vitest";
import type { MarketContext, SessionWindow } from "../../../services/types";
import { marketCountdown, marketStatus } from "../marketStatus";

const window = (kind: SessionWindow["kind"], start: number, end: number): SessionWindow => ({ kind, start, end });
const calendar = (windows: SessionWindow[], to = 30_000): MarketContext => ({
    ticker: "TEST", exchange: "XIST", exchange_timezone: "Europe/Istanbul", instrument_type: "EQUITY", server_time: 0,
    calendar_coverage: { from: 0, to },
    sessions: [{ trading_date: "test", regular_open: 5000, regular_close: 10_000, windows }],
});
const countdown = (context: MarketContext | null, now: number) => marketCountdown(
    context, marketStatus(context, null, null, now * 1000), now * 1000,
);

describe("market countdown", () => {
    it.each([
        [3600, null], [901, null], [900, null], [899, "14m to close"], [240, "4m to close"],
        [60, "1m to close"], [59, "<1m to close"], [1, "<1m to close"], [0, null],
    ])("formats %s seconds remaining as %s", (remaining, text) => {
        const result = countdown(calendar([window("regular", 5000, 10_000)]), 10_000 - remaining);
        expect(result?.text ?? null).toBe(text);
        if (result) expect(result.nextSession).toBe("closed");
    });

    it.each([
        ["regular", "open"], ["pre", "pre"], ["post", "post"], ["overnight", "overnight"],
    ] as const)("names the next %s opening", (kind, target) => {
        expect(countdown(calendar([window(kind, 5000, 10_000)]), 4760)).toMatchObject({ text: `4m to ${target}`, nextSession: kind });
    });

    it("names the destination of adjacent sessions and recomputes at the boundary", () => {
        const context = calendar([window("pre", 1000, 5000), window("regular", 5000, 6000)]);
        expect(countdown(context, 4760)).toMatchObject({ text: "4m to open", label: "Market opens in 4 minutes" });
        expect(countdown(context, 5000)).toBeNull();
                expect(countdown(context, 5101)?.text).toBe("14m to close");
    });

    it("uses the adjacent post-market destination rather than a generic ending", () => {
        const context = calendar([window("regular", 5000, 10_000), window("post", 10_000, 20_000)]);
        expect(countdown(context, 9760)?.text).toBe("4m to post");
    });

    it.each(["pre", "post", "overnight"] as const)("labels a %s ending without inventing a next session", kind => {
        expect(countdown(calendar([window(kind, 5000, 10_000)]), 9760)).toMatchObject({ text: "4m to end", nextSession: "closed" });
    });

    it("allows a supplied closing boundary at the coverage endpoint but not an opening", () => {
        expect(countdown(calendar([window("regular", 5000, 10_000)], 10_000), 9760)?.text).toBe("4m to close");
        expect(countdown(calendar([window("regular", 10_000, 20_000)], 10_000), 9760)).toBeNull();
        expect(countdown(calendar([window("regular", 5000, 20_000)], 10_000), 9760)).toBeNull();
    });

    it("hides countdowns for missing, expired or empty calendars", () => {
        expect(countdown(null, 9760)).toBeNull();
        expect(countdown(calendar([]), 9760)).toBeNull();
        expect(countdown(calendar([window("regular", 5000, 10_000)], 9000), 9760)).toBeNull();
    });

    it("does not show a weekend opening more than an hour away", () => {
        expect(countdown(calendar([window("regular", 200_000, 220_000)], 300_000), 10_000)).toBeNull();
    });

    it("does not infer countdowns from unverified overnight activity", () => {
        const context = { ...calendar([window("pre", 5000, 10_000)]), exchange: "XNYS", exchange_timezone: "UTC" };
        const status = { ...marketStatus(context, null, null, 4760_000), label: "Overnight activity · venue unverified" };
        expect(marketCountdown(context, status, 4760_000)).toBeNull();
    });
});
