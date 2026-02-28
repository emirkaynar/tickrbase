import { useEffect, useState } from "preact/hooks";
import { apiGet } from "./api";

export type SymbolItem = { label: string; value: string };

export const FALLBACK_SYMBOLS: SymbolItem[] = [
    { label: "ASELS", value: "ASELS.IS" },
    { label: "THYAO", value: "THYAO.IS" },
    { label: "BESTE", value: "BESTE.IS" },
    { label: "XU100", value: "XU100.IS" },
    { label: "XU030", value: "XU030.IS" },
];

const STALE_MS = 86_400_000;

let cachedItems: SymbolItem[] | null = null;
let cachedAt = 0;

type SymbolsPayload = {
    items: SymbolItem[];
    stale: boolean;
    last_updated: string;
};

async function fetchSymbols(): Promise<SymbolItem[]> {
    const payload = await apiGet<SymbolsPayload>("/symbols");
    cachedItems = payload.items;
    cachedAt = Date.now();
    return payload.items;
}

export function useSymbols(): {
    items: SymbolItem[];
    refresh: () => Promise<void>;
} {
    const [items, setItems] = useState<SymbolItem[]>(
        cachedItems ?? FALLBACK_SYMBOLS,
    );

    useEffect(() => {
        let cancelled = false;

        (async () => {
            if (cachedItems && Date.now() - cachedAt < STALE_MS) {
                setItems(cachedItems);
                return;
            }
            try {
                const fresh = await fetchSymbols();
                if (!cancelled) setItems(fresh);
            } catch {
                if (!cancelled && cachedItems) setItems(cachedItems);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const refresh = async () => {
        const fresh = await fetchSymbols();
        setItems(fresh);
    };

    return { items, refresh };
}
