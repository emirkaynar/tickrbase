import { api } from "./api";
import type { SymbolItem, SymbolsResponse } from "./types";

const STALE_MS = 86_400_000; // 24 h

export const FALLBACK_SYMBOLS: SymbolItem[] = [
    { label: "ASELS", value: "ASELS.IS" },
    { label: "THYAO", value: "THYAO.IS" },
    { label: "BESTE", value: "BESTE.IS" },
    { label: "XU100", value: "XU100.IS" },
    { label: "XU030", value: "XU030.IS" },
];

let cachedItems: SymbolItem[] | null = null;
let cachedAt = 0;

export async function fetchSymbols(
    signal?: AbortSignal,
): Promise<SymbolItem[]> {
    if (cachedItems && Date.now() - cachedAt < STALE_MS) {
        return cachedItems;
    }
    const payload = await api.get<SymbolsResponse>("/symbols", signal);
    cachedItems = payload.items;
    cachedAt = Date.now();
    return payload.items;
}

export function getCachedSymbols(): SymbolItem[] {
    return cachedItems ?? FALLBACK_SYMBOLS;
}
