import type { OkResponse, WatchlistItem, WatchlistResponse } from "./types";
import { db } from "../db";

function normalizeTicker(ticker: string): string {
    return ticker.trim().toUpperCase();
}

function uniqueTickers(items: WatchlistItem[]): string[] {
    const set = new Set<string>();
    for (const item of items) {
        const ticker = normalizeTicker(item.ticker);
        if (!ticker) continue;
        set.add(ticker);
    }
    return Array.from(set);
}

export function fetchWatchlist(
    _signal?: AbortSignal,
): Promise<WatchlistResponse> {
    return db.watchlist
        .orderBy("createdAt")
        .toArray()
        .then((rows) =>
            rows.map((row) => ({
                ticker: row.ticker,
            })),
        );
}

export function updateWatchlist(
    items: WatchlistItem[],
    _signal?: AbortSignal,
): Promise<OkResponse> {
    if (items.length === 0) return Promise.resolve({ ok: true });

    const now = Date.now();
    const tickers = uniqueTickers(items);

    return db
        .transaction("rw", db.watchlist, async () => {
            for (const ticker of tickers) {
                const existing = await db.watchlist.get(ticker);
                await db.watchlist.put({
                    ticker,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                });
            }
        })
        .then(() => ({ ok: true }));
}
