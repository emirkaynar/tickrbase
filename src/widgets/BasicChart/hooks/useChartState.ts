import { useEffect, useRef, useState, useCallback, useMemo } from "preact/hooks";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import { applyChartScale, setInitialChartRange } from "../chartConfig";
import { useWidgetState } from "../../settings/useWidgetState";
import { stateRecord } from "../../settings/widgetStateStore";

import type { WidgetSettingsProps } from "../../settings/types";
import { defaultWidgetSettings, isWidgetSettingValue, widgetSettingItems } from "../../settings/definitions";
import { graphicSettingsDefinition, resolveGraphicSettings } from "../settings/graphicSettings";
import type { GraphicSettings } from "../settings/graphicSettings";
import type { Bar, Interval, ScaleMode, MarketContext } from "../../../services/types";
import { INTERVALS } from "../../../services/types";

import type { ChartType } from "../../../services/types";
import { useUserTimezone } from "../../../services/useUserTimezone";
import { useChartData } from "./useChartData";
import { SessionLines } from "../sessionLines";
import { observationGaps, gapWhitespace } from "../observationGaps";
import { intervalSeconds } from "../barStore";
import { candleContext, regularBars, sessionBoundaries } from "../sessionPolicy";
import { getWidgetCacheToken, isWidgetCacheCurrent, registerWidgetCache } from "../../widgetCache";

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
    settings: WidgetSettingsProps;
    graphicSettings: GraphicSettings;
    setSymbol: (s: string) => void;
    selectInterval: (i: Interval) => void;
    setChartType: (c: ChartType) => void;
    setScaleMode: (m: ScaleMode) => void;
    applyScaleFormatting: () => void;
    reapplyCurrentBars: () => void;
    initializeRange: () => void;
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
    const boundaryTimesRef = useRef<number[]>([]);
    const primitiveRef = useRef<{ series: ISeriesApi<any>; primitive: SessionLines } | null>(null);
    const initialRangeRef = useRef<{ chart: IChartApi; symbol: string; interval: Interval } | null>(null);

    const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
    const [errorMsg, setErrorMsg] = useState("");
    const [warning, setWarning] = useState("");
    const persisted = useWidgetState(id);
    const saved = persisted.document;

    const symbol = saved.symbol || _prev?.symbol || "XU100.IS";
    const interval = INTERVALS.includes(saved.interval as Interval) ? saved.interval as Interval : _prev?.interval ?? "1d";
    const savedChartType = saved.state.chartType;
    const chartType: ChartType = ["candlestick", "heikin_ashi", "line", "area", "bar", "baseline"].includes(String(savedChartType))
        ? savedChartType as ChartType : "candlestick";
    const timezone = useUserTimezone();
    const savedScaleMode = stateRecord(saved.state.priceScale).mode;
    const scaleMode: ScaleMode = savedScaleMode === "percentage" || savedScaleMode === "logarithmic" ? savedScaleMode : "normal";
    // A failed preference load can still display data, but the owner blocks all writes until retry succeeds.
    const stateReady = persisted.ready || persisted.status === "error";
    const graphicSettings = useMemo(() => resolveGraphicSettings(stateRecord(saved.state.settings)), [saved.state.settings]);
    const initializeRange = useCallback(() => {
        const chart = chartRef.current, series = seriesRef.current;
        const cached = lastState.get(id);
        const initialized = initialRangeRef.current;
        if (!chart || !series || cached?.symbol !== symbol || cached.interval !== interval
            || (initialized?.chart === chart && initialized.symbol === symbol && initialized.interval === interval)) return;
        if (setInitialChartRange(chart, series)) initialRangeRef.current = { chart, symbol, interval };
    }, [id, symbol, interval, chartRef, seriesRef]);
    const setSymbol = useCallback((symbol: string) => persisted.update(document => ({ ...document, symbol })), [persisted.update]);
    const selectInterval = useCallback((interval: Interval) => persisted.update(document => ({ ...document, interval })), [persisted.update]);
    const setChartType = useCallback((chartType: ChartType) => persisted.update(document => ({
        ...document, state: { ...document.state, chartType },
    })), [persisted.update]);
    const setScaleMode = useCallback((mode: ScaleMode) => {
        persisted.update(document => ({
            ...document,
            state: { ...document.state, priceScale: { ...stateRecord(document.state.priceScale), mode } },
        }));
    }, [persisted.update]);
    const settings: WidgetSettingsProps = {
        definition: graphicSettingsDefinition, values: graphicSettings,
        ready: persisted.ready, status: persisted.status, error: persisted.error, onRetry: () => { void persisted.retry(); },
        onChange: (key, value) => {
            const definition = widgetSettingItems(graphicSettingsDefinition).find(item => item.id === key);
            if (!definition || !isWidgetSettingValue(definition, value)) return;
            persisted.update(document => ({ ...document, state: {
                ...document.state, settings: { ...stateRecord(document.state.settings), [key]: value },
            } }));
        },
        onReset: () => persisted.update(document => ({ ...document, state: {
            ...document.state, settings: { ...stateRecord(document.state.settings), ...defaultWidgetSettings(graphicSettingsDefinition) },
        } })),
    };

    const chartTypeRef = useRef<ChartType>(chartType);
    const prevCloseRef = useRef<number | null>(null);
    const scaleModeRef = useRef(scaleMode);
    scaleModeRef.current = scaleMode;
    useEffect(() => {
        chartTypeRef.current = chartType;
    }, [chartType]);

    const applyScaleFormatting = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        applyChartScale(chart, seriesRef.current, scaleModeRef.current);
    }, [chartRef, seriesRef]);

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
    }, [seriesRef]);


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
            const lastTime = series.data().at(-1)?.time;
            const lastIndex = lastTime === undefined ? null : chart?.timeScale().timeToIndex(lastTime);
            const nearLatest = !logical || lastIndex == null || logical.to >= lastIndex - 2;

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
            primitiveRef.current.primitive.setContext(intraday ? context : null, gaps, bars.at(-1)?.time ?? null);
            const boundaries = intraday ? sessionBoundaries(bars, context) : [];
            const boundariesChanged = boundaries.length !== boundaryTimesRef.current.length || boundaries.some((time, index) => time !== boundaryTimesRef.current[index]);
            boundaryTimesRef.current = boundaries;
            if (!live || gapChanged || boundariesChanged) boundarySeriesRef.current?.setData([...new Set([...boundaries, ...gapWhitespace(gaps, interval), ...gaps.map(gap => gap.end)])].sort((a, b) => a - b).map(time => ({ time: time as UTCTimestamp })));
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
            if (chart && !fit && range && !nearLatest) {
                chart.timeScale().setVisibleRange(range);
            }
            lastState.set(id, { bars, interval, symbol });
            if (bars.length) initializeRange();

            everLoaded.add(id);
            setStatus("ok");
        },
        [id, symbol, interval, chartRef, seriesRef, intervalRef, cacheToken, initializeRange],
    );

    const reapplyCurrentBars = useCallback(() => {
        const state = lastState.get(id);
        if (state && state.symbol === symbol && state.interval === interval) {
            applyBars(state.bars, false);
        } else {
            applyBars([], false, null);
        }
    }, [id, symbol, interval, applyBars]);


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
        settings,
        graphicSettings,
        setSymbol,
        selectInterval,
        setChartType,
        setScaleMode,
        applyScaleFormatting,
        reapplyCurrentBars,
        initializeRange,
        setPrevClose,
        everLoadedRef: everLoaded,
        getLastState: (i: string) => lastState.get(i),
    };
}
