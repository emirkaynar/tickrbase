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
  /** Provider-reported interval volume; absent for tick-only bars, null when unavailable. */
  volume?: number | null;
};

export type PriceResponse = {
  ticker: string;
  current_price: number;
  timestamp: string;
  stale: boolean;
  last_updated: string;
};

export type DataCoverage = {
  intervals?: string[];
  sessions: string[];
  overnight_history: boolean | null;
  delay_seconds: number | null;
};

export type SessionWindow = {
  kind: "regular" | "pre" | "post" | "overnight";
  start: number;
  end: number;
};
export type MarketSession = {
  trading_date: string;
  regular_open: number;
  regular_close: number;
  windows: SessionWindow[];
};
export type MarketContext = {
  ticker: string;
  exchange: string | null;
  instrument_type: string | null;
  exchange_timezone: string | null;
  sessions: MarketSession[];
  calendar_coverage: { from: number; to: number } | null;
  server_time: number;
};

export type HistoryResponse = {
  source?: string;
  sessions?: "regular" | "extended";
  coverage?: DataCoverage;
  snapshot_time?: number | null;
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

export type PortfolioSummary = {
  id: string;
  name: string;
  base_currency: string;
  is_default: boolean;
  created_at: number;
};

export type PortfolioCreatePayload = {
  name: string;
  base_currency?: string;
  is_default?: boolean;
};

export type PositionResponse = {
  id: string;
  portfolio_id: string;
  ticker: string;
  asset_class: string;
  sector: string | null;
  quantity: number;
  avg_price: number;
  current_price: number;
  market_value: number;
  total_cost: number;
  pnl: number;
  pnl_percent: number;
  weight_percent: number;
  target_weight_pct: number | null;
  tags: string[];
  is_closed: boolean;
  created_at: number;
  updated_at: number;
  /** Native trading currency (e.g. "TRY", "USD"). Values above are already in base_currency. */
  currency: string;
  /** FX rate applied: native → base_currency */
  fx_rate_to_base: number;
  avg_price_native: number;
  current_price_native: number;
  market_value_native: number;
  pnl_native: number;
  pnl_percent_native: number;
};

export type TransactionType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "FEE"
  | "TAX"
  | "SPLIT";

export type TransactionResponse = {
  asset_class: string | undefined;
  id: string;
  portfolio_id: string;
  ticker: string;
  type: TransactionType;
  quantity: number;
  unit_price: number;
  fee: number;
  tax: number;
  currency: string;
  fx_rate_to_base: number;
  realized_pnl: number | null;
  executed_at: number;
  notes: string | null;
  created_at: number;
  unit_price_base: number;
  total_cost_base: number;
  realized_pnl_base: number | null;
  buy_fx_rate?: number | null;
};

export type TransactionCreatePayload = {
  portfolio_id: string;
  ticker: string;
  type: TransactionType;
  quantity?: number;
  unit_price?: number;
  fee?: number;
  tax?: number;
  currency?: string;
  fx_rate_to_base?: number;
  executed_at?: number | null;
  notes?: string | null;
};

export type PortfolioKPIs = {
  total_net_worth: number;
  total_cost: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  realized_pnl: number;
  cash_balance: number;
  holding_count: number;
  /** Which period the unrealized_pnl covers: "daily" | "weekly" | "monthly" | "all" */
  pnl_period: string;
  /** Unix timestamp when FX rates were fetched (for freshness cue) */
  fx_rates_as_of: number;
};

export type PortfolioOverviewResponse = {
  portfolio: PortfolioSummary | null;
  kpis: PortfolioKPIs;
  positions: PositionResponse[];
};

export type PortfolioHistoryPoint = {
  time: number;
  portfolio_value?: number | null;
  market_value_base?: number | null;
  net_invested_base?: number | null;
  pnl_base?: number | null;
  pnl_pct?: number | null;
  pnl_delta_pct?: number | null;
  fx_effect_base?: number | null;
  portfolio_percent?: number | null;
  benchmark_percent?: number | null;
};

export const BENCHMARK_OPTIONS = [
  { ticker: "^GSPC", label: "S&P 500" },
  { ticker: "^IXIC", label: "NASDAQ" },
  { ticker: "XU100.IS", label: "BIST100" },
] as const;

export type BenchmarkTicker = (typeof BENCHMARK_OPTIONS)[number]["ticker"];
export const DEFAULT_BENCHMARK: BenchmarkTicker = "^GSPC";

export type PortfolioHistoryResponse = {
  portfolio_id: string;
  timeframe: string;
  benchmark: string | null;
  points: PortfolioHistoryPoint[];
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

export type QuoteFieldGroup = "session" | "volume" | "quote";

export type QuoteSnapshot = {
  source?: string;
  source_timestamp?: number | null;
  timestamp_origin?: "source" | "receipt" | "unknown";
  delay_seconds?: number | null;
  symbol: string;
  currency?: string | null;
  current_price: number | null;
  previous_close: number | null;
  open: number | null;
  day_low: number | null;
  day_high: number | null;
  change: number | null;
  change_percent: number | null;
  volume: number | null;
  volume_value: number | null;
  bid: number | null;
  ask: number | null;
  stale: boolean;
  last_updated: string;
};

export type QuotesResponse = {
  symbols: string[];
  quotes: QuoteSnapshot[];
  stale: boolean;
  last_updated: string;
};

export type OverviewData = {
  symbol: string;
  currency?: string | null;
  company_name?: string | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  forward_pe?: number | null;
  eps?: number | null;
  forward_eps?: number | null;
  dividend_yield?: number | null;
  dividend_rate?: number | null;
  beta?: number | null;
  fifty_two_week_high?: number | null;
  fifty_two_week_low?: number | null;
  fifty_day_average?: number | null;
  two_hundred_day_average?: number | null;
  shares_outstanding?: number | null;
  float_shares?: number | null;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  vwap?: number | null;
  stale?: boolean;
  last_updated?: string;
};

export type ListItem = { ticker: string };

export type ListRecord = {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
};

export type ListRowState = {
  rowOrder: string[];
  spacers: Array<{
    id: string;
    label?: string;
    height?: number;
  }>;
};

export type ListDeleteResponse =
  | {
      ok: true;
      deleted: true;
      activeListId: string;
    }
  | {
      ok: false;
      deleted: false;
      activeListId: string;
      reason: "last-list" | "not-found";
    };

export type ListsResponse = ListRecord[];

export type ListItemsResponse = ListItem[];

// Legacy aliases kept during rename migration to Lists.
export type WatchlistItem = ListItem;

export type WatchlistResponse = ListItemsResponse;

export type OkResponse = { ok: boolean };

export type ChartType =
  "candlestick" | "line" | "area" | "bar" | "baseline" | "heikin_ashi";

export type ScaleMode = "normal" | "logarithmic" | "percentage";

/* ── Chart interval ──────────────────────────────────────────────────────── */
export type Interval =
  "1m" | "5m" | "15m" | "30m" | "1h" | "1d" | "1wk" | "1mo";

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