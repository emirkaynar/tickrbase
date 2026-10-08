import { describe, expect, it, vi } from "vitest";
import { PriceScaleMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { applyChartScale, setInitialChartRange } from "../chartConfig";

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

describe("initial chart range", () => {
    function rangeFixture(count: number, width = 800) {
        const points = Array.from({ length: count }, (_, index) => ({ time: index + 1, value: 10 }));
        const scale = {
            width: () => width,
            // The chart-wide index can include points from hidden gap/boundary series.
            timeToIndex: (time: number) => (time - 1) * 2,
            setVisibleLogicalRange: vi.fn(),
            fitContent: vi.fn(),
        };
        const chart = { timeScale: () => scale } as unknown as IChartApi;
        const series = { data: () => points } as unknown as ISeriesApi<any>;
        return { chart, series, scale };
    }

    it("shows the latest 100 candles with five bars of right space, not all history", () => {
        const { chart, series, scale } = rangeFixture(200);
        expect(setInitialChartRange(chart, series)).toBe(true);
        expect(scale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 200, to: 403 });
        expect(scale.fitContent).not.toHaveBeenCalled();
    });

    it("leaves room for 100 candles when fewer are available", () => {
        const { chart, series, scale } = rangeFixture(20);
        expect(setInitialChartRange(chart, series)).toBe(true);
        expect(scale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: -80, to: 43 });
    });

    it("waits for data and a usable container width", () => {
        for (const { chart, series, scale } of [rangeFixture(0), rangeFixture(100, 0)]) {
            expect(setInitialChartRange(chart, series)).toBe(false);
            expect(scale.setVisibleLogicalRange).not.toHaveBeenCalled();
        }
    });
});

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
