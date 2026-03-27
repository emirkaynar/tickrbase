/* ─────────────────────────────────────────────────────────────────────────────
   Service layer types — mirrors backend Pydantic models (backend/core/models.py)
   ───────────────────────────────────────────────────────────────────────────── */

/** OHLCV bar. time is Unix seconds (UTCTimestamp for lightweight-charts). */
export type Bar = {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
};

export type PriceResponse = {
    ticker: string;
    current_price: number;
    timestamp: string;
    stale: boolean;
    last_updated: string;
};

export type HistoryResponse = {
    ticker: string;
    interval: string;
    candles: Bar[];
    stale: boolean;
    last_updated: string;
};

export type PortfolioPosition = {
    ticker: string;
    quantity: number;
    avg_price: number;
    current_price: number;
    pnl: number;
    pnl_percent: number;
};

export type PortfolioCreate = {
    ticker: string;
    quantity: number;
    avg_price: number;
};

export type AlertCondition = "above" | "below";

export type AlertRecord = {
    id: number;
    ticker: string;
    condition: AlertCondition;
    threshold: number;
    active: boolean;
    created_at: string;
    last_triggered_at: string | null;
};

export type AlertCreate = {
    ticker: string;
    condition: AlertCondition;
    threshold: number;
};

export type SymbolItem = { label: string; value: string };

export type SymbolsResponse = {
    items: SymbolItem[];
    stale: boolean;
    last_updated: string;
};

export type LookupItem = {
    symbol: string;
    company_name: string;
    exchange: string;
    instrument_type: string;
};

export type LookupResponse = {
    query: string;
    items: LookupItem[];
    stale: boolean;
    last_updated: string;
};

export type WatchlistItem = { ticker: string; interval: string };

export type WatchlistResponse = WatchlistItem[];

export type OkResponse = { ok: boolean };

/* ── Chart interval ──────────────────────────────────────────────────────── */
export type Interval =
    | "1m"
    | "5m"
    | "15m"
    | "30m"
    | "1h"
    | "1d"
    | "1wk"
    | "1mo";

type IntervalMeta = {
    yahooRange: string;
    staleMs: number;
    label: string;
};

export const INTERVAL_CONFIG: Record<Interval, IntervalMeta> = {
    "1m": { yahooRange: "1d", staleMs: 60_000, label: "1m" },
    "5m": { yahooRange: "5d", staleMs: 5 * 60_000, label: "5m" },
    "15m": { yahooRange: "1mo", staleMs: 15 * 60_000, label: "15m" },
    "30m": { yahooRange: "1mo", staleMs: 30 * 60_000, label: "30m" },
    "1h": { yahooRange: "3mo", staleMs: 60 * 60_000, label: "1h" },
    "1d": { yahooRange: "5y", staleMs: 60 * 60_000, label: "D" },
    "1wk": { yahooRange: "10y", staleMs: 24 * 60 * 60_000, label: "W" },
    "1mo": { yahooRange: "max", staleMs: 24 * 60 * 60_000, label: "M" },
};

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
