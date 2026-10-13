import {
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
} from "preact/hooks";
import { ChevronDown } from "lucide-react";
import type { IChartApi, ISeriesApi, LogicalRange } from "lightweight-charts";
import { createChart, PriceScaleMode } from "lightweight-charts";
import { Select, TickerSelector, Tooltip } from "../../ui";
import type { SelectItem } from "../../ui";
import { Shell } from "../Shell";
import { ChartOverlay } from "./components/ChartOverlay";
import type { LegendBinding, LegendSource } from "./hooks/useChartLegend";
import { applyGraphicSettings } from "./settings/basicChartSettings";
import { useChartQuote } from "./hooks/useChartQuote";
import { useInstrumentIdentity } from "./hooks/useInstrumentIdentity";
import { useChartState } from "./hooks/useChartState";
import { useChartNavigation } from "./hooks/useChartNavigation";
import { useExtendedPriceLabel } from "./hooks/useExtendedPriceLabel";
import { usePriceAnnotations } from "./hooks/usePriceAnnotations";
import { createChartConfig, getSeriesColors } from "./chartConfig";

import { addChartSeries } from "./seriesFactory";
import { VolumePane } from "./volumePane";
import { VisibleExtrema } from "./visibleExtrema";
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
  const volumeRef = useRef<VolumePane | null>(null);
  const extremaRef = useRef<VisibleExtrema | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const logButtonRef = useRef<HTMLButtonElement>(null);
  const [plotBounds, setPlotBounds] = useState({ left: 0, width: 0 });
  const [stripHost, setStripHost] = useState<HTMLDivElement | null>(null);
  const [compactHeight, setCompactHeight] = useState(0);
  const [legendBinding, setLegendBinding] = useState<LegendBinding | null>(
    null,
  );
  const legendResizeRef = useRef<{
    chart: IChartApi;
    series: ISeriesApi<any>;
    logical: LogicalRange | null;
    price: { from: number; to: number } | null;
  } | null>(null);

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
    resetView,
    isViewReady,
    viewResetRevision,
    setPrevClose,
    scaleMode,
    setScaleMode,
    applyScaleFormatting,
    settings,
    graphicSettings,
    getLastState,
    hasBars,

    refreshVolume,
  } = useChartState(id, { chartRef, seriesRef, intervalRef, volumeRef });

  const quote = useChartQuote(symbol, stateReady, data.lastTick, setPrevClose);
  const identity = useInstrumentIdentity(symbol, stateReady);

  const isIntraday = !["1d", "1wk", "1mo"].includes(interval);
  const legendEnabled =
    graphicSettings.legendOHLC ||
    graphicSettings.legendVolume ||
    graphicSettings.legendChange;
  const previousLegendRef = useRef(legendEnabled);
  useLayoutEffect(() => {
    if (previousLegendRef.current === legendEnabled) return;
    previousLegendRef.current = legendEnabled;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !isViewReady()) return;
    legendResizeRef.current = {
      chart,
      series,
      logical: chart.timeScale().getVisibleLogicalRange(),
      price: series.priceScale().options().autoScale
        ? null
        : series.priceScale().getVisibleRange(),
    };
  }, [legendEnabled, isViewReady]);

  // Keep websocket subscription map in sync with current widget symbol.
  useEffect(() => {
    if (!stateReady) return;
    livePricesClient.updateSymbol(id, symbol);
  }, [id, symbol, stateReady]);

  // Create chart once container is ready
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const config = createChartConfig(
      isIntraday,
      timezone,
      data.marketContext?.exchange_timezone ?? "UTC",
    );
    const chart = createChart(container, {
      ...config,
      width: container.clientWidth,
      height: container.clientHeight,
    });

    const series = addChartSeries(chart, chartType);
    chartRef.current = chart;
    seriesRef.current = series;
    seriesTypeRef.current = chartType;
    volumeRef.current = new VolumePane(chart);

    reapplyCurrentBars();
    applyScaleFormatting();
    applyGraphicSettings(chart, series, graphicSettings);
    setLegendBinding({ chart, series, chartType });

    return () => {
      chartRef.current = null;
      seriesRef.current = null;
      seriesTypeRef.current = null;
      volumeRef.current = null;
      chart.remove();
      livePricesClient.removeWidget(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Update chart config when intraday flag or timezone changes
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions(
      createChartConfig(
        isIntraday,
        timezone,
        data.marketContext?.exchange_timezone ?? "UTC",
      ),
    );
    chartRef.current.applyOptions({ autoSize: false });
    applyGraphicSettings(chartRef.current, seriesRef.current, graphicSettings);
  }, [
    isIntraday,
    timezone,
    data.marketContext?.exchange_timezone,
    graphicSettings,
  ]);

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
        const chart = chartRef.current;
        chart.resize(container.clientWidth, container.clientHeight);
        const preserved = legendResizeRef.current;
        legendResizeRef.current = null;
        if (
          preserved?.chart === chart &&
          preserved.series === seriesRef.current &&
          isViewReady()
        ) {
          if (preserved.logical)
            chart.timeScale().setVisibleLogicalRange(preserved.logical);
          if (preserved.price) {
            const scale = preserved.series.priceScale();
            const current = scale.getVisibleRange();
            if (
              !current ||
              current.from !== preserved.price.from ||
              current.to !== preserved.price.to
            ) {
              const mode = scale.options().mode;
              // LWC 5.2 reads LOG ranges as prices but writes them in scale units.
              // Let its public mode conversion handle the fallback restoration.
              if (mode === PriceScaleMode.Logarithmic)
                scale.applyOptions({ mode: PriceScaleMode.Normal });
              scale.setVisibleRange(preserved.price);
              if (mode === PriceScaleMode.Logarithmic)
                scale.applyOptions({ mode });
            }
          }
        }
        // This is a no-op after initialization, including legend-only resizes.
        initializeRange();
      });
    });

    ro.observe(container);
    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [initializeRange, isViewReady]);

  // Re-apply colors when theme changes (data-theme attribute mutation)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!chartRef.current || !seriesRef.current) return;
      chartRef.current.applyOptions(
        createChartConfig(
          isIntraday,
          timezone,
          data.marketContext?.exchange_timezone ?? "UTC",
        ),
      );
      seriesRef.current.applyOptions(getSeriesColors(chartType));
      applyGraphicSettings(
        chartRef.current,
        seriesRef.current,
        graphicSettings,
      );
      refreshVolume();
      extremaRef.current?.refreshTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [
    isIntraday,
    timezone,
    chartType,
    data.marketContext?.exchange_timezone,
    graphicSettings,
    refreshVolume,
  ]);

  const seriesLifecycleRef = useRef({
    reapplyCurrentBars,
    applyScaleFormatting,
    graphicSettings,
  });
  seriesLifecycleRef.current = {
    reapplyCurrentBars,
    applyScaleFormatting,
    graphicSettings,
  };

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
    if (visibleRange && isViewReady())
      chart.timeScale().setVisibleLogicalRange(visibleRange);
    lifecycle.applyScaleFormatting();
    applyGraphicSettings(chart, seriesRef.current, lifecycle.graphicSettings);
    setLegendBinding({ chart, series: seriesRef.current, chartType });
  }, [chartType]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const timeScale = chart.timeScale();
    const updatePlotBounds = () => {
      const left = chart.priceScale("left").width();
      const width = timeScale.width();
      setPlotBounds((previous) =>
        previous.left === left && previous.width === width
          ? previous
          : { left, width },
      );
    };
    // Plot-size events also account for changing price-axis label widths.
    timeScale.subscribeSizeChange(updatePlotBounds);
    updatePlotBounds();
    return () => {
      if (chartRef.current === chart)
        timeScale.unsubscribeSizeChange(updatePlotBounds);
    };
  }, [id, chartType]);

  const hasNavigated = useChartNavigation(
    id,
    { containerRef, chartRef, seriesRef },
    isViewReady,
    viewResetRevision,
  );
  useEffect(() => {
    const button = resetButtonRef.current;
    if (!hasNavigated && button && document.activeElement === button) {
      if (button.matches(":focus-visible"))
        logButtonRef.current?.focus({ preventScroll: true });
      else button.blur();
    }
  }, [hasNavigated]);

  useEffect(() => {
    const chart = chartRef.current,
      series = seriesRef.current;
    if (!chart || !series || !graphicSettings.highLow) return;
    const extrema = new VisibleExtrema();
    extremaRef.current = extrema;
    series.attachPrimitive(extrema);
    return () => {
      if (extremaRef.current === extrema) extremaRef.current = null;
      if (chartRef.current === chart && seriesRef.current === series) {
        series.detachPrimitive(extrema);
      } else {
        // Series/chart replacement may precede this effect's cleanup.
        extrema.detached();
      }
    };
  }, [id, chartType, graphicSettings.highLow]);

  useExtendedPriceLabel(
    chartRef,
    seriesRef,
    symbol,
    interval,
    chartType,
    data,
    graphicSettings.extendedHoursPrice,
  );
  usePriceAnnotations(
    chartRef,
    seriesRef,
    symbol,
    interval,
    chartType,
    data,
    quote,
    graphicSettings,
    () => getLastState(id),
  );

  const getLegendBars = useCallback(() => getLastState(id), [id, getLastState]);
  const legendSource = useMemo<LegendSource>(
    () => ({
      id,
      binding: legendBinding,
      symbol,
      interval,
      chartType,
      getBars: getLegendBars,
      containerRef,
      stripHost,
    }),
    [id, legendBinding, symbol, interval, chartType, getLegendBars, stripHost],
  );

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
    <button
      type="button"
      class={styles.tickerTrigger}
      disabled={!settings.ready}
      aria-label={`Change ticker, current symbol ${symbol}`}
    >
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
            placement="bottom"
            disabled={!settings.ready}
            onChange={handleIntervalSelect}
            variant="widget"
          />
          <Select
            items={CHART_TYPE_ITEMS}
            value={chartType}
            placement="bottom"
            disabled={!settings.ready}
            onChange={handleChartTypeSelect}
            variant="widget"
          />
        </>
      }
      loading={
        (!stateReady || status === "loading") && !quote.ready && !hasBars
      }
      error={status === "error" && !quote.ready && !hasBars ? errorMsg : null}
      onRemove={onRemove}
    >
      <div
        class={styles.legendHost}
        ref={setStripHost}
        hidden={!legendEnabled}
      />
      <div class={styles.chartContainer} ref={containerRef}>
        <ChartOverlay
          symbol={symbol}
          identity={identity}
          data={data}
          quote={quote}
          warning={status === "error" ? errorMsg : warning}
          stripHost={stripHost}
          settings={graphicSettings}
          legendSource={legendSource}
          onCompactHeight={setCompactHeight}
        />

        <div
          class={styles.resetOverlay}
          style={{
            "--plot-left": `${plotBounds.left}px`,
            "--plot-width": `${plotBounds.width}px`,
            "--reset-top": `${!legendEnabled && quote.ready ? compactHeight || 64 : 8}px`,
          }}
        >
          <Tooltip content="Reset view — show latest 100 candles and fit prices">
            <button
              ref={resetButtonRef}
              type="button"
              class={styles.resetBtn}
              data-visible={hasNavigated}
              aria-hidden={!hasNavigated}
              tabIndex={hasNavigated ? 0 : -1}
              aria-label="Reset chart view"
              onPointerDown={(event) => event.preventDefault()}
              onClick={resetView}
            >
              Reset view
            </button>
          </Tooltip>
        </div>
        <div class={styles.axisCorner}>
          <div class={styles.scaleRow}>
            <Tooltip content="Logarithmic Scale">
              <button
                type="button"
                disabled={!settings.ready}
                class={[
                  styles.scaleBtn,
                  scaleMode === "logarithmic" ? styles.scaleBtnActive : "",
                ].join(" ")}
                onClick={() =>
                  setScaleMode(
                    scaleMode === "logarithmic" ? "normal" : "logarithmic",
                  )
                }
                ref={logButtonRef}
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
                  scaleMode === "percentage" ? styles.scaleBtnActive : "",
                ].join(" ")}
                onClick={() =>
                  setScaleMode(
                    scaleMode === "percentage" ? "normal" : "percentage",
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
