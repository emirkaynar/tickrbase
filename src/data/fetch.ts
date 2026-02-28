import type { Bar, Interval } from "./types";
import { apiGet } from "./api";

type HistoryPayload = {
    ticker: string;
    interval: string;
    candles: Bar[];
    stale: boolean;
    last_updated: string;
};

export async function fetchOhlc(
    symbol: string,
    interval: Interval,
    period: string,
): Promise<Bar[]> {
    const payload = await apiGet<HistoryPayload>(
        `/history/${encodeURIComponent(symbol)}?interval=${interval}&period=${period}`,
    );
    return payload.candles;
}
