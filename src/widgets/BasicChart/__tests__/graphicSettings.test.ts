import { describe, expect, it, vi } from "vitest";
import { CrosshairMode } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import {
  defaultWidgetSettings,
  resolveWidgetSettings,
} from "../../settings/definitions";
import {
  applyGraphicSettings,
  graphicSettingsDefinition,
  resolveGraphicSettings,
} from "../settings/graphicSettings";

describe("BasicChart graphic settings", () => {
  it("keeps the existing appearance as defaults and validates persisted values", () => {
    expect(defaultWidgetSettings(graphicSettingsDefinition)).toEqual({
      crosshair: "close",
      horizontalGrid: false,
      verticalGrid: false,
      volume: "overlay",
      highLow: true,
    });
    expect(
      resolveWidgetSettings(graphicSettingsDefinition, {
        crosshair: 2,
        horizontalGrid: "true",
        highLow: "false",
      }),
    ).toEqual(defaultWidgetSettings(graphicSettingsDefinition));
    expect(
      resolveGraphicSettings({ crosshair: "ohlc", horizontalGrid: false }),
    ).toMatchObject({ crosshair: "ohlc", horizontalGrid: false });
  });

  it.each([
    ["off", "off"],
    ["overlay", "overlay"],
    ["pane", "pane"],
    [true, "overlay"],
    [false, "overlay"],
    ["true", "overlay"],
    ["false", "overlay"],
    ["invalid", "overlay"],
  ] as const)("validates persisted volume %s as %s", (volume, expected) => {
    expect(resolveGraphicSettings({ volume }).volume).toBe(expected);
  });

  it("exposes volume display through the existing select definition", () => {
    const volume = graphicSettingsDefinition.tabs
      .flatMap((tab) => tab.groups)
      .flatMap((group) => group.settings)
      .find((setting) => setting.id === "volume");
    expect(volume).toMatchObject({
      type: "select",
      defaultValue: "overlay",
      options: [
        { label: "Off", value: "off" },
        { label: "Overlay", value: "overlay" },
        { label: "Pane", value: "pane" },
      ],
    });
  });

  it("exposes Highest / Lowest as an enabled boolean in Visual > Labels", () => {
    const visual = graphicSettingsDefinition.tabs.find(
      (tab) => tab.id === "visual",
    );
    const labels = visual?.groups.find((group) => group.id === "labels");
    expect(labels?.label).toBe("Labels");
    expect(labels?.settings).toEqual([
      {
        id: "highLow",
        label: "Highest / Lowest",
        type: "boolean",
        defaultValue: true,
      },
    ]);
  });

  it.each([
    [true, true],
    [false, false],
    ["false", true],
    [1, true],
  ] as const)("validates persisted highLow %s as %s", (highLow, expected) => {
    expect(resolveGraphicSettings({ highLow }).highLow).toBe(expected);
  });

  it("ignores obsolete saved price-line and label settings", () => {
    expect(
      resolveGraphicSettings({ lastPriceLine: false, lastPriceLabel: false }),
    ).toEqual({
      crosshair: "close",
      horizontalGrid: false,
      verticalGrid: false,
      volume: "overlay",
      highLow: true,
    });
  });

  it.each([
    ["free", CrosshairMode.Normal],
    ["close", CrosshairMode.Magnet],
    ["ohlc", CrosshairMode.MagnetOHLC],
    ["off", CrosshairMode.Hidden],
  ] as const)(
    "applies %s without changing data or viewport",
    (crosshair, mode) => {
      const chart = {
        applyOptions: vi.fn(),
        addSeries: vi.fn(),
        removeSeries: vi.fn(),
        timeScale: vi.fn(),
      };
      const series = { applyOptions: vi.fn(), setData: vi.fn() };
      applyGraphicSettings(
        chart as unknown as IChartApi,
        series as unknown as ISeriesApi<any>,
        {
          ...resolveGraphicSettings({}),
          crosshair,
          horizontalGrid: false,
          volume: "overlay",
        },
      );
      expect(chart.applyOptions).toHaveBeenCalledWith({
        crosshair: { mode },
        grid: { horzLines: { visible: false }, vertLines: { visible: true } },
      });
      expect(series.applyOptions).toHaveBeenCalledWith({
        priceLineVisible: true,
        lastValueVisible: true,
      });
      expect(chart.addSeries).not.toHaveBeenCalled();
      expect(chart.removeSeries).not.toHaveBeenCalled();
      expect(chart.timeScale).not.toHaveBeenCalled();
      expect(series.setData).not.toHaveBeenCalled();
    },
  );
});
