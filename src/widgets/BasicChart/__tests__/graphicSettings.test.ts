import { describe, expect, it, vi } from "vitest";
import { CrosshairMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { defaultWidgetSettings, resolveWidgetSettings } from "../../settings/definitions";
import { applyGraphicSettings, graphicSettingsDefinition, resolveGraphicSettings } from "../settings/graphicSettings";

describe("BasicChart graphic settings", () => {
    it("keeps the existing appearance as defaults and validates persisted values", () => {
        expect(defaultWidgetSettings(graphicSettingsDefinition)).toEqual({
            crosshair: "close", horizontalGrid: true, verticalGrid: true,
        });
        expect(resolveWidgetSettings(graphicSettingsDefinition, { crosshair: 2, horizontalGrid: "false" })).toEqual(defaultWidgetSettings(graphicSettingsDefinition));
        expect(resolveGraphicSettings({ crosshair: "ohlc", horizontalGrid: false })).toMatchObject({ crosshair: "ohlc", horizontalGrid: false });
    });

    it("ignores obsolete saved price-line and label settings", () => {
        expect(resolveGraphicSettings({ lastPriceLine: false, lastPriceLabel: false })).toEqual({
            crosshair: "close", horizontalGrid: true, verticalGrid: true,
        });
    });

    it.each([
        ["free", CrosshairMode.Normal], ["close", CrosshairMode.Magnet],
        ["ohlc", CrosshairMode.MagnetOHLC], ["off", CrosshairMode.Hidden],
    ] as const)("applies %s without changing data or viewport", (crosshair, mode) => {
        const chart = { applyOptions: vi.fn(), addSeries: vi.fn(), removeSeries: vi.fn(), timeScale: vi.fn() };
        const series = { applyOptions: vi.fn(), setData: vi.fn() };
        applyGraphicSettings(chart as unknown as IChartApi, series as unknown as ISeriesApi<any>, {
            ...resolveGraphicSettings({}), crosshair, horizontalGrid: false,
        });
        expect(chart.applyOptions).toHaveBeenCalledWith({
            crosshair: { mode }, grid: { horzLines: { visible: false }, vertLines: { visible: true } },
        });
        expect(series.applyOptions).toHaveBeenCalledWith({ priceLineVisible: true, lastValueVisible: true });
        expect(chart.addSeries).not.toHaveBeenCalled();
        expect(chart.removeSeries).not.toHaveBeenCalled();
        expect(chart.timeScale).not.toHaveBeenCalled();
        expect(series.setData).not.toHaveBeenCalled();
    });
});
