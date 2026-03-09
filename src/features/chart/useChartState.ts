import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import type {
    IChartApi,
    ISeriesApi,
    UTCTimestamp,
    CandlestickData,
} from "lightweight-charts";
import { db } from "../../db";
import { fetchHistory } from "../../services/history";
import { updateWatchlist } from "../../services/watchlist";
import type { Bar, Interval } from "../../services/types";
import { INTERVALS } from "../../services/types";

/** Module-level maps survive RGL remount cycles during drag */
const everLoaded = new Set<string>();
const lastState = new Map<
    string,
    { bars: Bar[]; interval: Interval; symbol: string }
>();

type ChartRefs = {
    chartRef: { current: IChartApi | null };
    seriesRef: { current: ISeriesApi<"Candlestick"> | null };
    intervalRef: { current: Interval };
};

type UseChartStateReturn = {
    status: "loading" | "ok" | "error";
    errorMsg: string;
    warning: string;
    symbol: string;
    interval: Interval;
    stateReady: boolean;
    setSymbol: (s: string) => void;
    selectInterval: (i: Interval) => void;
    everLoadedRef: typeof everLoaded;
    getLastState: (
        id: string,
    ) => { bars: Bar[]; interval: Interval; symbol: string } | undefined;
};

function getPeriod(interval: Interval): string {
    if (interval === "1d") return "1y";
    if (interval === "1wk") return "5y";
    return "5d";
}

function getPollMs(interval: Interval): number {
    return ["1m", "5m", "15m"].includes(interval) ? 60_000 : 300_000;
}

export function useChartState(
    id: string,
    refs: ChartRefs,
): UseChartStateReturn {
    const { chartRef, seriesRef, intervalRef } = refs;

    const _prev = lastState.get(id);
    const lastBarTimeRef = useRef<number | null>(null);
    const chartStateRef = useRef<{ from: number; to: number } | null>(null);

    const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState("");
    const [warning, setWarning] = useState("");
    const [symbol, setSymbol] = useState(_prev?.symbol ?? "ASELS.IS");
    const [interval, selectInterval] = useState<Interval>(
        _prev?.interval ?? "1d",
    );
    const [stateReady, setStateReady] = useState(false);

    // Restore persisted state from Dexie on mount
    useEffect(() => {
        void db.widgetState.get(id).then((saved) => {
            if (saved) {
                if (INTERVALS.includes(saved.interval as Interval)) {
                    selectInterval(saved.interval as Interval);
                }
                setSymbol(saved.symbol);
            }
            setStateReady(true);
        });

        void db.chartState.get(id).then((saved) => {
            if (saved?.timeScale) chartStateRef.current = saved.timeScale;
        });
    }, [id]);

    // Persist symbol+interval changes
    useEffect(() => {
        if (!stateReady) return;
        void db.widgetState.put({ id, symbol, interval });
    }, [id, symbol, interval, stateReady]);

    // Register with watchlist
    useEffect(() => {
        if (!stateReady) return;
        void updateWatchlist([{ ticker: symbol, interval }]).catch(() => {});
    }, [symbol, interval, stateReady]);

    const applyBars = useCallback(
        (bars: Bar[], fit: boolean) => {
            const series = seriesRef.current;
            if (!series) return;
            intervalRef.current = interval;
            series.setData(bars as CandlestickData<UTCTimestamp>[]);
            chartRef.current?.timeScale().applyOptions({
                timeVisible: !["1d", "1wk", "1mo"].includes(interval),
                secondsVisible: false,
            });
            if (fit) {
                chartRef.current?.timeScale().fitContent();
            } else if (chartStateRef.current) {
                chartRef.current
                    ?.timeScale()
                    .setVisibleRange(chartStateRef.current as never);
            }
            lastState.set(id, { bars, interval, symbol });
            everLoaded.add(id);
            setStatus("ok");
        },
        [id, symbol, interval, chartRef, seriesRef, intervalRef],
    );

    const saveChartState = useCallback(async () => {
        if (!chartRef.current) return;
        try {
            const range = chartRef.current.timeScale().getVisibleRange();
            chartStateRef.current = range
                ? { from: range.from as number, to: range.to as number }
                : null;
            await db.chartState.put({
                widget_id: id,
                timeScale: chartStateRef.current,
            });
        } catch {
            /* ignore */
        }
    }, [id, chartRef]);

    // Data load + polling
    useEffect(() => {
        const series = seriesRef.current;
        if (!series || !stateReady) return;

        let cancelled = false;
        const ctrl = new AbortController();

        const initialLoad = async () => {
            try {
                if (!everLoaded.has(id)) setStatus("loading");
                const data = await fetchHistory(
                    symbol,
                    interval,
                    getPeriod(interval),
                    undefined,
                    ctrl.signal,
                );
                if (cancelled) return;
                if (!data.candles.length) {
                    setStatus("ok");
                    return;
                }
                const bars: Bar[] = data.candles;
                applyBars(bars, true);
                lastBarTimeRef.current = bars[bars.length - 1].time;
                setWarning("");
            } catch (err) {
                if (cancelled) return;
                setErrorMsg(
                    err instanceof Error ? err.message : "Unknown error",
                );
                setStatus("error");
            }
        };

        const deltaPoll = async () => {
            if (!everLoaded.has(id) || lastBarTimeRef.current === null) return;
            await saveChartState();
            try {
                const data = await fetchHistory(
                    symbol,
                    interval,
                    getPeriod(interval),
                    lastBarTimeRef.current,
                    ctrl.signal,
                );
                if (cancelled || !data.candles.length) return;
                const last = data.candles[data.candles.length - 1];
                series.update(last as CandlestickData<UTCTimestamp>);
                lastBarTimeRef.current = last.time;
                setWarning("");
            } catch (err) {
                if (cancelled) return;
                setWarning(
                    err instanceof Error ? err.message : "Network error",
                );
            }
        };

        void initialLoad();
        const pollId = setInterval(deltaPoll, getPollMs(interval));

        return () => {
            cancelled = true;
            ctrl.abort();
            clearInterval(pollId);
        };
    }, [
        symbol,
        interval,
        stateReady,
        id,
        seriesRef,
        applyBars,
        saveChartState,
    ]);

    return {
        status,
        errorMsg,
        warning,
        symbol,
        interval,
        stateReady,
        setSymbol,
        selectInterval,
        everLoadedRef: everLoaded,
        getLastState: (i: string) => lastState.get(i),
    };
}
