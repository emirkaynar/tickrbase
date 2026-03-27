import { useEffect, useRef, useCallback } from "preact/hooks";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { createChart } from "lightweight-charts";
import { Select, TickerSelector } from "../../ui";
import type { SelectItem } from "../../ui";
import { useChartState } from "./useChartState";
import { createChartConfig, getCandleColors } from "./chartConfig";
import { registerWidget } from "../registry";
import { INTERVALS, INTERVAL_CONFIG } from "../../services/types";
import type { Interval } from "../../services/types";
import styles from "./StockChart.module.css";

type Props = { id: string };

const INTERVAL_ITEMS: SelectItem[] = INTERVALS.map((i) => ({
    label: INTERVAL_CONFIG[i].label,
    value: i,
}));

function StockChart({ id }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const intervalRef = useRef<Interval>("1d");

    const {
        symbol,
        setSymbol,
        interval,
        selectInterval,
        status,
        errorMsg,
        warning,
        stateReady,
    } = useChartState(id, { chartRef, seriesRef, intervalRef });

    const isIntraday = !["1d", "1wk", "1mo"].includes(interval);

    // Create chart once container is ready
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            ...createChartConfig(isIntraday),
            width: container.clientWidth,
            height: container.clientHeight,
        });

        const series = chart.addCandlestickSeries(getCandleColors());
        chartRef.current = chart;
        seriesRef.current = series;

        return () => {
            chartRef.current = null;
            seriesRef.current = null;
            chart.remove();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update chart config when intraday flag changes (interval switch)
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions(createChartConfig(isIntraday));
        chartRef.current.applyOptions({ autoSize: false });
    }, [isIntraday]);

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
                chartRef.current.timeScale().fitContent();
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
            chartRef.current.applyOptions(createChartConfig(isIntraday));
            seriesRef.current.applyOptions(getCandleColors());
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        return () => observer.disconnect();
    }, [isIntraday]);

    const handleSymbolSelect = useCallback(
        (value: string) => {
            if (value) setSymbol(value);
        },
        [setSymbol],
    );

    const handleIntervalSelect = useCallback(
        (value: string) => {
            if (INTERVALS.includes(value as Interval))
                selectInterval(value as Interval);
        },
        [selectInterval],
    );

    return (
        <div class={styles.root}>
            {/* Drag handle + controls */}
            <div class={`${styles.handle} widget-handle`}>
                <div class={styles.symbolCombobox}>
                    <TickerSelector
                        value={symbol}
                        placeholder="Ticker..."
                        onChange={handleSymbolSelect}
                    />
                </div>
                <div class={`${styles.dragGrip} sc-drag-grip`} />
                <div class={styles.controls}>
                    <div class={styles.intervalSelect}>
                        <Select
                            items={INTERVAL_ITEMS}
                            value={interval}
                            onChange={handleIntervalSelect}
                        />
                    </div>
                </div>
            </div>

            {/* Chart canvas */}
            <div class={styles.chartContainer} ref={containerRef}>
                {(!stateReady || status === "loading") && (
                    <div class={styles.overlay} />
                )}
                {status === "error" && (
                    <div class={styles.overlayError}>
                        <p class={styles.errorMsg}>{errorMsg}</p>
                    </div>
                )}
            </div>

            {warning && <span class={styles.warning}>{warning}</span>}
        </div>
    );
}

// Self-register on import
registerWidget({
    type: "stock-chart",
    label: "Stock Chart",
    defaultSize: { w: 10, h: 12 },
    minSize: { w: 7, h: 8 },
    component: StockChart,
});

export { StockChart };
