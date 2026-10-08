import { describe, expect, it, vi } from "vitest";
import { PriceScaleMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { applyChartScale } from "../chartConfig";

function fixture() {
    const scale = { applyOptions: vi.fn() };
    const chart = { priceScale: vi.fn(() => scale), addSeries: vi.fn(), removeSeries: vi.fn() };
    const series = { applyOptions: vi.fn(), setData: vi.fn() };
    const apply = (mode: Parameters<typeof applyChartScale>[2]) => applyChartScale(
        chart as unknown as IChartApi,
        series as unknown as ISeriesApi<any>,
        mode,
    );
    return { chart, series, scale, apply };
}

 describe("chart scale modes", () => {
    it("uses native first-visible-value percentage mode without quote metadata", () => {
        const { chart, series, scale, apply } = fixture();
        apply("percentage");
        expect(chart.priceScale).toHaveBeenCalledWith("right");
        expect(scale.applyOptions).toHaveBeenCalledWith({ mode: PriceScaleMode.Percentage });
        expect(series.applyOptions).toHaveBeenCalledWith({
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        expect(series.setData).not.toHaveBeenCalled();
        expect(chart.addSeries).not.toHaveBeenCalled();
        expect(chart.removeSeries).not.toHaveBeenCalled();
    });

    it("switches between percentage, logarithmic and normal without a custom formatter", () => {
        const { series, scale, apply } = fixture();
        apply("percentage");
        apply("logarithmic");
        apply("normal");
        expect(scale.applyOptions.mock.calls).toEqual([
            [{ mode: PriceScaleMode.Percentage }],
            [{ mode: PriceScaleMode.Logarithmic }],
            [{ mode: PriceScaleMode.Normal }],
        ]);
        for (const [options] of series.applyOptions.mock.calls) {
            expect(options.priceFormat.type).toBe("price");
            expect(options.priceFormat).not.toHaveProperty("formatter");
        }
    });

    it("can apply the mode before a series is available", () => {
        const { chart, scale } = fixture();
        applyChartScale(chart as unknown as IChartApi, null, "percentage");
        expect(scale.applyOptions).toHaveBeenCalledWith({ mode: PriceScaleMode.Percentage });
    });
});
