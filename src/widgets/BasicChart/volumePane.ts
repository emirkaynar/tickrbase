import { HistogramSeries, PriceScaleMode } from "lightweight-charts";
import type {
  HistogramData,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";
import type { Bar } from "../../services/types";
import { getChartColors } from "../../styles/tokens";

export type VolumeMode = "off" | "overlay" | "pane";
export type VolumeStatus = "off" | "empty" | "shown";
type VolumeColors = { bull: string; bear: string };

export function volumePoint(
  bar: Bar,
  colors: VolumeColors,
): HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp> {
  const time = bar.time as UTCTimestamp;
  return typeof bar.volume === "number" &&
    Number.isFinite(bar.volume) &&
    bar.volume >= 0
    ? {
        time,
        value: bar.volume,
        color: bar.close >= bar.open ? colors.bull : colors.bear,
      }
    : { time };
}

/** One native histogram owned by its chart; chart.remove() handles final cleanup. */
export class VolumePane {
  private readonly chart: IChartApi;
  private series: ISeriesApi<"Histogram"> | null = null;
  private colors: VolumeColors | null = null;
  private mode: VolumeMode = "off";

  constructor(chart: IChartApi) {
    this.chart = chart;
  }

  update(bars: readonly Bar[], mode: VolumeMode, live = false): VolumeStatus {
    if (mode === "off") {
      this.remove();
      return "off";
    }
    if (live) {
      if (!this.series || !this.colors || this.mode !== mode) return "empty";
      const last = bars.at(-1);
      if (last) this.series.update(volumePoint(last, this.colors));
      return "shown";
    }
    // This is a display threshold, not proof that zero volume is unavailable.
    if (
      !bars.some(
        (bar) =>
          typeof bar.volume === "number" &&
          Number.isFinite(bar.volume) &&
          bar.volume > 0,
      )
    ) {
      this.remove();
      return "empty";
    }
    const scale = this.chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    if (this.mode !== mode) this.remove();
    const colors = getChartColors();
    // Chart tokens are #rrggbb; 4d alpha keeps volume quieter than price candles.
    this.colors = { bull: `${colors.bull}4d`, bear: `${colors.bear}4d` };
    if (!this.series) {
      const main = this.chart.panes()[0];
      const pane = mode === "pane" ? this.chart.addPane(false) : main;
      if (mode === "pane") pane.setStretchFactor(main.getStretchFactor() / 4);
      this.series = pane.addSeries(HistogramSeries, {
        // A separate overlay scale must never participate in price autoscaling.
        priceScaleId: mode === "overlay" ? "volume" : "right",
        priceFormat: { type: "volume" },
        base: 0,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      this.series.priceScale().applyOptions({
        mode: PriceScaleMode.Normal,
        autoScale: true,
        scaleMargins: { top: mode === "overlay" ? 0.8 : 0.15, bottom: 0 },
      });
      this.mode = mode;
    }
    const volumeColors = this.colors;
    this.series.setData(bars.map((bar) => volumePoint(bar, volumeColors)));
    if (range) scale.setVisibleLogicalRange(range);
    return "shown";
  }

  private remove() {
    if (!this.series) return;
    const scale = this.chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    // Native panes are removed automatically when their final series is removed.
    this.chart.removeSeries(this.series);
    this.series = null;
    this.colors = null;
    this.mode = "off";
    if (range) scale.setVisibleLogicalRange(range);
  }
}
