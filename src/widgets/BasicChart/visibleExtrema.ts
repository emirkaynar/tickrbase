import { MismatchDirection } from "lightweight-charts";
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  IRange,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import { getChartColors } from "../../styles/tokens";

export type PriceSeriesType =
  "Bar" | "Candlestick" | "Line" | "Area" | "Baseline";
type ExtremePoint = { time: Time; price: number };
type Extrema = { high: ExtremePoint | null; low: ExtremePoint | null };
type Label = { x: number; y: number; text: string; above: boolean };

/** Logical indices belong to the whole chart, including its whitespace series. */
export function findVisibleExtrema(
  chart: IChartApi,
  series: ISeriesApi<PriceSeriesType>,
  range: IRange<number> | null,
): Extrema {
  const result: Extrema = { high: null, low: null };
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to))
    return result;
  const end = Math.floor(range.to);
  const scale = chart.timeScale();
  for (let cursor = Math.ceil(range.from); cursor <= end;) {
    const point = series.dataByIndex(cursor, MismatchDirection.NearestRight);
    if (!point) break;
    const index = scale.timeToIndex(point.time);
    if (
      index === null ||
      !Number.isFinite(index) ||
      index < cursor ||
      index > end
    )
      break;
    const high =
      "high" in point ? point.high : "value" in point ? point.value : NaN;
    const low =
      "low" in point ? point.low : "value" in point ? point.value : NaN;
    if (Number.isFinite(high) && (!result.high || high > result.high.price)) {
      result.high = { time: point.time, price: high };
    }
    if (Number.isFinite(low) && (!result.low || low < result.low.price)) {
      result.low = { time: point.time, price: low };
    }
    // Jump over gaps instead of walking every whitespace index.
    cursor = index + 1;
  }
  return result;
}

/** Noninteractive labels on the price series; no range or autoscale mutations. */
export class VisibleExtrema implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<PriceSeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private dirty = true;
  private bounds: IRange<number> | null = null;
  private extrema: Extrema = { high: null, low: null };
  private labels: Label[] = [];
  private color = "";
  private fontFamily = "";
  private fontSize = 12;
  private readonly onDataChanged = () => {
    this.dirty = true;
    this.requestUpdate?.();
  };
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target) => this.draw(target),
  };
  private readonly views: readonly IPrimitivePaneView[] = [
    { zOrder: () => "top", renderer: () => this.renderer },
  ];

  attached({
    chart,
    series,
    requestUpdate,
  }: SeriesAttachedParameter<Time>): void {
    this.detached();
    this.chart = chart;
    // The owner attaches this primitive only to one of the five price-series types.
    this.series = series as unknown as ISeriesApi<PriceSeriesType>;
    this.requestUpdate = requestUpdate;
    this.series.subscribeDataChanged(this.onDataChanged);
    this.refreshTheme();
  }

  detached(): void {
    this.series?.unsubscribeDataChanged(this.onDataChanged);
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.bounds = null;
    this.extrema = { high: null, low: null };
    this.labels = [];
    this.dirty = true;
  }

  refreshTheme(): void {
    if (!this.chart) return;
    const layout = this.chart.options().layout;
    this.color = getChartColors().text;
    this.fontFamily = layout.fontFamily;
    this.fontSize = layout.fontSize;
    this.requestUpdate?.();
  }

  updateAllViews(): void {
    const chart = this.chart,
      series = this.series;
    if (!chart || !series) return;
    const scale = chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    const from = range ? Math.ceil(range.from) : null;
    const to = range ? Math.floor(range.to) : null;
    if (this.dirty || from !== this.bounds?.from || to !== this.bounds?.to) {
      this.extrema = findVisibleExtrema(chart, series, range);
      this.bounds = from === null || to === null ? null : { from, to };
      this.dirty = false;
    }
    const inverted = series.priceScale().options().invertScale;
    const formatter = series.priceFormatter();
    this.labels = [];
    for (const kind of ["high", "low"] as const) {
      const point = this.extrema[kind];
      if (!point) continue;
      const x = scale.timeToCoordinate(point.time);
      const y = series.priceToCoordinate(point.price);
      if (
        x === null ||
        y === null ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      )
        continue;
      this.labels.push({
        x,
        y,
        text: `${kind === "high" ? "H" : "L"}: ${formatter.format(point.price)}`,
        above: (kind === "high") !== inverted,
      });
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  // Keep useMediaCoordinateSpace outside inline callbacks scanned as hooks by Prefresh.
  private draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const padding = 4,
        gap = 6;
      const { width, height } = mediaSize;
      if (height < this.fontSize + padding * 2) return;
      context.save();
      context.fillStyle = this.color;
      context.font = `${this.fontSize}px ${this.fontFamily}`;
      context.textAlign = "left";
      context.textBaseline = "top";
      let previous: { x: number; y: number; width: number } | null = null;
      for (const label of this.labels) {
        if (label.x < 0 || label.x > width || label.y < 0 || label.y > height)
          continue;
        const textWidth = context.measureText(label.text).width;
        if (textWidth > width - padding * 2) continue;
        let x = label.x + gap;
        if (x + textWidth > width - padding) x = label.x - gap - textWidth;
        x = Math.max(padding, Math.min(x, width - padding - textWidth));
        let y = label.above ? label.y - gap - this.fontSize : label.y + gap;
        y = Math.max(padding, Math.min(y, height - padding - this.fontSize));
        if (
          previous &&
          x < previous.x + previous.width &&
          x + textWidth > previous.x &&
          y < previous.y + this.fontSize &&
          y + this.fontSize > previous.y
        ) {
          const below = previous.y + this.fontSize + padding;
          const above = previous.y - this.fontSize - padding;
          if (below <= height - padding - this.fontSize) y = below;
          else if (above >= padding) y = above;
          else continue;
        }
        context.fillText(label.text, x, y);
        previous = { x, y, width: textWidth };
      }
      context.restore();
    });
  }
}
