import { useEffect, useRef, useState } from "preact/hooks";
import type { LiveTick } from "../../../services/livePrices";
import { calcChangePercent, fetchQuotes } from "../../../services/quotes";
import type { QuoteSnapshot } from "../../../services/types";

export type ChartQuote = {
    price: number | null;
    currency: string | null;
    changePercent: number | null;
    snapshot: QuoteSnapshot | null;
    ready: boolean;
};

type Selection = { symbol: string; ready: boolean };

export function useChartQuote(
    symbol: string,
    ready: boolean,
    lastTick: LiveTick | null,
    setPrevClose: (n: number | null) => void,
): ChartQuote {
    const setPrevCloseRef = useRef(setPrevClose);
    setPrevCloseRef.current = setPrevClose;
    const selectionRef = useRef<Selection>({ symbol, ready });
    if (selectionRef.current.symbol !== symbol || selectionRef.current.ready !== ready) {
        selectionRef.current = { symbol, ready };
    }
    const selection = selectionRef.current;
    const [loaded, setLoaded] = useState<{
        selection: Selection;
        snapshot: QuoteSnapshot;
    } | null>(null);

    useEffect(() => {
        setLoaded(null);
        setPrevCloseRef.current(null);
        if (!ready || !symbol) return;

        const controller = new AbortController();
        void fetchQuotes([symbol], ["session"], controller.signal)
            .then(response => {
                if (controller.signal.aborted || selectionRef.current !== selection) return;
                const snapshot = response.quotes.find(quote => quote.symbol === symbol);
                if (!snapshot) return;
                setPrevCloseRef.current(snapshot.previous_close);
                setLoaded({ selection, snapshot });
            })
            .catch(() => {});
        return () => controller.abort();
    }, [symbol, ready]);

    // Render-time selection gating also invalidates A → B → A before effects run.
    const snapshot = ready && loaded?.selection === selection ? loaded.snapshot : null;
    // lastTick already belongs to the chart's accepted source/timestamp stream.
    const tick = ready && lastTick?.symbol === symbol ? lastTick : null;
    const price = tick?.price ?? snapshot?.current_price ?? null;
    return {
        price,
        currency: snapshot?.currency ?? null,
        changePercent: calcChangePercent(price, snapshot?.previous_close ?? null),
        snapshot,
        ready: snapshot !== null || tick !== null,
    };
}
