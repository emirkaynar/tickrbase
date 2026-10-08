import { useEffect, useRef, useState } from "preact/hooks";
import { fetchLookup } from "../../../services/lookup";

export type InstrumentIdentity = { name: string; exchange: string | null };

type CachedIdentity = { identity: InstrumentIdentity; fetchedAt: number };
const identities = new Map<string, CachedIdentity>();
const CACHE_TTL_MS = 86_400_000;
const CACHE_LIMIT = 100;

const fallbackIdentity = (symbol: string): InstrumentIdentity => ({
    name: symbol,
    exchange: null,
});

export async function resolveInstrumentIdentity(
    symbol: string,
    signal?: AbortSignal,
): Promise<InstrumentIdentity> {
    const fallback = fallbackIdentity(symbol);
    if (!symbol || signal?.aborted) return fallback;
    const cached = identities.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.identity;
    }
    identities.delete(symbol);

    try {
        const items = await fetchLookup(symbol, signal);
        if (signal?.aborted) return fallback;
        // Lookup is a search, not a single-instrument endpoint. Preserve suffixes.
        const match = items.find(item => item.symbol.trim().toUpperCase() === symbol.toUpperCase());
        if (!match) return fallback;
        const identity = {
            name: match.company_name.trim() || symbol,
            exchange: match.exchange.trim() || null,
        };
        identities.set(symbol, { identity, fetchedAt: Date.now() });
        if (identities.size > CACHE_LIMIT) {
            identities.delete(identities.keys().next().value!);
        }
        return identity;
    } catch {
        // Failures and misses remain retryable on the next mount/readiness change.
        return fallback;
    }
}

export function useInstrumentIdentity(symbol: string, ready: boolean): InstrumentIdentity {
    const [resolved, setResolved] = useState<{
        symbol: string;
        identity: InstrumentIdentity;
    } | null>(null);
    const selection = useRef({ symbol, ready });
    selection.current = { symbol, ready };

    useEffect(() => {
        setResolved(null);
        if (!ready || !symbol) return;
        const controller = new AbortController();
        void resolveInstrumentIdentity(symbol, controller.signal).then(identity => {
            if (controller.signal.aborted || !selection.current.ready || selection.current.symbol !== symbol) return;
            setResolved({ symbol, identity });
        });
        return () => controller.abort();
    }, [symbol, ready]);

    // Effects run after rendering: never expose the previous ticker's identity.
    return ready && resolved?.symbol === symbol
        ? resolved.identity
        : fallbackIdentity(symbol);
}
