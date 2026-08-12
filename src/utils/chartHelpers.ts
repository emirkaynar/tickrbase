import type { PortfolioHistoryPoint } from "../services/types";

export type ChartInterval = "1d" | "1wk" | "1mo" | "1y";

function getIsoWeekKey(unixSec: number): string {
    const dt = new Date(unixSec * 1000);
    const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

function getMonthKey(unixSec: number): string {
    const dt = new Date(unixSec * 1000);
    return `${dt.getUTCFullYear()}-${(dt.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

function getYearKey(unixSec: number): string {
    const dt = new Date(unixSec * 1000);
    return `${dt.getUTCFullYear()}`;
}

/**
 * Decimates daily points to weekly resolution (takes last trading point of each ISO week).
 */
export function decimateToWeekly(points: PortfolioHistoryPoint[]): PortfolioHistoryPoint[] {
    if (!points.length) return [];
    const grouped = new Map<string, PortfolioHistoryPoint>();
    for (const p of points) {
        const key = getIsoWeekKey(p.time);
        grouped.set(key, p);
    }
    return Array.from(grouped.values());
}

/**
 * Decimates daily points to monthly resolution (takes last trading point of each calendar month).
 */
export function decimateToMonthly(points: PortfolioHistoryPoint[]): PortfolioHistoryPoint[] {
    if (!points.length) return [];
    const grouped = new Map<string, PortfolioHistoryPoint>();
    for (const p of points) {
        const key = getMonthKey(p.time);
        grouped.set(key, p);
    }
    return Array.from(grouped.values());
}

/**
 * Decimates daily points to yearly resolution (takes last trading point of each calendar year).
 */
export function decimateToYearly(points: PortfolioHistoryPoint[]): PortfolioHistoryPoint[] {
    if (!points.length) return [];
    const grouped = new Map<string, PortfolioHistoryPoint>();
    for (const p of points) {
        const key = getYearKey(p.time);
        grouped.set(key, p);
    }
    return Array.from(grouped.values());
}

/**
 * Decimates daily points based on target interval.
 */
export function decimatePoints(
    points: PortfolioHistoryPoint[],
    interval: ChartInterval,
): PortfolioHistoryPoint[] {
    switch (interval) {
        case "1wk":
            return decimateToWeekly(points);
        case "1mo":
            return decimateToMonthly(points);
        case "1y":
            return decimateToYearly(points);
        case "1d":
        default:
            return points;
    }
}

/**
 * Contingency helper: promotes display interval if daily points are too sparse (< 10 points).
 */
export function getEffectiveInterval(
    points: PortfolioHistoryPoint[],
    requestedInterval: ChartInterval,
): ChartInterval {
    if (requestedInterval === "1d" && points.length < 10 && points.length > 0) {
        const weekly = decimateToWeekly(points);
        if (weekly.length >= 2) return "1wk";
    }
    return requestedInterval;
}

/**
 * Interval-aware date formatter for chart X-axis & tooltips.
 * - 1d:  "14 Jul 2026"
 * - 1wk: "Jul 27 - Aug 02" (or "Dec 28, 2025 - Jan 03, 2026" across year boundaries)
 * - 1mo: "July 2026"
 * - 1y:  "2026"
 */
export function formatIntervalDate(unixSec: number, interval: ChartInterval = "1d"): string {
    const dt = new Date(unixSec * 1000);
    const day = dt.getUTCDate();
    const year = dt.getUTCFullYear();

    const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(dt);
    const monthLong = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(dt);

    if (interval === "1y") {
        return `${year}`;
    }

    if (interval === "1mo") {
        return `${monthLong} ${year}`;
    }

    if (interval === "1wk") {
        // Find Monday start & Sunday end of the week containing unixSec
        const dayOfWeek = dt.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
        const monday = new Date(dt.getTime() - (dayOfWeek - 1) * 86400000);
        const sunday = new Date(monday.getTime() + 6 * 86400000);

        const mDay = monday.getUTCDate().toString().padStart(2, "0");
        const mMth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(monday);
        const mYr = monday.getUTCFullYear();

        const sDay = sunday.getUTCDate().toString().padStart(2, "0");
        const sMth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(sunday);
        const sYr = sunday.getUTCFullYear();

        if (mYr !== sYr) {
            return `${mMth} ${mDay}, ${mYr} - ${sMth} ${sDay}, ${sYr}`;
        }
        if (mMth !== sMth) {
            return `${mMth} ${mDay} - ${sMth} ${sDay}, ${sYr}`;
        }
        return `${mMth} ${mDay} - ${sDay}, ${mYr}`;
    }

    // Default "1d"
    const dayStr = day.toString().padStart(2, "0");
    return `${dayStr} ${monthShort} ${year}`;
}
