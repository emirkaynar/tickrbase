import type { AutoscaleInfo, AutoscaleInfoProvider, IChartApi, IPriceLine, ISeriesApi } from "lightweight-charts";
import { getChartColors } from "../../styles/tokens";
import type { extendedQuote } from "./sessionPolicy";

type Quote = ReturnType<typeof extendedQuote>;

export function includeQuoteInScale(info: AutoscaleInfo | null, quote: Quote, nearLatest: boolean, automatic: boolean): AutoscaleInfo | null {
    if (!info?.priceRange || !quote || !nearLatest || !automatic) return info;
    return { ...info, priceRange: {
        minValue: Math.min(info.priceRange.minValue, quote.price),
        maxValue: Math.max(info.priceRange.maxValue, quote.price),
    } };
}

/** A price-axis annotation and horizontal guide; never a time-axis data point. */
export class QuotePriceLabel {
    private chart: IChartApi;
    private series: ISeriesApi<any>;
    private line: IPriceLine | null = null;
    private quote: Quote = null;
    private color = "";
    private previousAutoscale: AutoscaleInfoProvider | undefined;
    private autoscale: AutoscaleInfoProvider;

    constructor(chart: IChartApi, series: ISeriesApi<any>) {
        this.chart = chart;
        this.series = series;
        this.previousAutoscale = series.options().autoscaleInfoProvider;
        this.autoscale = original => {
            const info = this.previousAutoscale ? this.previousAutoscale(original) : original();
            const last = this.series.data().at(-1);
            const range = this.chart.timeScale().getVisibleLogicalRange();
            const index = last ? this.chart.timeScale().timeToIndex(last.time, true) : null;
            const nearLatest = index !== null && range !== null && range.from <= index && range.to >= index - 2;
            return includeQuoteInScale(info, this.quote, nearLatest, this.chart.priceScale("right").options().autoScale);
        };
        series.applyOptions({ autoscaleInfoProvider: this.autoscale });
    }

    update(quote: Quote): void {
        const colors = getChartColors();
        const color = !quote ? "" : quote.kind === "pre" ? colors.blue : quote.kind === "post" ? colors.amber : colors.accent;
        if (quote?.price === this.quote?.price && quote?.kind === this.quote?.kind && color === this.color) return;
        this.quote = quote;
        this.color = color;
        if (quote) {
            const title = quote.kind === "pre" ? "Pre" : quote.kind === "post" ? "Post" : "Overnight";
            const options = {
                price: quote.price, title,
                lineVisible: true, axisLabelVisible: true, color,
            };
            if (this.line) this.line.applyOptions(options);
            else this.line = this.series.createPriceLine(options);
        } else if (this.line) {
            this.series.removePriceLine(this.line);
            this.line = null;
        }
        // Quotes change the automatic range without adding or updating series data.
        this.series.applyOptions({ autoscaleInfoProvider: this.autoscale });
    }

    dispose(seriesStillAttached = true): void {
        if (seriesStillAttached) {
            if (this.line) this.series.removePriceLine(this.line);
            // Lightweight Charts ignores undefined option values, so explicitly restore the default.
            this.series.applyOptions({ autoscaleInfoProvider: this.previousAutoscale ?? (original => original()) });
        }
        this.line = null;
        this.quote = null;
    }
}
