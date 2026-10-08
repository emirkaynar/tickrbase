import { useEffect, useRef, useCallback } from "preact/hooks";
import { ChevronDown } from "lucide-react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { createChart } from "lightweight-charts";
import { Select, TickerSelector, Tooltip } from "../../ui";
import type { SelectItem } from "../../ui";
import { Shell } from "../Shell";
import { ChartDetailsPopover } from "./components/ChartDetailsPopover";
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
        captureRange,
        setPrevClose,
        scaleMode,
        setScaleMode,
        applyScaleFormatting,
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

        const chart = createChart(container, {
            ...createChartConfig(isIntraday, timezone, data.marketContext?.exchange_timezone ?? "UTC"),
            width: container.clientWidth,
            height: container.clientHeight,
        });

        const series = addChartSeries(chart, chartType);
        chartRef.current = chart;
        seriesRef.current = series;

        return () => {
            chartRef.current = null;
            seriesRef.current = null;
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
    }, [isIntraday, timezone, data.marketContext?.exchange_timezone]);

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
                chartRef.current.timeScale();
            });
        });

        ro.observe(container);
        return () => {
            ro.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, []);

    // Re-apply colors when theme changes (data-theme attribute mutation)
    useEffect(() => {
        const observer = new MutationObserver(() => {
            if (!chartRef.current || !seriesRef.current) return;
            chartRef.current.applyOptions(
                createChartConfig(isIntraday, timezone, data.marketContext?.exchange_timezone ?? "UTC"),
            );
            seriesRef.current.applyOptions(getSeriesColors(chartType));
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        return () => observer.disconnect();
    }, [isIntraday, timezone, chartType, data.marketContext?.exchange_timezone]);

    const seriesLifecycleRef = useRef({ captureRange, reapplyCurrentBars, applyScaleFormatting });
    seriesLifecycleRef.current = { captureRange, reapplyCurrentBars, applyScaleFormatting };

    // Only chart-type changes require a new series; scale and data updates do not.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const lifecycle = seriesLifecycleRef.current;
        lifecycle.captureRange();
        if (seriesRef.current) {
            chart.removeSeries(seriesRef.current);
        }
        seriesRef.current = addChartSeries(chart, chartType);
        lifecycle.reapplyCurrentBars();
        lifecycle.applyScaleFormatting();
    }, [chartType]);

    useExtendedPriceLabel(chartRef, seriesRef, symbol, interval, chartType, data);

    const handleSymbolSelect = useCallback(
        (value: string) => {
            if (value) {
                setSymbol(value);
                livePricesClient.updateSymbol(id, value);
            }
        },
        [setSymbol, id],
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
        <button type="button" class={styles.tickerTrigger} aria-label={`Change ticker, current symbol ${symbol}`}>
            <span class={styles.triggerSymbol}>{symbol}</span>
            <ChevronDown size={12} aria-hidden="true" />
        </button>
    );

    return (
        <ChartDetailsPopover
            id={id} symbol={symbol} identity={identity} data={data} quote={quote}
            timezone={timezone} warning={status === "error" ? errorMsg : warning} intraday={isIntraday}
        >
            {(overlay, options) => (
                <Shell
                    id={id}
                    className={styles.root}
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
                                onChange={handleIntervalSelect}
                                variant="widget"
                            />
                            <Select
                                items={CHART_TYPE_ITEMS}
                                value={chartType}
                                onChange={handleChartTypeSelect}
                                variant="widget"
                            />
                            {options}
                        </>
                    }
                    loading={(!stateReady || status === "loading") && !quote.ready}
                    error={status === "error" && !quote.ready ? errorMsg : null}
                    onRemove={onRemove}
                >
                    <div class={styles.chartContainer} ref={containerRef}>
                        {overlay}
                        <div class={styles.axisCorner}>
                            <Tooltip content="Logarithmic Scale">
                                <button
                                    type="button"
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
            )}

        </ChartDetailsPopover>
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
