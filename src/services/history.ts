import { api } from "./api";
import type { HistoryResponse } from "./types";

export function fetchHistory(
    ticker: string,
    interval: string,
    period?: string,
    since?: number,
    signal?: AbortSignal,
): Promise<HistoryResponse> {
    const params = new URLSearchParams({ interval });
    if (period) params.set("period", period);
    if (since !== undefined) params.set("since", String(since));
    return api.get<HistoryResponse>(
        `/history/${encodeURIComponent(ticker)}?${params.toString()}`,
        signal,
    );
}
