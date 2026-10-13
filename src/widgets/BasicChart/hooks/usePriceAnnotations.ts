import { useEffect, useRef } from "preact/hooks";
import type { IChartApi, IPriceLine, ISeriesApi } from "lightweight-charts";
import type { Bar, ChartType, Interval } from "../../../services/types";
import { getChartColors } from "../../../styles/tokens";
import {
  annotationHasLabel,
  annotationHasLine,
} from "../settings/basicChartSettings";
import type { GraphicSettings } from "../settings/basicChartSettings";
import type { useChartData } from "./useChartData";
import type { ChartQuote } from "./useChartQuote";

type CachedBars =
  { symbol: string; interval: Interval; bars: Bar[] } | undefined;

export function usePriceAnnotations(
  chartRef: { current: IChartApi | null },
  seriesRef: { current: ISeriesApi<any> | null },
  symbol: string,
  interval: Interval,
  chartType: ChartType,
  data: ReturnType<typeof useChartData>,
  quote: ChartQuote,
  settings: GraphicSettings,
  getBars: () => CachedBars,
) {
  const current = useRef({ quote, settings, getBars });
  current.current = { quote, settings, getBars };
  const refreshRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const chart = chartRef.current,
      series = seriesRef.current;
    if (!chart || !series) return;
    let actualPriceLine: IPriceLine | null = null;
    let previousCloseLine: IPriceLine | null = null;
    const refresh = () => {
      const { quote, settings, getBars } = current.current;
      const cached = getBars();
      const bars =
        cached?.symbol === symbol && cached.interval === interval
          ? cached.bars
          : [];
      const last = bars.at(-1);
      const validPrice =
        last && Number.isFinite(last.close) && last.close > 0
          ? last.close
          : null;
      const labelVisible = annotationHasLabel(settings.lastPrice);
      const lineVisible = annotationHasLine(settings.lastPrice);
      const colors = getChartColors();
      const color =
        chartType === "line" || chartType === "area"
          ? colors.primary
          : last && last.close >= last.open
            ? colors.bull
            : colors.bear;
      const ha = chartType === "heikin_ashi";
      series.applyOptions({
        lastValueVisible: !ha && labelVisible,
        priceLineVisible: !ha && lineVisible,
      });
      if (ha && validPrice !== null && (labelVisible || lineVisible)) {
        const options = {
          price: validPrice,
          color,
          title: "",
          lineVisible,
          axisLabelVisible: labelVisible,
        };
        if (actualPriceLine) actualPriceLine.applyOptions(options);
        else actualPriceLine = series.createPriceLine(options);
      } else if (actualPriceLine) {
        series.removePriceLine(actualPriceLine);
        actualPriceLine = null;
      }
      const previous =
        quote.snapshot?.symbol === symbol
          ? quote.snapshot.previous_close
          : null;
      if (
        settings.previousClose !== "off" &&
        previous !== null &&
        Number.isFinite(previous) &&
        previous > 0
      ) {
        const options = {
          price: previous,
          title: "Prev close",
          color: colors.textMuted,
          lineVisible: annotationHasLine(settings.previousClose),
          axisLabelVisible: annotationHasLabel(settings.previousClose),
        };
        if (previousCloseLine) previousCloseLine.applyOptions(options);
        else previousCloseLine = series.createPriceLine(options);
      } else if (previousCloseLine) {
        series.removePriceLine(previousCloseLine);
        previousCloseLine = null;
      }
    };
    refreshRef.current = refresh;
    series.subscribeDataChanged(refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    refresh();
    return () => {
      observer.disconnect();
      refreshRef.current = null;
      if (chartRef.current === chart && seriesRef.current === series) {
        series.unsubscribeDataChanged(refresh);
        if (actualPriceLine) series.removePriceLine(actualPriceLine);
        if (previousCloseLine) series.removePriceLine(previousCloseLine);
      }
    };
  }, [chartRef, seriesRef, symbol, interval, chartType]);
  useEffect(() => {
    refreshRef.current?.();
  }, [data, quote.snapshot, settings]);
}
