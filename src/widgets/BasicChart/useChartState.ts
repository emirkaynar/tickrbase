import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { PriceScaleMode, LineSeries } from "lightweight-charts";
import { api } from "../../services/api";
import type { Bar, Interval, ScaleMode, MarketContext } from "../../services/types";
import { INTERVALS } from "../../services/types";

import type { ChartType } from "../../services/types";
import { useUserTimezone } from "../../services/useUserTimezone";
import { useChartData } from "./useChartData";
import { SessionLines } from "./sessionLines";
import { observationGaps, gapWhitespace } from "./observationGaps";
import { intervalSeconds } from "./barStore";
import { candleContext, regularBars, sessionBoundaries } from "./sessionPolicy";
import { getWidgetCacheToken, getWidgetStateFromCache, isWidgetCacheCurrent, registerWidgetCache } from "../widgetCache";

/** Module-level maps survive RGL remount cycles during drag */
const everLoaded = registerWidgetCache("loadedCharts", new Set<string>());
const lastState = registerWidgetCache("chartBars", new Map<
    string,
    { bars: Bar[]; interval: Interval; symbol: string }
>());

type ChartRefs = {
    chartRef: { current: IChartApi | null };
    seriesRef: { current: ISeriesApi<any> | null };
    intervalRef: { current: Interval };
};

type UseChartStateReturn = {
    data: ReturnType<typeof useChartData>;
    status: "loading" | "ok" | "error";
    errorMsg: string;
    warning: string;
    symbol: string;
    interval: Interval;
    chartType: ChartType;
    timezone: string;
    scaleMode: ScaleMode;
    stateReady: boolean;
    setSymbol: (s: string) => void;
    selectInterval: (i: Interval) => void;
    setChartType: (c: ChartType) => void;
    setScaleMode: (m: ScaleMode) => void;
    applyScaleFormatting: () => void;
    reapplyCurrentBars: () => void;
    captureRange: () => void;
    setPrevClose: (val: number | null) => void;
    everLoadedRef: typeof everLoaded;
    getLastState: (
        id: string,
    ) => { bars: Bar[]; interval: Interval; symbol: string } | undefined;
};

