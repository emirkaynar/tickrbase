// UTCTimestamp (Unix seconds) — works for both intraday (5m) and daily (1d) bars.
// Lightweight Charts v4 accepts this as-is when cast to CandlestickData<UTCTimestamp>[].
export type Bar = {
    time: number; // Unix seconds (UTCTimestamp)
    open: number;
    high: number;
    low: number;
    close: number;
};

// Interval is both the Yahoo Finance interval param and the user's chart resolution choice.
export type Interval =
    | "1m"
    | "5m"
    | "15m"
    | "30m"
    | "1h"
    | "1d"
    | "1wk"
    | "1mo";

type IntervalConfig = {
    yahooRange: string; // maximum range Yahoo allows for this interval
    staleMs: number;
    label: string;
};

export const INTERVAL_CONFIG: Record<Interval, IntervalConfig> = {
    "1m": { yahooRange: "1d", staleMs: 60 * 1000, label: "1m" },
    "5m": { yahooRange: "5d", staleMs: 5 * 60 * 1000, label: "5m" },
    "15m": { yahooRange: "1mo", staleMs: 15 * 60 * 1000, label: "15m" },
    "30m": { yahooRange: "1mo", staleMs: 30 * 60 * 1000, label: "30m" },
    "1h": { yahooRange: "3mo", staleMs: 60 * 60 * 1000, label: "1h" },
    "1d": { yahooRange: "5y", staleMs: 60 * 60 * 1000, label: "D" },
    "1wk": { yahooRange: "10y", staleMs: 24 * 60 * 60 * 1000, label: "W" },
    "1mo": { yahooRange: "max", staleMs: 24 * 60 * 60 * 1000, label: "M" },
} as const;

export const INTERVALS: Interval[] = [
    "1m",
    "5m",
    "15m",
    "30m",
    "1h",
    "1d",
    "1wk",
    "1mo",
];
