import { useState, useEffect } from "preact/hooks";
import { fetchSymbols, getCachedSymbols } from "../services/symbols";
import type { SymbolItem } from "../services/types";

export function useSymbols(): { items: SymbolItem[] } {
    const [items, setItems] = useState<SymbolItem[]>(getCachedSymbols);

    useEffect(() => {
        const ctrl = new AbortController();
        fetchSymbols(ctrl.signal)
            .then(setItems)
            .catch(() => {
                /* keep cached/fallback values */
            });
        return () => ctrl.abort();
    }, []);

    return { items };
}
