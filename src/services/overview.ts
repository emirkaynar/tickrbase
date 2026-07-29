import { api } from "./api";
import type { OverviewData } from "./types";

export async function fetchOverview(
    symbol: string,
    signal?: AbortSignal,
): Promise<OverviewData> {
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanSymbol) {
        throw new Error("Symbol is required");
    }
    return api.get<OverviewData>(
        `/overview/${encodeURIComponent(cleanSymbol)}`,
        signal,
    );
}
