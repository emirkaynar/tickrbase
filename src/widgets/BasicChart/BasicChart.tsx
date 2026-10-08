import { useEffect, useRef, useCallback } from "preact/hooks";
import { ChevronDown } from "lucide-react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { createChart } from "lightweight-charts";
import { Select, TickerSelector, Tooltip } from "../../ui";
import type { SelectItem } from "../../ui";
import { Shell } from "../Shell";
import { ChartMarketOverlay } from "./components/ChartMarketOverlay";
import { applyGraphicSettings } from "./settings/graphicSettings";
import { useChartQuote } from "./hooks/useChartQuote";
import { useInstrumentIdentity } from "./hooks/useInstrumentIdentity";
import { useChartState } from "./hooks/useChartState";
import { useExtendedPriceLabel } from "./hooks/useExtendedPriceLabel";
import { createChartConfig, getSeriesColors } from "./chartConfig";

import { addChartSeries } from "./seriesFactory";
import { registerWidget } from "../registry";
import { INTERVALS, INTERVAL_CONFIG } from "../../services/types";
import type { ChartType, Interval } from "../../services/types";
import { livePricesClient } from "../../services/livePrices";

import styles from "./BasicChart.module.css";

type Props = { id: string; onRemove: () => void };

const INTERVAL_ITEMS: SelectItem[] = INTERVALS.map((i) => ({
    label: INTERVAL_CONFIG[i].label,
    value: i,
}));

const CHART_TYPE_ITEMS: SelectItem[] = [
    { label: "Candles", value: "candlestick" },
    { label: "Line", value: "line" },
    { label: "Area", value: "area" },
    { label: "Bar", value: "bar" },
    { label: "Baseline", value: "baseline" },
    { label: "Heikin-Ashi", value: "heikin_ashi" },
];

