import type { Bar, Interval } from "./types";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

// Istanbul is permanently UTC+3 (no DST since Sep 2016).
// BIST regular session: 10:00–18:00 Istanbul = 07:00–15:00 UTC.
// For intraday intervals, strip bars outside the session to remove pre/post-market noise.
const INTRADAY: Set<Interval> = new Set(["1m", "5m", "15m", "30m", "1h"]);
const SESSION_START_UTC_SECS = 7 * 3600; // 07:00 UTC = 10:00 Istanbul
const SESSION_END_UTC_SECS = 15 * 3600; // 15:00 UTC = 18:00 Istanbul

function isInSession(unixSec: number): boolean {
    const secOfDay = unixSec % 86400;
    return (
        secOfDay >= SESSION_START_UTC_SECS && secOfDay < SESSION_END_UTC_SECS
    );
}

// Tried in order — first proxy that returns a valid response wins.
const PROXIES = [
    (u: string) =>
        `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) =>
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u: string) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
];

const TIMEOUT_MS = 10_000;

type YahooResponse = {
    chart: {
        result: Array<{
            timestamp: number[];
            indicators: {
                quote: Array<{
                    open: (number | null)[];
                    high: (number | null)[];
                    low: (number | null)[];
                    close: (number | null)[];
                }>;
            };
        }> | null;
        error: { code: string; description: string } | null;
    };
};

async function fetchWithTimeout(url: string): Promise<Response> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        return res;
    } catch (err) {
        clearTimeout(tid);
        throw err;
    }
}

function parseBars(json: YahooResponse): Bar[] {
    if (json.chart.error) throw new Error(json.chart.error.description);
    const result = json.chart.result?.[0];
    if (!result) throw new Error("No data in Yahoo Finance response");

    const { timestamp, indicators } = result;
    const quote = indicators.quote[0];
    const bars: Bar[] = [];

    for (let i = 0; i < timestamp.length; i++) {
        const open = quote.open[i];
        const high = quote.high[i];
        const low = quote.low[i];
        const close = quote.close[i];
        if (open == null || high == null || low == null || close == null)
            continue;
        bars.push({ time: timestamp[i], open, high, low, close });
    }

    bars.sort((a, b) => a.time - b.time);
    return bars;
}

export async function fetchOhlc(
    symbol: string,
    interval: Interval,
    yahooRange: string,
): Promise<Bar[]> {
    const target = `${YAHOO_BASE}/${symbol}?interval=${interval}&range=${yahooRange}`;

    let lastError: unknown = new Error("All proxies failed");
    for (const buildUrl of PROXIES) {
        try {
            const res = await fetchWithTimeout(buildUrl(target));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json: YahooResponse = await res.json();
            const bars = parseBars(json);
            // Strip pre/post-market bars for intraday intervals
            return INTRADAY.has(interval)
                ? bars.filter((b) => isInSession(b.time))
                : bars;
        } catch (err) {
            lastError = err;
            // try next proxy
        }
    }
    throw lastError;
}
