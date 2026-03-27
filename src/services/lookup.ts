import { api } from "./api";
import type { LookupItem, LookupResponse } from "./types";

const LOOKUP_MIN_QUERY_LENGTH = 2;

export async function fetchLookup(
    query: string,
    signal?: AbortSignal,
): Promise<LookupItem[]> {
    const normalized = query.trim();
    if (normalized.length < LOOKUP_MIN_QUERY_LENGTH) {
        return [];
    }

    const payload = await api.get<LookupResponse>(
        `/lookup?q=${encodeURIComponent(normalized)}`,
        signal,
    );
    return payload.items;
}
