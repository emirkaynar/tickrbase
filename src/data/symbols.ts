import { useEffect, useState } from "preact/hooks";
import { db } from "../db";

export type SymbolItem = { label: string; value: string };

export const FALLBACK_SYMBOLS: SymbolItem[] = [
    { label: "ASELS", value: "ASELS.IS" },
    { label: "THYAO", value: "THYAO.IS" },
    { label: "BESTE", value: "BESTE.IS" },
    { label: "XU100", value: "XU100.IS" },
    { label: "XU030", value: "XU030.IS" },
];

const SCANNER_URL = "https://scanner.tradingview.com/turkey/scan";
const STALE_MS = 86_400_000; // 24 hours

// POST-capable CORS proxies only — GET-only proxies (allorigins, codetabs) won't work here
type ProxyBuilder = (url: string) => {
    proxyUrl: string;
    wrapBody: (b: string) => string;
};

const POST_PROXIES: ProxyBuilder[] = [
    // api.cors.lol: pass target URL in header, body unchanged
    (url) => ({
        proxyUrl: `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
        wrapBody: (b) => b,
    }),
    // thingproxy: append target URL to proxy base, body unchanged
    (url) => ({
        proxyUrl: `https://thingproxy.freeboard.io/fetch/${url}`,
        wrapBody: (b) => b,
    }),
];

async function fetchFromScanner(): Promise<SymbolItem[]> {
    const body = JSON.stringify({ columns: [] });
    for (const buildProxy of POST_PROXIES) {
        const { proxyUrl, wrapBody } = buildProxy(SCANNER_URL);
        try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 10_000);
            const res = await fetch(proxyUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: wrapBody(body),
                signal: ac.signal,
            });
            clearTimeout(timer);
            if (!res.ok) continue;
            const json = await res.json();
            const rows: { s: string }[] = json?.data ?? [];
            if (rows.length === 0) continue;
            const items: SymbolItem[] = rows
                .map((r) => {
                    // "BIST:TICK" → { label: "TICK", value: "TICK.IS" }
                    const ticker = r.s.replace(/^BIST:/, "");
                    return { label: ticker, value: `${ticker}.IS` };
                })
                .sort((a, b) => a.label.localeCompare(b.label));
            return items;
        } catch {
            // try next proxy
        }
    }
    throw new Error("All proxies failed for TradingView scanner");
}

export async function refreshSymbols(): Promise<SymbolItem[]> {
    const items = await fetchFromScanner();
    await db.symbolsList.put({ id: "bist", items, fetchedAt: Date.now() });
    return items;
}

export function useSymbols(): {
    items: SymbolItem[];
    refresh: () => Promise<void>;
} {
    const [items, setItems] = useState<SymbolItem[]>(FALLBACK_SYMBOLS);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            // 1. Seed immediately from DB if cached
            const cached = await db.symbolsList.get("bist");
            if (!cancelled && cached && cached.items.length > 0) {
                setItems(cached.items);
            }

            // 2. Background-refresh if stale or missing
            const isStale = !cached || Date.now() - cached.fetchedAt > STALE_MS;
            if (isStale) {
                try {
                    const fresh = await refreshSymbols();
                    if (!cancelled) setItems(fresh);
                } catch {
                    // silently keep cached/fallback data
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const refresh = async () => {
        const fresh = await refreshSymbols();
        setItems(fresh);
    };

    return { items, refresh };
}