function BasicChart({ id, onRemove }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<any> | null>(null);
    const intervalRef = useRef<Interval>("1d");
    const seriesTypeRef = useRef<ChartType | null>(null);



    const {
        data,
        symbol,
        setSymbol,
        interval,
        selectInterval,
        chartType,
        setChartType,
        timezone,
        status,
        errorMsg,
        warning,
        stateReady,
        reapplyCurrentBars,
        initializeRange,
        setPrevClose,
        scaleMode,
        setScaleMode,
        applyScaleFormatting,
        settings,
        graphicSettings,
    } = useChartState(id, { chartRef, seriesRef, intervalRef });

    const quote = useChartQuote(symbol, stateReady, data.lastTick, setPrevClose);
    const identity = useInstrumentIdentity(symbol, stateReady);

    const isIntraday = !["1d", "1wk", "1mo"].includes(interval);

    // Keep websocket subscription map in sync with current widget symbol.
    useEffect(() => {
        if (!stateReady) return;
        livePricesClient.updateSymbol(id, symbol);
    }, [id, symbol, stateReady]);



    // Create chart once container is ready
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const config = createChartConfig(isIntraday, timezone, data.marketContext?.exchange_timezone ?? "UTC");
        const chart = createChart(container, {
            ...config,
            width: container.clientWidth,
            height: container.clientHeight,

        });

        const series = addChartSeries(chart, chartType);
        chartRef.current = chart;
        seriesRef.current = series;
        seriesTypeRef.current = chartType;

        reapplyCurrentBars();
        applyScaleFormatting();
        applyGraphicSettings(chart, series, graphicSettings);

        return () => {

            chartRef.current = null;
            seriesRef.current = null;
            seriesTypeRef.current = null;
            chart.remove();
            livePricesClient.removeWidget(id);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    // Update chart config when intraday flag or timezone changes
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions(createChartConfig(isIntraday, timezone, data.marketContext?.exchange_timezone ?? "UTC"));
        chartRef.current.applyOptions({ autoSize: false });
        applyGraphicSettings(chartRef.current, seriesRef.current, graphicSettings);
    }, [isIntraday, timezone, data.marketContext?.exchange_timezone, graphicSettings]);

    // ResizeObserver — syncs chart canvas to its DOM container
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
        const ro = new ResizeObserver(() => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!chartRef.current) return;
                chartRef.current.resize(
                    container.clientWidth,
                    container.clientHeight,
                );
                initializeRange();
            });
        });

        ro.observe(container);
        return () => {
            ro.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [initializeRange]);

    // Re-apply colors when theme changes (data-theme attribute mutation)
    useEffect(() => {
        const observer = new MutationObserver(() => {
            if (!chartRef.current || !seriesRef.current) return;
            chartRef.current.applyOptions(
                createChartConfig(isIntraday, timezone, data.marketContext?.exchange_timezone ?? "UTC"),
            );
            seriesRef.current.applyOptions(getSeriesColors(chartType));
            applyGraphicSettings(chartRef.current, seriesRef.current, graphicSettings);
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        return () => observer.disconnect();
    }, [isIntraday, timezone, chartType, data.marketContext?.exchange_timezone, graphicSettings]);

    const seriesLifecycleRef = useRef({ reapplyCurrentBars, applyScaleFormatting, graphicSettings });
    seriesLifecycleRef.current = { reapplyCurrentBars, applyScaleFormatting, graphicSettings };

    // Only chart-type changes require a new series; scale and data updates do not.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || seriesTypeRef.current === chartType) return;
        const lifecycle = seriesLifecycleRef.current;
        const visibleRange = chart.timeScale().getVisibleLogicalRange();
        if (seriesRef.current) {
            chart.removeSeries(seriesRef.current);
        }
        seriesRef.current = addChartSeries(chart, chartType);
        seriesTypeRef.current = chartType;
        lifecycle.reapplyCurrentBars();
        if (visibleRange) chart.timeScale().setVisibleLogicalRange(visibleRange);
        lifecycle.applyScaleFormatting();
        applyGraphicSettings(chart, seriesRef.current, lifecycle.graphicSettings);
    }, [chartType]);

    useExtendedPriceLabel(chartRef, seriesRef, symbol, interval, chartType, data);

    const handleSymbolSelect = useCallback(
        (value: string) => {
            if (value && settings.ready) {
                setSymbol(value);
                livePricesClient.updateSymbol(id, value);
            }
        },
        [setSymbol, id, settings.ready],
    );

    const handleIntervalSelect = useCallback(
        (value: string) => {
            if (INTERVALS.includes(value as Interval))
                selectInterval(value as Interval);
        },
        [selectInterval],
    );

    const handleChartTypeSelect = useCallback(
        (value: string) => {
            if (
                [
                    "candlestick",
                    "heikin_ashi",
                    "line",
                    "area",
                    "bar",
                    "baseline",
                ].includes(value)
            ) {
                setChartType(value as ChartType);
            }
        },
        [setChartType],
    );

    const tickerTrigger = (
        <button type="button" class={styles.tickerTrigger} disabled={!settings.ready} aria-label={`Change ticker, current symbol ${symbol}`}>
            <span class={styles.triggerSymbol}>{symbol}</span>
            <ChevronDown size={12} aria-hidden="true" />
        </button>
    );

    return (
                <Shell
                    id={id}
                    className={styles.root}
                    settings={settings}
                    headerLeft={
                        <>
                            <TickerSelector
                                value={symbol}
                                placeholder="Ticker..."
                                onChange={handleSymbolSelect}
                                trigger={tickerTrigger}
                            />
                        </>
                    }
                    headerRight={
                        <>
                            <Select
                                items={INTERVAL_ITEMS}
                                value={interval}
                                disabled={!settings.ready}
                                onChange={handleIntervalSelect}
                                variant="widget"
                            />
                            <Select
                                items={CHART_TYPE_ITEMS}
                                value={chartType}
                                disabled={!settings.ready}
                                onChange={handleChartTypeSelect}
                                variant="widget"
                            />

                        </>
                    }
                    loading={(!stateReady || status === "loading") && !quote.ready}
                    error={status === "error" && !quote.ready ? errorMsg : null}
                    onRemove={onRemove}
                >
                    <div class={styles.chartContainer} ref={containerRef}>
                        <ChartMarketOverlay
                            symbol={symbol} identity={identity} data={data} quote={quote}
                            warning={status === "error" ? errorMsg : warning}
                        />
                        <div class={styles.axisCorner}>
                            <Tooltip content="Logarithmic Scale">
                                <button
                                    type="button"
                                    disabled={!settings.ready}
                                    class={[
                                        styles.scaleBtn,
                                        scaleMode === "logarithmic"
                                            ? styles.scaleBtnActive
                                            : "",
                                    ].join(" ")}
                                    onClick={() =>
                                        setScaleMode(
                                            scaleMode === "logarithmic"
                                                ? "normal"
                                                : "logarithmic",
                                        )
                                    }
                                    aria-label="Toggle Logarithmic Scale"
                                >
                                    LOG
                                </button>
                            </Tooltip>
                            <Tooltip content="Percentage Scale">
                                <button
                                    type="button"
                                    disabled={!settings.ready}
                                    class={[
                                        styles.scaleBtn,
                                        scaleMode === "percentage"
                                            ? styles.scaleBtnActive
                                            : "",
                                    ].join(" ")}
                                    onClick={() =>
                                        setScaleMode(
                                            scaleMode === "percentage"
                                                ? "normal"
                                                : "percentage",
                                        )
                                    }
                                    aria-label="Toggle percentage scale relative to the first visible value"
                                    aria-pressed={scaleMode === "percentage"}
                                >
                                    %
                                </button>
                            </Tooltip>
                        </div>
                    </div>
                </Shell>
    );
}

// Self-register on import
registerWidget({
    type: "basic-chart",
    label: "Basic Chart",
    defaultSize: { w: 8, h: 9 },
    minSize: { w: 6, h: 6 },
    component: BasicChart,
});

export { BasicChart };
