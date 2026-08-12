import { describe, expect, it } from "vitest";
import {
    decimateToWeekly,
    decimateToMonthly,
    decimateToYearly,
    decimatePoints,
    getEffectiveInterval,
    formatIntervalDate,
} from "../chartHelpers";
import type { PortfolioHistoryPoint } from "../../services/types";

describe("chartHelpers decimation", () => {
    // Generate 30 daily points starting at 2025-01-01 (1735689600)
    const mockDailyPoints: PortfolioHistoryPoint[] = Array.from({ length: 30 }, (_, i) => ({
        time: 1735689600 + i * 86400,
        market_value_base: 1000 + i * 10,
        net_invested_base: 1000,
        pnl_base: i * 10,
        pnl_pct: i * 1.0,
    }));

    it("decimates 30 daily points to weekly points", () => {
        const weekly = decimateToWeekly(mockDailyPoints);
        expect(weekly.length).toBeGreaterThanOrEqual(4);
        expect(weekly.length).toBeLessThanOrEqual(6);
        expect(weekly[weekly.length - 1].time).toBe(mockDailyPoints[mockDailyPoints.length - 1].time);
    });

    it("decimates 30 daily points to monthly points", () => {
        const monthly = decimateToMonthly(mockDailyPoints);
        // Jan 1 to Jan 30 are all within January
        expect(monthly.length).toBe(1);
    });

    it("decimates to yearly points", () => {
        const yearly = decimateToYearly(mockDailyPoints);
        expect(yearly.length).toBe(1);
    });

    it("decimatePoints returns original array for 1d", () => {
        const result = decimatePoints(mockDailyPoints, "1d");
        expect(result).toHaveLength(30);
    });

    it("promotes interval from 1d to 1wk if sparse (< 10 points over multiple weeks)", () => {
        // Create 5 points spaced across 3 weeks
        const multiWeekSparse: PortfolioHistoryPoint[] = [
            { time: 1735689600, market_value_base: 100 },
            { time: 1735689600 + 7 * 86400, market_value_base: 105 },
            { time: 1735689600 + 14 * 86400, market_value_base: 110 },
        ];
        const effective = getEffectiveInterval(multiWeekSparse, "1d");
        expect(effective).toBe("1wk");
    });
});

describe("formatIntervalDate", () => {
    // 2026-07-28 12:00:00 UTC (Tuesday)
    const ts = 1785240000;

    it("formats 1d as '28 Jul 2026'", () => {
        expect(formatIntervalDate(ts, "1d")).toBe("28 Jul 2026");
    });

    it("formats 1wk as week range 'Jul 27 - Aug 02, 2026'", () => {
        expect(formatIntervalDate(ts, "1wk")).toBe("Jul 27 - Aug 02, 2026");
    });

    it("formats 1mo as 'July 2026'", () => {
        expect(formatIntervalDate(ts, "1mo")).toBe("July 2026");
    });

    it("formats 1y as '2026'", () => {
        expect(formatIntervalDate(ts, "1y")).toBe("2026");
    });
});
