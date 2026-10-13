import { useEffect, useRef, useState } from "preact/hooks";
import type {
  IChartApi,
  ISeriesApi,
  MouseEventParams,
} from "lightweight-charts";
import type { Bar, ChartType, Interval } from "../../../services/types";
import { calculateHeikinAshi } from "./useChartState";

type CachedBars =
  { bars: Bar[]; symbol: string; interval: Interval } | undefined;
export type LegendBinding = {
  chart: IChartApi;
  series: ISeriesApi<any>;
  chartType: ChartType;
};
export type LegendSource = {
  id: string;
  binding: LegendBinding | null;
  symbol: string;
  interval: Interval;
  chartType: ChartType;
  getBars: () => CachedBars;
  containerRef: { current: HTMLDivElement | null };
  stripHost: HTMLDivElement | null;
};
type Readout = {
  source: LegendSource;
  bar: Bar | undefined;
  actual: Bar | undefined;
  previous: Bar | undefined;
  hovered: boolean;
};
const emptyBars: readonly Bar[] = [];
const sameBar = (a: Bar | undefined, b: Bar | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    Object.is(a.time, b.time) &&
    Object.is(a.open, b.open) &&
    Object.is(a.high, b.high) &&
    Object.is(a.low, b.low) &&
    Object.is(a.close, b.close) &&
    Object.is(a.volume, b.volume));

// Only the readout leaf owns this state. Pointer moves never publish a dataset
// or state update to BasicChart, the market-status owner, or the presenter.
export function useChartLegend(source: LegendSource) {
  const { id, binding, symbol, interval, chartType, containerRef, stripHost } =
    source;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [readout, setReadout] = useState<Readout | null>(null);

  useEffect(() => {
    if (!binding || binding.chartType !== chartType) return;
    const { chart, series } = binding;
    const owner = sourceRef.current;
    let active = true;
    let queued = false;
    let hoverTime: number | null = null;
    let bars = emptyBars;
    let displayed = emptyBars;
    let byTime = new Map<number, number>();
    const publish = () => {
      const historicalIndex =
        hoverTime === null ? undefined : byTime.get(hoverTime);
      const hovered = historicalIndex !== undefined;
      const index = historicalIndex ?? bars.length - 1;
      const next: Readout = {
        source: owner,
        bar: displayed[index],
        actual: bars[index],
        previous: displayed[index - 1],
        hovered,
      };
      setReadout((previous) =>
        previous?.source === owner &&
        previous.hovered === hovered &&
        sameBar(previous.bar, next.bar) &&
        sameBar(previous.actual, next.actual) &&
        sameBar(previous.previous, next.previous)
          ? previous
          : next,
      );
    };
    const refresh = () => {
      if (!active) return;
      const cached = sourceRef.current.getBars();
      const next =
        cached?.symbol === symbol && cached.interval === interval
          ? cached.bars
          : emptyBars;
      if (bars !== next) {
        bars = next;
        displayed =
          chartType === "heikin_ashi" ? calculateHeikinAshi(bars) : bars;
        byTime = new Map(bars.map((bar, index) => [bar.time, index]));
      }
      // Once removed, a historical selection stays in fallback until input moves.
      if (hoverTime !== null && !byTime.has(hoverTime)) hoverTime = null;
      publish();
    };
    // LWC emits synchronously before applyBars commits its raw cache.
    const dataChanged = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        refresh();
      });
    };
    const leave = () => {
      if (!active || hoverTime === null) return;
      hoverTime = null;
      publish();
    };
    const move = (event: MouseEventParams) => {
      // Reflow (including null-point reflow) must not reset historical input.
      // LWC's actual leave also has no sourceEvent; DOM leave handles it below.
      if (!active || !event.sourceEvent) return;
      const time =
        event.point &&
        typeof event.time === "number" &&
        event.seriesData.has(series) &&
        byTime.has(event.time)
          ? event.time
          : null;
      if (time === hoverTime) return;
      hoverTime = time;
      publish();
    };
    const container = containerRef.current;
    series.subscribeDataChanged(dataChanged);
    chart.subscribeCrosshairMove(move);
    container?.addEventListener("pointerleave", leave);
    stripHost?.addEventListener("pointerenter", leave);
    refresh();
    return () => {
      active = false;
      chart.unsubscribeCrosshairMove(move);
      series.unsubscribeDataChanged(dataChanged);
      container?.removeEventListener("pointerleave", leave);
      stripHost?.removeEventListener("pointerenter", leave);
    };
  }, [id, binding, symbol, interval, chartType, containerRef, stripHost]);

  const current = readout?.source;
  const valid =
    current?.id === id &&
    current.binding === binding &&
    current.symbol === symbol &&
    current.interval === interval &&
    current.chartType === chartType;
  const bar = valid ? readout?.bar : undefined;
  const actual = valid ? readout?.actual : undefined;
  const previous = valid ? readout?.previous : undefined;
  const change =
    bar &&
    previous &&
    Number.isFinite(bar.close) &&
    Number.isFinite(previous.close) &&
    previous.close !== 0
      ? ((bar.close - previous.close) / previous.close) * 100
      : null;
  return {
    bar,
    actual,
    previous,
    hovered: valid && Boolean(readout?.hovered),
    heikinAshi: chartType === "heikin_ashi",
    changePercent: change !== null && Number.isFinite(change) ? change : null,
    formatPrice: (value: number | undefined) =>
      value !== undefined && Number.isFinite(value)
        ? (binding?.series.priceFormatter().format(value) ?? "—")
        : "—",
  };
}
