import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../services/api";
import { livePricesClient } from "../../services/livePrices";
import { fetchQuotes } from "../../services/quotes";
import { fetchOverview } from "../../services/overview";
import { fetchHistory } from "../../services/history";
import type { Bar, OverviewData, QuoteSnapshot } from "../../services/types";

export type ChartOverviewInterval = "D" | "W" | "M" | "Y";

const INTERVAL_CONFIG: Record<
    ChartOverviewInterval,
    { interval: string; period: string; isIntraday: boolean }
> = {
    D: { interval: "5m", period: "1d", isIntraday: true },
    W: { interval: "1h", period: "5d", isIntraday: true },
    M: { interval: "1d", period: "1mo", isIntraday: false },
    Y: { interval: "1d", period: "1y", isIntraday: false },
};

export function useOverviewState(widgetId: string) {
    const [symbol, setSymbolState] = useState<string>("AAPL");
    const [activeTab, setActiveTab] = useState<string>("summary");
    const [activeInterval, setActiveInterval] = useState<ChartOverviewInterval>("D");

    const [quote, setQuote] = useState<QuoteSnapshot | null>(null);
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [bars, setBars] = useState<Bar[]>([]);
    const [dailyBars, setDailyBars] = useState<Bar[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [stateReady, setStateReady] = useState<boolean>(false);

    const symbolRef = useRef(symbol);
    symbolRef.current = symbol;

    // Load initial widget state from backend
    useEffect(() => {
        let active = true;
        api.get<{ symbol?: string; state?: { activeTab?: string; activeInterval?: ChartOverviewInterval } }>(
            `/user/widgets/${widgetId}/state`,
        )
            .then((res) => {
                if (!active) return;
                if (res.symbol) setSymbolState(res.symbol.toUpperCase());
                if (res.state?.activeTab) setActiveTab(res.state.activeTab);
                if (res.state?.activeInterval) setActiveInterval(res.state.activeInterval);
            })
            .catch(() => {})
            .finally(() => {
                if (active) setStateReady(true);
            });

        return () => {
            active = false;
        };
    }, [widgetId]);

    // Save widget state
    const saveState = useCallback(
        (nextSymbol: string, nextTab: string, nextInterval: ChartOverviewInterval) => {
            void api.put(`/user/widgets/${widgetId}/state`, {
                symbol: nextSymbol,
                state: { activeTab: nextTab, activeInterval: nextInterval },
            });
        },
        [widgetId],
    );

    const setSymbol = useCallback(
        (next: string) => {
            const clean = next.trim().toUpperCase();
            if (!clean || clean === symbolRef.current) return;
            setSymbolState(clean);
            saveState(clean, activeTab, activeInterval);
        },
        [activeTab, activeInterval, saveState],
    );

    const selectTab = useCallback(
        (tab: string) => {
            setActiveTab(tab);
            saveState(symbol, tab, activeInterval);
        },
        [symbol, activeInterval, saveState],
    );

    const selectInterval = useCallback(
        (interval: ChartOverviewInterval) => {
            setActiveInterval(interval);
            saveState(symbol, activeTab, interval);
        },
        [symbol, activeTab, saveState],
    );

    // Live prices subscription
    useEffect(() => {
        if (!stateReady) return;
        livePricesClient.updateSymbol(widgetId, symbol);
        return () => {
            livePricesClient.removeWidget(widgetId);
        };
    }, [widgetId, symbol, stateReady]);

    // Listen for live ticks
    useEffect(() => {
        const unsubscribe = livePricesClient.onTick((tick) => {
            if (tick.symbol !== symbolRef.current) return;
            if (!Number.isFinite(tick.price)) return;

            const livePrice = tick.price;

            // Update quote live
            setQuote((prev) => {
                if (!prev) return prev;
                const prevClose = prev.previous_close;
                const change = prevClose != null ? livePrice - prevClose : prev.change;
                const change_percent =
                    prevClose != null && prevClose !== 0
                        ? ((livePrice - prevClose) / prevClose) * 100
                        : prev.change_percent;

                return {
                    ...prev,
                    current_price: livePrice,
                    day_high: prev.day_high != null ? Math.max(prev.day_high, livePrice) : livePrice,
                    day_low: prev.day_low != null ? Math.min(prev.day_low, livePrice) : livePrice,
                    change,
                    change_percent,
                };
            });

            // Update last bar in chart live
            setBars((prevBars) => {
                if (prevBars.length === 0) return prevBars;
                const lastIdx = prevBars.length - 1;
                const lastBar = prevBars[lastIdx];
                const updatedBar: Bar = {
                    ...lastBar,
                    high: Math.max(lastBar.high, livePrice),
                    low: Math.min(lastBar.low, livePrice),
                    close: livePrice,
                };
                const next = [...prevBars];
                next[lastIdx] = updatedBar;
                return next;
            });
        });

        return () => {
            unsubscribe();
        };
    }, []);

    // Fetch quote & overview data when symbol changes
    useEffect(() => {
        if (!stateReady) return;
        let cancelled = false;
        const controller = new AbortController();

        setLoading(true);

        const loadData = () => {
            fetchQuotes([symbol], ["session", "volume", "quote"], controller.signal)
                .then((res) => {
                    if (!cancelled && res.quotes.length > 0) {
                        setQuote(res.quotes[0]);
                    }
                })
                .catch(() => {})
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });

            fetchOverview(symbol, controller.signal)
                .then((res) => {
                    if (!cancelled) {
                        setOverview(res);
                    }
                })
                .catch(() => {});
        };

        loadData();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [symbol, stateReady]);

    // Fetch chart bars when symbol or interval changes
    useEffect(() => {
        if (!stateReady) return;
        let cancelled = false;
        const controller = new AbortController();

        const cfg = INTERVAL_CONFIG[activeInterval] || INTERVAL_CONFIG.D;

        const loadBars = async () => {
            try {
                const res = await fetchHistory(
                    symbol,
                    cfg.interval,
                    cfg.period,
                    undefined,
                    controller.signal,
                );

                if (cancelled) return;
                setBars(res.candles || []);
            } catch (err) {
                // ignore
            }
        };

        void loadBars();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [symbol, activeInterval, stateReady]);

    // Fetch 5y daily bars for computing historical % changes (1M, 3M, 6M, YTD, 1Y)
    useEffect(() => {
        if (!stateReady) return;
        let cancelled = false;
        const controller = new AbortController();

        const loadDailyHistory = async () => {
            try {
                const res = await fetchHistory(
                    symbol,
                    "1d",
                    "5y",
                    undefined,
                    controller.signal,
                );
                if (cancelled) return;
                setDailyBars(res.candles || []);
            } catch (err) {
                // ignore
            }
        };

        void loadDailyHistory();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [symbol, stateReady]);

    return {
        symbol,
        setSymbol,
        activeTab,
        selectTab,
        activeInterval,
        selectInterval,
        quote,
        overview,
        bars,
        dailyBars,
        loading,
        stateReady,
        isIntraday: (INTERVAL_CONFIG[activeInterval] || INTERVAL_CONFIG.D).isIntraday,
    };
}
