import { CrosshairMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { WidgetSettingsDefinition } from "../../settings/types";
import { resolveWidgetSettings } from "../../settings/definitions";

export type GraphicSettings = {
    crosshair: "free" | "close" | "ohlc" | "off";
    horizontalGrid: boolean;
    verticalGrid: boolean;

};

export const graphicSettingsDefinition: WidgetSettingsDefinition = {
    title: "Chart settings",
    tabs: [{ id: "graphic", label: "Graphic", groups: [
        { id: "cursor", label: "Cursor", settings: [
            { id: "crosshair", label: "Crosshair", type: "select", defaultValue: "close", options: [
                { label: "Free", value: "free" }, { label: "Snap to close", value: "close" },
                { label: "Snap to OHLC", value: "ohlc" }, { label: "Off", value: "off" },
            ] },
        ] },
        { id: "grid", label: "Grid", settings: [
            { id: "horizontalGrid", label: "Horizontal lines", type: "boolean", defaultValue: true },
            { id: "verticalGrid", label: "Vertical lines", type: "boolean", defaultValue: true },
        ] },

    ] }],
};

export function resolveGraphicSettings(saved: Record<string, unknown>): GraphicSettings {
    return resolveWidgetSettings(graphicSettingsDefinition, saved) as GraphicSettings;
}
const crosshairModes = {
    free: CrosshairMode.Normal, close: CrosshairMode.Magnet,
    ohlc: CrosshairMode.MagnetOHLC, off: CrosshairMode.Hidden,
};
export function applyGraphicSettings(chart: IChartApi, series: ISeriesApi<any> | null, settings: GraphicSettings) {
    chart.applyOptions({
        crosshair: { mode: crosshairModes[settings.crosshair] },
        grid: { horzLines: { visible: settings.horizontalGrid }, vertLines: { visible: settings.verticalGrid } },
    });
    series?.applyOptions({ priceLineVisible: true, lastValueVisible: true });
}
