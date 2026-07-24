import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { api } from "../../services/api";
import { fetchHistory } from "../../services/history";
import { livePricesClient } from "../../services/livePrices";
import type { Bar, Interval } from "../../services/types";
import { INTERVALS } from "../../services/types";

import type { ChartType } from "../../services/types";
import { getSettingValue } from "../../services/settings";
import { getWidgetStateFromCache } from "../../grid/useLayout";

/** Module-level maps survive RGL remount cycles during drag */
const everLoaded = new Set<string>();
const lastState = new Map<
    string,
    { bars: Bar[]; interval: Interval; symbol: string }
>();

type ChartRefs = {
    chartRef: { current: IChartApi | null };
    seriesRef: { current: ISeriesApi<any> | null };
    intervalRef: { current: Interval };
};

type UseChartStateReturn = {
    status: "loading" | "ok" | "error";
    errorMsg: string;
    warning: string;
    symbol: string;
    interval: Interval;
    chartType: ChartType;
    timezone: string;
    stateReady: boolean;
    setSymbol: (s: string) => void;
    selectInterval: (i: Interval) => void;
    setChartType: (c: ChartType) => void;
    setTimezone: (t: string) => void;
    reapplyCurrentBars: () => void;
    captureRange: () => void;
    setPrevClose: (val: number | null) => void;
    everLoadedRef: typeof everLoaded;
    getLastState: (
        id: string,
    ) => { bars: Bar[]; interval: Interval; symbol: string } | undefined;
};

function getPeriod(_interval: Interval): string {
    return "max";
}

function getPollMs(interval: Interval): number {
    return ["1m", "5m", "15m"].includes(interval) ? 60_000 : 300_000;
}

function intervalSeconds(interval: Interval): number | null {
    if (interval === "1m") return 60;
    if (interval === "5m") return 300;
    if (interval === "15m") return 900;
    if (interval === "30m") return 1800;
    if (interval === "1h") return 3600;
    return null;
}

function bucketStart(timeSec: number, interval: Interval): number {
    if (interval === "1m") return Math.floor(timeSec / 60) * 60;
    if (interval === "5m") return Math.floor(timeSec / 300) * 300;
    if (interval === "15m") return Math.floor(timeSec / 900) * 900;
    if (interval === "30m") return Math.floor(timeSec / 1800) * 1800;
    if (interval === "1h") return Math.floor(timeSec / 3600) * 3600;

    const dt = new Date(timeSec * 1000);
    if (interval === "1d") {
        return Math.floor(
            Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) /
                1000,
        );
    }
    if (interval === "1wk") {
        const day = dt.getUTCDay();
        const offsetToMonday = (day + 6) % 7;
        const monday = new Date(
            Date.UTC(
                dt.getUTCFullYear(),
                dt.getUTCMonth(),
                dt.getUTCDate() - offsetToMonday,
            ),
        );
        return Math.floor(monday.getTime() / 1000);
    }
    return Math.floor(
        Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) / 1000,
    );
}

function alignedBucketStart(
    timeSec: number,
    interval: Interval,
    anchorTime: number | null,
): number {
    const step = intervalSeconds(interval);
    if (step === null || anchorTime === null) {
        return bucketStart(timeSec, interval);
    }
    const offset = ((anchorTime % step) + step) % step;
    return Math.floor((timeSec - offset) / step) * step + offset;
}

