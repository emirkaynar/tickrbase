import { apiPost } from "./api";
import type { Interval } from "./types";

export async function updateWatchlist(
    items: { ticker: string; interval: Interval }[],
): Promise<void> {
    if (items.length === 0) return;
    await apiPost("/watchlist", { items });
}
