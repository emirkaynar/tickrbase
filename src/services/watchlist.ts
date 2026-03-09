import { api } from "./api";
import type { OkResponse, WatchlistItem, WatchlistResponse } from "./types";

export function fetchWatchlist(
    signal?: AbortSignal,
): Promise<WatchlistResponse> {
    return api.get<WatchlistResponse>("/watchlist", signal);
}

export function updateWatchlist(
    items: WatchlistItem[],
    signal?: AbortSignal,
): Promise<OkResponse> {
    if (items.length === 0) return Promise.resolve({ ok: true });
    return api.post<OkResponse>("/watchlist", { items }, signal);
}