export function useChartState(
    id: string,
    refs: ChartRefs,
): UseChartStateReturn {
    const { chartRef, seriesRef, intervalRef } = refs;

    const cacheToken = getWidgetCacheToken(id);
    const _prev = lastState.get(id);
    const contextRef = useRef<MarketContext | null>(null);
    const boundarySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const gapCountRef = useRef(-1);
    const primitiveRef = useRef<{ series: ISeriesApi<any>; primitive: SessionLines } | null>(null);
    const chartStateRef = useRef<{ from: number; to: number } | null>(null);

    const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState("");
    const [warning, setWarning] = useState("");
    const [symbol, setSymbol] = useState(_prev?.symbol ?? "XU100.IS");
    const [interval, selectInterval] = useState<Interval>(
        _prev?.interval ?? "1d",
    );
    const [chartType, setChartType] = useState<ChartType>("candlestick");
    const timezone = useUserTimezone();
    const [scaleMode, setScaleMode] = useState<ScaleMode>("normal");
    const [stateReady, setStateReady] = useState(false);

    const chartTypeRef = useRef<ChartType>(chartType);
    const prevCloseRef = useRef<number | null>(null);
    useEffect(() => {
        chartTypeRef.current = chartType;
    }, [chartType]);

    const applyScaleFormatting = useCallback(() => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        if (!chart) return;

        if (scaleMode === "logarithmic") {
            chart.priceScale("right").applyOptions({
                mode: PriceScaleMode.Logarithmic,
            });
            if (series) {
                series.applyOptions({
                    priceFormat: {
                        type: "price",
                        precision: 2,
                        minMove: 0.01,
                    },
                });
            }
        } else if (scaleMode === "percentage") {
            chart.priceScale("right").applyOptions({
                mode: PriceScaleMode.Normal,
            });
            if (series) {
                const basePrice = prevCloseRef.current;
                series.applyOptions({
                    priceFormat: {
                        type: "custom",
                        formatter: (price: number) => {
                            if (!basePrice || basePrice === 0)
                                return price.toFixed(2);
                            const pct =
                                ((price - basePrice) / basePrice) * 100;
                            const formatted = pct.toFixed(2);
                            return `${pct > 0 ? "+" : ""}${formatted}%`;
                        },
                        minMove: 0.01,
                    },
                });
            }
        } else {
            chart.priceScale("right").applyOptions({
                mode: PriceScaleMode.Normal,
            });
            if (series) {
                series.applyOptions({
                    priceFormat: {
                        type: "price",
                        precision: 2,
                        minMove: 0.01,
                    },
                });
            }
        }
    }, [scaleMode, chartRef, seriesRef]);

    useEffect(() => {
        applyScaleFormatting();
    }, [scaleMode, applyScaleFormatting]);

    const setPrevClose = useCallback((val: number | null) => {
        prevCloseRef.current = val;
        if (chartTypeRef.current === "baseline" && seriesRef.current && val !== null) {
            seriesRef.current.applyOptions({
                baseValue: { type: "price", price: val },
            });
        }
        applyScaleFormatting();
    }, [seriesRef, applyScaleFormatting]);

    // Restore persisted state from backend API on mount
    useEffect(() => {
        if (!isWidgetCacheCurrent(id, cacheToken)) return;
        let cancelled = false;
        const controller = new AbortController();
        const active = () => !cancelled && isWidgetCacheCurrent(id, cacheToken);
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
                if (saved.state?.timeScale) {
                    chartStateRef.current = saved.state.timeScale;
                }
                if (saved.state?.priceScale) {
                    if (saved.state.priceScale.mode) {
                        setScaleMode(saved.state.priceScale.mode as ScaleMode);
                    }
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
            .get<any>(`/user/widgets/${id}/state`, controller.signal)
            .then((saved) => {
                if (!active()) return;
                applyState(saved);
                setStateReady(true);
            })
            .catch(() => {
                if (active()) setStateReady(true);
            });
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [id, cacheToken]);

    // Persist chart preferences; display timezone belongs to user settings.
    useEffect(() => {
        if (!stateReady || !isWidgetCacheCurrent(id, cacheToken)) return;
        void api.put(`/user/widgets/${id}/state`, {
            symbol,
            interval,
            state: {
                chartType,
                priceScale: {
                    mode: scaleMode,
                },
                timeScale: chartStateRef.current
                    ? chartStateRef.current
                    : undefined,
            },
        });
    }, [id, symbol, interval, chartType, scaleMode, stateReady, cacheToken]);

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
        (bars: Bar[], fit: boolean, context: MarketContext | null = contextRef.current, live = false) => {
            if (!isWidgetCacheCurrent(id, cacheToken)) return;
            const series = seriesRef.current;
            if (!series) return;
            intervalRef.current = interval;
            const chart = chartRef.current;
            const range = chart?.timeScale().getVisibleRange();
            const logical = chart?.timeScale().getVisibleLogicalRange();
            const nearLatest = !logical || logical.to >= series.data().length - 2;
            contextRef.current = context;
            const intraday = intervalSeconds(interval) !== null;
            if (intraday) bars = regularBars(bars, context);
            if (chart && !boundarySeriesRef.current) {
                boundarySeriesRef.current = chart.addSeries(LineSeries, { visible: false, lastValueVisible: false, priceLineVisible: false });
            }
            if (primitiveRef.current?.series !== series) {
                const primitive = new SessionLines();
                series.attachPrimitive(primitive);
                primitiveRef.current = { series, primitive };
            }
            const gaps = observationGaps(bars, interval, candleContext(context));
            const gapChanged = gapCountRef.current !== gaps.length;
            gapCountRef.current = gaps.length;
            primitiveRef.current.primitive.setContext(intraday ? context : null, gaps);
            const boundaries = intraday ? sessionBoundaries(bars, context) : [];
            if (!live || gapChanged) boundarySeriesRef.current?.setData([...new Set([...boundaries, ...gapWhitespace(gaps, interval), ...gaps.map(gap => gap.end)])].sort((a, b) => a - b).map(time => ({ time: time as UTCTimestamp })));
            if (live && !gapChanged && chartTypeRef.current !== "heikin_ashi" && bars.length && series.data().length) {
                series.update(formatSeriesPoint(bars[bars.length - 1], chartTypeRef.current));
            } else {
                const points = formatSeriesData(bars, chartTypeRef.current);
                if (["line", "area", "baseline"].includes(chartTypeRef.current)) {
                    // Per-point colors govern the segment leaving that point.
                    // Hide the segment crossing an observed gap without inventing prices.
                    for (let i = 0; i < bars.length - 1; i++) {
                        if (gaps.some(gap => gap.start >= bars[i].time && gap.end <= bars[i + 1].time)) {
                            Object.assign(points[i], { color: "transparent", lineColor: "transparent", topColor: "transparent", bottomColor: "transparent", topLineColor: "transparent", bottomLineColor: "transparent", topFillColor1: "transparent", topFillColor2: "transparent", bottomFillColor1: "transparent", bottomFillColor2: "transparent" });
                        }
                    }
                }
                series.setData(points);
            }
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
            if (fit && chartStateRef.current && bars.length) {
                chart?.timeScale().setVisibleRange(chartStateRef.current as never);
            } else if (fit && bars.length && !range) {
                chart?.timeScale().fitContent();
            } else if (!fit && range && !nearLatest) {
                chart?.timeScale().setVisibleRange(range);
            }
            lastState.set(id, { bars, interval, symbol });

            everLoaded.add(id);
            setStatus("ok");
        },
        [id, symbol, interval, chartRef, seriesRef, intervalRef, cacheToken],
    );

    const reapplyCurrentBars = useCallback(() => {
        const state = lastState.get(id);
        if (state && state.symbol === symbol && state.interval === interval) {
            applyBars(state.bars, false);
        } else {
            applyBars([], false, null);
        }
    }, [id, symbol, interval, applyBars]);

    const captureRange = useCallback(() => {
        if (!chartRef.current) return;
        const range = chartRef.current.timeScale().getVisibleRange();
        chartStateRef.current = range
            ? { from: range.from as number, to: range.to as number }
            : null;
    }, [chartRef]);

    const onDataStatus = useCallback((next: "loading" | "ok" | "error", message?: string) => {
        setStatus(next);
        setErrorMsg(message ?? "");
    }, []);
    const data = useChartData(id, symbol, interval, stateReady, applyBars, onDataStatus, setWarning);

    return {
        data,
        status,
        errorMsg,
        warning,
        symbol,
        interval,
        chartType,
        timezone,
        scaleMode,
        stateReady,
        setSymbol,
        selectInterval,
        setChartType,
        setScaleMode,
        applyScaleFormatting,
        reapplyCurrentBars,
        captureRange,
        setPrevClose,
        everLoadedRef: everLoaded,
        getLastState: (i: string) => lastState.get(i),
    };
}
