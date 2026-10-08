import { describe, expect, it, vi } from "vitest";
import type { AutoscaleInfoProvider, IChartApi, ISeriesApi } from "lightweight-charts";
import { includeQuoteInScale, QuotePriceLabel } from "../quotePriceLabel";

const quote = { price: 120, kind: "pre" as const, stale: false };
const info = { priceRange: { minValue: 90, maxValue: 100 }, margins: { above: 8, below: 8 } };

function fixture() {
    let provider: AutoscaleInfoProvider | undefined;
    const line = { applyOptions: vi.fn() };
    const series = {
        options: () => ({ autoscaleInfoProvider: provider }),
        applyOptions: vi.fn(options => { provider = options.autoscaleInfoProvider; }),
        createPriceLine: vi.fn(() => line), removePriceLine: vi.fn(),
        data: () => [{ time: 100, value: 95 }],
    };
    let range = { from: 0, to: 10 };
    let automatic = true;
    const chart = {
        timeScale: () => ({ getVisibleLogicalRange: () => range, timeToIndex: () => 10 }),
        priceScale: () => ({ options: () => ({ autoScale: automatic }) }),
    };
    const label = new QuotePriceLabel(chart as unknown as IChartApi, series as unknown as ISeriesApi<any>);
    return { label, series, line, scale: () => provider!(() => info),
        panAway: () => { range = { from: 0, to: 5 }; }, manual: () => { automatic = false; } };
}

describe("extended price-axis label", () => {
    it("creates one axis-only label, updates it, then removes it at a phase transition", () => {
        const { label, series, line } = fixture();
        label.update(quote);
        expect(series.createPriceLine).toHaveBeenCalledOnce();
        expect(series.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: 120, title: "PRE", axisLabelVisible: true, lineVisible: false }));
        label.update({ price: 121, kind: "post", stale: true });
        expect(series.createPriceLine).toHaveBeenCalledOnce();
        expect(line.applyOptions).toHaveBeenCalledWith(expect.objectContaining({ price: 121, title: "POST · STALE" }));
        label.update(null);
        expect(series.removePriceLine).toHaveBeenCalledWith(line);
    });
    it("includes the quote near the latest candles and excludes it when panning into history", () => {
        const { label, scale, panAway } = fixture();
        label.update(quote);
        expect(scale()).toEqual({ ...info, priceRange: { minValue: 90, maxValue: 120 } });
        panAway();
        expect(scale()).toBe(info);
    });
    it("preserves manual scaling and restores the provider on cleanup", () => {
        const { label, scale, manual, series } = fixture();
        label.update(quote);
        manual();
        expect(scale()).toBe(info);
        label.dispose();
        expect(series.removePriceLine).toHaveBeenCalledOnce();
        expect(series.applyOptions).toHaveBeenLastCalledWith({ autoscaleInfoProvider: expect.any(Function) });
        expect(scale()).toBe(info);
    });
    it("does not touch a removed series during recreation or unmount", () => {
        const { label, series } = fixture();
        label.update(quote);
        series.applyOptions.mockClear();
        label.dispose(false);
        expect(series.removePriceLine).not.toHaveBeenCalled();
        expect(series.applyOptions).not.toHaveBeenCalled();
    });
    it("preserves empty charts and original ranges without an active quote", () => {
        expect(includeQuoteInScale(null, quote, true, true)).toBeNull();
        expect(includeQuoteInScale({ priceRange: null }, quote, true, true)).toEqual({ priceRange: null });
        expect(includeQuoteInScale(info, null, true, true)).toBe(info);
        expect(includeQuoteInScale(info, { ...quote, price: 80 }, true, true)?.priceRange).toEqual({ minValue: 80, maxValue: 100 });
        expect(info.priceRange).toEqual({ minValue: 90, maxValue: 100 });
    });
});
