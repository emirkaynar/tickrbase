import type { Bar, Interval } from "./types";
import { INTERVAL_CONFIG } from "./types";
import { fetchOhlc } from "./fetch";
import { readCache, writeCache, isStale } from "./cache";

/**
 * Stale-while-revalidate OHLC query.
 *
 * - Cache present → return it immediately (even if stale).
 *   If stale, fire a background refetch and call onUpdate(bars) when done.
 * - No cache → block on first fetch (loading spinner only on first ever load).
 */
export async function queryOhlc(
    symbol: string,
    interval: Interval,
    onUpdate?: (bars: Bar[]) => void,
    cancelled?: () => boolean,
): Promise<Bar[]> {
    const { yahooRange } = INTERVAL_CONFIG[interval];
    const cached = await readCache(symbol, interval);

    if (cached) {
        if (isStale(cached.fetchedAt, interval)) {
            fetchOhlc(symbol, interval, yahooRange)
                .then(async (bars) => {
                    await writeCache(symbol, interval, bars);
                    if (!cancelled?.()) onUpdate?.(bars);
                })
                .catch(() => {
                    // Silent — caller already has stale data on screen
                });
        }
        return cached.bars;
    }

    // No cache — must wait (first ever load for this symbol+interval)
    const bars = await fetchOhlc(symbol, interval, yahooRange);
    await writeCache(symbol, interval, bars);
    return bars;
}
