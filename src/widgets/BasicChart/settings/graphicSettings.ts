import { CrosshairMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { WidgetSettingsDefinition } from "../../settings/types";
import { resolveWidgetSettings } from "../../settings/definitions";
import type { VolumeMode } from "../volumePane";

export type GraphicSettings = {
  crosshair: "free" | "close" | "ohlc" | "off";
  horizontalGrid: boolean;
  verticalGrid: boolean;
  volume: VolumeMode;
  highLow: boolean;
};

export const graphicSettingsDefinition: WidgetSettingsDefinition = {
  title: "Chart settings",
  tabs: [
    {
      id: "general",
      label: "General",
      groups: [
        {
          id: "cursor",
          label: "Cursor",
          settings: [
            {
              id: "crosshair",
              label: "Crosshair",
              type: "select",
              defaultValue: "close",
              options: [
                { label: "Free", value: "free" },
                { label: "Snap to close", value: "close" },
                { label: "Snap to OHLC", value: "ohlc" },
                { label: "Off", value: "off" },
              ],
            },
          ],
        },
        {
          id: "volume",
          label: "Volume",
          settings: [
            {
              id: "volume",
              label: "Display",
              type: "select",
              defaultValue: "overlay",
              options: [
                { label: "Off", value: "off" },
                { label: "Overlay", value: "overlay" },
                { label: "Pane", value: "pane" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "visual",
      label: "Visual",
      groups: [
        {
          id: "labels",
          label: "Labels",
          settings: [
            {
              id: "highLow",
              label: "Highest / Lowest",
              type: "boolean",
              defaultValue: true,
            },
          ],
        },
        {
          id: "grid",
          label: "Grid",
          settings: [
            {
              id: "horizontalGrid",
              label: "Horizontal lines",
              type: "boolean",
              defaultValue: false,
            },
            {
              id: "verticalGrid",
              label: "Vertical lines",
              type: "boolean",
              defaultValue: false,
            },
          ],
        },
      ],
    },
  ],
};

export function resolveGraphicSettings(
  saved: Record<string, unknown>,
): GraphicSettings {
  return resolveWidgetSettings(
    graphicSettingsDefinition,
    saved,
  ) as GraphicSettings;
}
const crosshairModes = {
  free: CrosshairMode.Normal,
  close: CrosshairMode.Magnet,
  ohlc: CrosshairMode.MagnetOHLC,
  off: CrosshairMode.Hidden,
};
export function applyGraphicSettings(
  chart: IChartApi,
  series: ISeriesApi<any> | null,
  settings: GraphicSettings,
) {
  chart.applyOptions({
    crosshair: { mode: crosshairModes[settings.crosshair] },
    grid: {
      horzLines: { visible: settings.horizontalGrid },
      vertLines: { visible: settings.verticalGrid },
    },
  });
  series?.applyOptions({ priceLineVisible: true, lastValueVisible: true });
}
