import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { createChart } from "lightweight-charts";
import { Select, TickerSelector } from "../../ui";
import type { SelectItem } from "../../ui";
import { Shell } from "../Shell";
import { useChartState } from "./useChartState";
import { createChartConfig, getSeriesColors } from "./chartConfig";
import { addChartSeries } from "./seriesFactory";
import { registerWidget } from "../registry";
import { INTERVALS, INTERVAL_CONFIG } from "../../services/types";
import type { ChartType, Interval } from "../../services/types";
import { livePricesClient } from "../../services/livePrices";
import { fetchQuotes, calcChangePercent } from "../../services/quotes";
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

const PCT_FORMATTER = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function BasicChart({ id, onRemove }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<any> | null>(null);
    const intervalRef = useRef<Interval>("1d");

    const [, setPrice] = useState<number | null>(null);
    const [changePercent, setChangePercent] = useState<number | null>(null);
    const prevCloseRef = useRef<number | null>(null);

    const {
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
    } = useChartState(id, { chartRef, seriesRef, intervalRef });

    const isIntraday = !["1d", "1wk", "1mo"].includes(interval);

    // Keep websocket subscription map in sync with current widget symbol.
    useEffect(() => {
        if (!stateReady) return;
        livePricesClient.updateSymbol(id, symbol);
    }, [id, symbol, stateReady]);

    // Fetch quote snapshot for previous close & calculate changePercent
    useEffect(() => {
        if (!stateReady) return;

        let cancelled = false;
        setPrice(null);
        setChangePercent(null);
        prevCloseRef.current = null;
        setPrevClose(null);

        const ctrl = new AbortController();
        fetchQuotes([symbol], ["session"], ctrl.signal)
            .then((res) => {
                if (cancelled) return;
                const quote = res.quotes[0];
                if (quote) {
                    prevCloseRef.current = quote.previous_close;
                    setPrevClose(quote.previous_close);
                    if (quote.current_price !== null) {
                        setPrice(quote.current_price);
                        setChangePercent(calcChangePercent(quote.current_price, quote.previous_close));
                    }
                }
            })
            .catch(() => {});

        return () => {
            cancelled = true;
            ctrl.abort();
        };
    }, [symbol, stateReady]);

    // Live price tick updates for ticker selector trigger
    useEffect(() => {
        if (!stateReady) return;

        const unsubscribe = livePricesClient.onTick((tick) => {
            if (tick.symbol !== symbol) return;
            setPrice(tick.price);
            if (prevCloseRef.current !== null) {
                setChangePercent(calcChangePercent(tick.price, prevCloseRef.current));
            }
        });

        return unsubscribe;
    }, [symbol, stateReady]);

    // Create chart once container is ready
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            ...createChartConfig(isIntraday, timezone),
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
        chartRef.current.applyOptions(createChartConfig(isIntraday, timezone));
        chartRef.current.applyOptions({ autoSize: false });
    }, [isIntraday, timezone]);

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
                createChartConfig(isIntraday, timezone),
            );
            seriesRef.current.applyOptions(getSeriesColors(chartType));
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        return () => observer.disconnect();
    }, [isIntraday, timezone, chartType]);

    // Re-create series if chartType changes and re-apply existing data
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        captureRange();
        if (seriesRef.current) {
            chart.removeSeries(seriesRef.current);
        }
        seriesRef.current = addChartSeries(chart, chartType);
        reapplyCurrentBars();
    }, [chartType, captureRange, reapplyCurrentBars]);

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
                    "line",
                    "area",
                    "bar",
                    "baseline",
                    "heikin_ashi",
                ].includes(value)
            ) {
                setChartType(value as ChartType);
            }
        },
        [setChartType],
    );

    const tickerTrigger = (
        <button type="button" class={styles.tickerTrigger}>
            <span class={styles.triggerSymbol}>{symbol}</span>
            {changePercent !== null && (
                <span
                    class={
                        changePercent > 0
                            ? styles.changePositive
                            : changePercent < 0
                              ? styles.changeNegative
                              : styles.changeNeutral
                    }
                >
                    {changePercent > 0 ? "▲ " : changePercent < 0 ? "▼ " : ""}
                    {PCT_FORMATTER.format(Math.abs(changePercent))}%
                </span>
            )}
        </button>
    );

    return (
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
                    <Select
                        items={INTERVAL_ITEMS}
                        value={interval}
                        onChange={handleIntervalSelect}
                        variant="widget"
                    />
                </>
            }
            headerRight={
                <Select
                    items={CHART_TYPE_ITEMS}
                    value={chartType}
                    onChange={handleChartTypeSelect}
                    variant="widget"
                />
            }
            loading={!stateReady || status === "loading"}
            error={status === "error" ? errorMsg : null}
            onRemove={onRemove}
        >
            <div class={styles.chartContainer} ref={containerRef} />
            {warning && <span class={styles.warning}>{warning}</span>}
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
    settingSections: [
        {
            category: "Widgets",
            subcategoryId: "basic-chart",
            subcategoryLabel: "Basic Chart",
            subcategoryIcon: "ChartLine",
            settings: [
                {
                    id: "basicChart.defaultInterval",
                    type: "string",
                    label: "Default Interval #todo",
                    description:
                        "Default time interval for new charts. Can be overridden per chart using the interval selector in the widget header.",
                    defaultValue: "1d",
                },
                {
                    id: "defaultChartSymbol",
                    type: "string",
                    label: "Default Symbol #todo",
                    description:
                        "Default ticker symbol for new charts. Can be overridden per chart using the ticker selector in the widget header.",
                    defaultValue: "XU100.IS",
                },
                {
                    id: "crosshairMode",
                    type: "integer",
                    label: "Crosshair Mode #todo",
                    description:
                        "Determines how the crosshair behaves on the chart. 0 = normal, 1 = magnet (snaps to nearest data point), 2 = free (does not snap).",
                    defaultValue: 1,
                },
            ],
        },
    ],
});

export { BasicChart };
