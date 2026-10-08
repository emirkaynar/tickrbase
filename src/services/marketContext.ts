import { api } from "./api";
import type { MarketContext } from "./types";

export function fetchMarketContext(ticker: string, start: number, end: number, signal?: AbortSignal): Promise<MarketContext> {
    const params = new URLSearchParams({ start: String(Math.floor(start)), end: String(Math.ceil(end)) });
    return api.get(`/market-context/${encodeURIComponent(ticker)}?${params}`, signal);
}
