import { CrosshairMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { WidgetSettingsDefinition } from "../../settings/types";
import { resolveWidgetSettings } from "../../settings/definitions";
import type { VolumeMode } from "../volumePane";

export type PriceAnnotationMode = "off" | "label" | "line" | "both";
export const annotationHasLabel = (mode: PriceAnnotationMode) =>
  mode === "label" || mode === "both";
export const annotationHasLine = (mode: PriceAnnotationMode) =>
  mode === "line" || mode === "both";
const annotationOptions = [
  { label: "Off", value: "off" },
  { label: "Label", value: "label" },
  { label: "Line", value: "line" },
  { label: "Label & line", value: "both" },
];

export type GraphicSettings = {
  crosshair: "free" | "close" | "ohlc" | "off";
  horizontalGrid: boolean;
  verticalGrid: boolean;
  volume: VolumeMode;
  highLow: boolean;
  lastPrice: PriceAnnotationMode;
  extendedHoursPrice: PriceAnnotationMode;
  previousClose: PriceAnnotationMode;
  legendOHLC: boolean;
  legendVolume: boolean;
  legendChange: boolean;
};

export const graphicSettingsDefinition: WidgetSettingsDefinition = {
  title: "Chart Settings",
  tabs: [
    {
      id: "general",
      label: "General",
      groups: [
        {
          id: "cursor",
          label: "Interaction",
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
          id: "data",
          label: "Data",
          settings: [
            {
              id: "volume",
              label: "Volume",
              type: "select",
              defaultValue: "overlay",
              options: [
                { label: "Off", value: "off" },
                { label: "Overlay", value: "overlay" },
                { label: "Pane", value: "pane" },
              ],
            },
            {
              id: "highLow",
              label: "Visible high / low",
              type: "boolean",
              defaultValue: true,
            },
          ],
        },
      ],
    },
    {
      id: "visual",
      label: "Display",
      groups: [
        {
          id: "priceAnnotations",
          label: "Price Annotations",
          settings: [
            {
              id: "lastPrice",
              label: "Last price",
              type: "select",
              defaultValue: "both",
              options: annotationOptions,
            },

            {
              id: "previousClose",
              label: "Previous close",
              type: "select",
              defaultValue: "off",
              options: annotationOptions,
            },
            {
              id: "extendedHoursPrice",
              label: "Extended hours",
              type: "select",
              defaultValue: "both",
              options: annotationOptions,
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
    {
      id: "legend",
      label: "Legend",
      groups: [
        {
          id: "barInformation",
          label: "Bar information",
          settings: [
            {
              id: "legendOHLC",
              label: "OHLC",
              type: "boolean",
              defaultValue: false,
            },
            {
              id: "legendVolume",
              label: "Volume",
              type: "boolean",
              defaultValue: false,
            },
            {
              id: "legendChange",
              label: "Change",
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
  _series: ISeriesApi<any> | null,
  settings: GraphicSettings,
) {
  chart.applyOptions({
    crosshair: { mode: crosshairModes[settings.crosshair] },
    grid: {
      horzLines: { visible: settings.horizontalGrid },
      vertLines: { visible: settings.verticalGrid },
    },
  });
  // usePriceAnnotations is the sole owner of native last-value/price-line visibility,
  // so theme/config updates cannot briefly restore synthetic or duplicate labels.
}
