import type { Bar, Interval } from "./types";
import { INTERVAL_CONFIG } from "./types";

// Compound cache key: 'ASELS.IS|1d', 'THYAO.IS|5m', etc.
export function cacheKey(symbol: string, interval: Interval): string {
    return `${symbol}|${interval}`;
}

const memoryCache = new Map<string, { bars: Bar[]; fetchedAt: number }>();

export async function readCache(
    symbol: string,
    interval: Interval,
): Promise<{ bars: Bar[]; fetchedAt: number } | undefined> {
    return memoryCache.get(cacheKey(symbol, interval));
}

export async function writeCache(
    symbol: string,
    interval: Interval,
    bars: Bar[],
): Promise<void> {
    memoryCache.set(cacheKey(symbol, interval), {
        bars,
        fetchedAt: Date.now(),
    });
}

export function isStale(fetchedAt: number, interval: Interval): boolean {
    const { staleMs } = INTERVAL_CONFIG[interval];
    return Date.now() - fetchedAt > staleMs;
}