export function useChartState(
    id: string,
    refs: ChartRefs,
): UseChartStateReturn {
    const { chartRef, seriesRef, intervalRef } = refs;

    const _prev = lastState.get(id);
    const lastBarTimeRef = useRef<number | null>(null);
    const lastLiveTickMsRef = useRef<number>(Date.now());
    const latestBarRef = useRef<Bar | null>(
        _prev?.bars?.length ? _prev.bars[_prev.bars.length - 1] : null,
    );
    const chartStateRef = useRef<{ from: number; to: number } | null>(null);

    const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState("");
    const [warning, setWarning] = useState("");
    const [symbol, setSymbol] = useState(_prev?.symbol ?? "XU100.IS");
    const [interval, selectInterval] = useState<Interval>(
        _prev?.interval ?? "1d",
    );
    const [chartType, setChartType] = useState<ChartType>("candlestick");
    const [timezone, setTimezone] = useState<string>("Europe/Istanbul");
    const [stateReady, setStateReady] = useState(false);

    const chartTypeRef = useRef<ChartType>(chartType);
    const prevCloseRef = useRef<number | null>(null);
    useEffect(() => {
        chartTypeRef.current = chartType;
    }, [chartType]);

    const setPrevClose = useCallback((val: number | null) => {
        prevCloseRef.current = val;
        if (chartTypeRef.current === "baseline" && seriesRef.current && val !== null) {
            seriesRef.current.applyOptions({
                baseValue: { type: "price", price: val },
            });
        }
    }, [seriesRef]);

    // Restore persisted state from backend API on mount
    useEffect(() => {
        const applyState = (saved: any) => {
            if (saved) {
                if (
                    saved.interval &&
                    INTERVALS.includes(saved.interval as Interval)
                ) {
                    selectInterval(saved.interval as Interval);
                }
                if (saved.symbol) {
                    setSymbol(saved.symbol);
                }
                const restoredChartType =
                    saved.state?.chartType || saved.chartType;
                if (restoredChartType) {
                    setChartType(restoredChartType as ChartType);
                    chartTypeRef.current = restoredChartType as ChartType;
                }
                const restoredTimezone =
                    saved.state?.timezone || saved.timezone;
                if (restoredTimezone) {
                    setTimezone(restoredTimezone);
                }
                if (saved.state?.timeScale) {
                    chartStateRef.current = saved.state.timeScale;
                }
            }
        };

        const cached = getWidgetStateFromCache(id);
        if (cached) {
            applyState(cached);
            setStateReady(true);
            return;
        }

        void api
            .get<any>(`/user/widgets/${id}/state`)
            .then((saved) => {
                applyState(saved);
                setStateReady(true);
            })
            .catch(() => {
                setStateReady(true);
            });
    }, [id]);

    // Load fallback global timezone setting if not explicitly set per widget
    useEffect(() => {
        let cancelled = false;
        void getSettingValue<string>("basicChart.defaultTimezone")
            .then((globalTz) => {
                if (!cancelled && globalTz && !timezone) {
                    setTimezone(globalTz);
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    // Persist symbol+interval+chartType+timezone changes
    useEffect(() => {
        if (!stateReady) return;
        void api.put(`/user/widgets/${id}/state`, {
            symbol,
            interval,
            state: {
                chartType,
                timezone,
                timeScale: chartStateRef.current
                    ? chartStateRef.current
                    : undefined,
            },
        });
    }, [id, symbol, interval, chartType, timezone, stateReady]);

    function calculateHeikinAshi(bars: Bar[]): Bar[] {
        if (!bars.length) return [];
        const result: Bar[] = [];
        let prevHaOpen = (bars[0].open + bars[0].close) / 2;
        let prevHaClose =
            (bars[0].open + bars[0].high + bars[0].low + bars[0].close) / 4;

        for (let i = 0; i < bars.length; i++) {
            const b = bars[i];
            const haClose = (b.open + b.high + b.low + b.close) / 4;
            const haOpen =
                i === 0 ? prevHaOpen : (prevHaOpen + prevHaClose) / 2;
            const haHigh = Math.max(b.high, haOpen, haClose);
            const haLow = Math.min(b.low, haOpen, haClose);

            result.push({
                time: b.time,
                open: haOpen,
                high: haHigh,
                low: haLow,
                close: haClose,
            });

            prevHaOpen = haOpen;
            prevHaClose = haClose;
        }
        return result;
    }

    function formatSeriesPoint(bar: Bar, type: ChartType): any {
        if (type === "line" || type === "area" || type === "baseline") {
            return { time: bar.time as UTCTimestamp, value: bar.close };
        }
        return {
            time: bar.time as UTCTimestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
        };
    }

    function formatSeriesData(bars: Bar[], type: ChartType): any[] {
        if (type === "heikin_ashi") {
            const haBars = calculateHeikinAshi(bars);
            return haBars.map((b) => ({
                time: b.time as UTCTimestamp,
                open: b.open,
                high: b.high,
                low: b.low,
                close: b.close,
            }));
        }
        return bars.map((b) => formatSeriesPoint(b, type));
    }

    const applyBars = useCallback(
        (bars: Bar[], fit: boolean) => {
            const series = seriesRef.current;
            if (!series) return;
            intervalRef.current = interval;
            series.setData(formatSeriesData(bars, chartTypeRef.current));
            if (chartTypeRef.current === "baseline" && bars.length) {
                const basePrice =
                    prevCloseRef.current ??
                    (bars.length > 1
                        ? bars[bars.length - 2].close
                        : bars[0].close);
                series.applyOptions({
                    baseValue: { type: "price", price: basePrice },
                });
            }
            chartRef.current?.timeScale().applyOptions({
                timeVisible: !["1d", "1wk", "1mo"].includes(interval),
                secondsVisible: false,
            });
            if (fit) {
                chartRef.current?.timeScale();
            } else if (chartStateRef.current) {
                chartRef.current
                    ?.timeScale()
                    .setVisibleRange(chartStateRef.current as never);
            }
            lastState.set(id, { bars, interval, symbol });
            latestBarRef.current = bars.length ? bars[bars.length - 1] : null;
            lastBarTimeRef.current = latestBarRef.current?.time ?? null;
            everLoaded.add(id);
            setStatus("ok");
        },
        [id, symbol, interval, chartRef, seriesRef, intervalRef],
    );

    const reapplyCurrentBars = useCallback(() => {
        const state = lastState.get(id);
        if (state?.bars?.length) {
            applyBars(state.bars, false);
        }
    }, [id, applyBars]);

    const captureRange = useCallback(() => {
        if (!chartRef.current) return;
        const range = chartRef.current.timeScale().getVisibleRange();
        chartStateRef.current = range
            ? { from: range.from as number, to: range.to as number }
            : null;
    }, [chartRef]);

    const saveChartState = useCallback(async () => {
        if (!chartRef.current) return;
        try {
            const range = chartRef.current.timeScale().getVisibleRange();
            chartStateRef.current = range
                ? { from: range.from as number, to: range.to as number }
                : null;
            await api.put(`/user/widgets/${id}/state`, {
                symbol,
                interval,
                state: {
                    chartType: chartTypeRef.current,
                    timezone,
                    timeScale: chartStateRef.current,
                },
            });
        } catch {
            /* ignore */
        }
    }, [id, symbol, interval, timezone, chartRef]);

    // Data load + polling
    useEffect(() => {
        const series = seriesRef.current;
        if (!series || !stateReady) return;

        let cancelled = false;
        const ctrl = new AbortController();

        const initialLoad = async () => {
            try {
                setStatus("loading");
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
                let latestTime = latestBarRef.current?.time ?? null;
                let lastApplied: Bar | null = null;
                for (const candle of data.candles) {
                    if (latestTime !== null && candle.time < latestTime) {
                        continue;
                    }
                    series.update(
                        formatSeriesPoint(candle, chartTypeRef.current),
                    );
                    latestTime = candle.time;
                    lastApplied = candle;
                }
                if (!lastApplied) return;
                lastBarTimeRef.current = lastApplied.time;
                latestBarRef.current = lastApplied;
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

    // Live websocket ticks - update current candle or append next bucket.
    useEffect(() => {
        if (!stateReady) return;

        const unsubscribe = livePricesClient.onTick((tick) => {
            if (tick.symbol !== symbol) return;
            const series = seriesRef.current;
            if (!series) return;

            lastLiveTickMsRef.current = Date.now();
            const intervalNow = intervalRef.current;
            const prev = latestBarRef.current;
            const tickTimeSec = Math.floor(tick.ts / 1000);
            const bucket = alignedBucketStart(
                tickTimeSec,
                intervalNow,
                prev?.time ?? null,
            );
            const step = intervalSeconds(intervalNow);

            const nextBar: Bar =
                prev && (step === null || bucket <= prev.time)
                    ? {
                          ...prev,
                          high: Math.max(prev.high, tick.price),
                          low: Math.min(prev.low, tick.price),
                          close: tick.price,
                      }
                    : prev && bucket > prev.time
                      ? {
                            time: bucket,
                            open: prev.close,
                            high: tick.price,
                            low: tick.price,
                            close: tick.price,
                        }
                      : {
                            time: bucket,
                            open: tick.price,
                            high: tick.price,
                            low: tick.price,
                            close: tick.price,
                        };

            if (prev && nextBar.time < prev.time) {
                return;
            }

            series.update(formatSeriesPoint(nextBar, chartTypeRef.current));
            latestBarRef.current = nextBar;
            lastBarTimeRef.current = nextBar.time;
            setWarning("");
        });

        return unsubscribe;
    }, [stateReady, symbol, seriesRef, intervalRef]);

    // If no live tick arrives for 60s, force a since-backfill pull as recovery.
    useEffect(() => {
        if (!stateReady) return;

        let cancelled = false;
        const ctrl = new AbortController();

        const timer = setInterval(() => {
            if (cancelled) return;
            if (!everLoaded.has(id) || lastBarTimeRef.current === null) return;

            const silenceMs = Date.now() - lastLiveTickMsRef.current;
            if (silenceMs < 60_000) return;

            void fetchHistory(
                symbol,
                intervalRef.current,
                getPeriod(intervalRef.current),
                lastBarTimeRef.current,
                ctrl.signal,
            )
                .then((data) => {
                    if (cancelled || !data.candles.length) return;
                    const series = seriesRef.current;
                    if (!series) return;
                    let latestTime = latestBarRef.current?.time ?? null;
                    let lastApplied: Bar | null = null;
                    for (const candle of data.candles) {
                        if (latestTime !== null && candle.time < latestTime) {
                            continue;
                        }
                        series.update(
                            formatSeriesPoint(candle, chartTypeRef.current),
                        );
                        latestTime = candle.time;
                        lastApplied = candle;
                    }
                    if (!lastApplied) return;
                    latestBarRef.current = lastApplied;
                    lastBarTimeRef.current = lastApplied.time;
                    setWarning("");
                    lastLiveTickMsRef.current = Date.now();
                })
                .catch((err) => {
                    if (cancelled) return;
                    if (
                        err instanceof DOMException &&
                        err.name === "AbortError"
                    )
                        return;
                    setWarning(
                        err instanceof Error ? err.message : "Network error",
                    );
                });
        }, 10_000);

        return () => {
            cancelled = true;
            ctrl.abort();
            clearInterval(timer);
        };
    }, [id, symbol, stateReady, seriesRef, intervalRef]);

    return {
        status,
        errorMsg,
        warning,
        symbol,
        interval,
        chartType,
        timezone,
        stateReady,
        setSymbol,
        selectInterval,
        setChartType,
        setTimezone,
        reapplyCurrentBars,
        captureRange,
        setPrevClose,
        everLoadedRef: everLoaded,
        getLastState: (i: string) => lastState.get(i),
    };
}
