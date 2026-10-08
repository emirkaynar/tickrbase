import { describe, expect, it } from "vitest";
import { observationGaps, gapWhitespace } from "../observationGaps";
import type { MarketContext } from "../../../services/types";
const bars = [60, 120, 600, 1200].map(time => ({ time, open: 1, high: 1, low: 1, close: 1 }));
const context: MarketContext = { ticker: "TEST", exchange: "XNYS", instrument_type: "EQUITY", exchange_timezone: "America/New_York", server_time: 0, calendar_coverage: { from: 0, to: 2000 }, sessions: [{ trading_date: "test", regular_open: 60, regular_close: 660, windows: [{ kind: "regular", start: 60, end: 660 }] }] };
describe("observation gaps", () => {
    it("shows missing scheduled observations without flagging closed periods", () => {
        const gaps = observationGaps(bars, "1m", context);
        expect(gaps).toEqual([{ start: 180, end: 600 }]);
        expect(gapWhitespace(gaps, "1m")).toEqual([180, 240, 300, 360, 420, 480, 540]);
    });
    it("does not invent session coverage for unknown instruments or daily bars", () => {
        expect(observationGaps(bars, "1m", null)).toEqual([]);
        expect(observationGaps(bars, "1d", context)).toEqual([]);
    });
});
