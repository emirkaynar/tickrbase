import { api } from "./api";
import type { QuoteFieldGroup, QuotesResponse } from "./types";

function normalizeSymbol(symbol: string): string {
    return symbol.trim().toUpperCase();
}

function uniqueSymbols(symbols: string[]): string[] {
    const seen = new Set<string>();
    const next: string[] = [];

    for (const symbol of symbols) {
        const normalized = normalizeSymbol(symbol);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        next.push(normalized);
    }

    return next;
}

export function fetchQuotes(
    symbols: string[],
    groups: QuoteFieldGroup[],
    signal?: AbortSignal,
): Promise<QuotesResponse> {
    const normalizedSymbols = uniqueSymbols(symbols);
    if (normalizedSymbols.length === 0) {
        return Promise.resolve({
            symbols: [],
            quotes: [],
            stale: false,
            last_updated: new Date().toISOString(),
        });
    }

    const params = new URLSearchParams();
    params.set("symbols", normalizedSymbols.join(","));
    if (groups.length > 0) {
        params.set("fields", Array.from(new Set(groups)).sort().join(","));
    }

    return api.get<QuotesResponse>(`/quotes?${params.toString()}`, signal);
}

export function calcChangePercent(
    price: number | null,
    prevClose: number | null,
): number | null {
    if (price === null || prevClose === null || prevClose === 0) return null;
    return ((price - prevClose) / prevClose) * 100;
}
