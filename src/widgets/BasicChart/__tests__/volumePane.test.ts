import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistogramSeries, PriceScaleMode } from "lightweight-charts";
import type {
  HistogramData,
  IChartApi,
  LogicalRange,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";
import type { Bar } from "../../../services/types";
import { getChartColors } from "../../../styles/tokens";
import {
  VolumePane,
  volumePoint,
  type VolumeMode,
  type VolumeStatus,
} from "../volumePane";

vi.mock("../../../styles/tokens", () => ({ getChartColors: vi.fn() }));
type Point = HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;
const colors = { bull: "#26a69a", bear: "#ef5350" };
const enabledModes = [
  "pane",
  "overlay",
] as const satisfies readonly VolumeMode[];
const modes = ["off", ...enabledModes] as const satisfies readonly VolumeMode[];
const bar = (
  time: number,
  volume?: number | null,
  close = 11,
  open = 10,
): Bar => ({
  time,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  ...(volume === undefined ? {} : { volume }),
});
const unreadable = new Proxy([] as Bar[], {
  get: () => {
    throw new Error("disabled bars read");
  },
});
beforeEach(() =>
  vi
    .mocked(getChartColors)
    .mockReset()
    .mockReturnValue(colors as ReturnType<typeof getChartColors>),
);

function fixture(
  initialRange: LogicalRange | null = { from: -3.5, to: 25.5 } as LogicalRange,
) {
  let range = initialRange;
  let disposed = false;
  // Simulate range drift at mutation boundaries so restore assertions are not vacuous.
  const drift = () => {
    if (disposed) throw new Error("disposed chart");
    range = { from: 700, to: 900 } as LogicalRange;
  };
  const timeScale = {
    getVisibleLogicalRange: vi.fn(() => range),
    setVisibleLogicalRange: vi.fn((next: LogicalRange) => {
      range = next;
    }),
    fitContent: vi.fn(),
    resetTimeScale: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
  };
  function makeScale() {
    return {
      applyOptions: vi.fn<(options: unknown) => void>(),
      options: () => ({
        mode: PriceScaleMode.Percentage,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      }),
    };
  }
  function makeSeries(scale: ReturnType<typeof makeScale>) {
    let removed = false;
    const assertActive = () => {
      if (disposed || removed) throw new Error("disposed series");
    };
    return {
      setData: vi.fn((_points: readonly Point[]) => {
        assertActive();
        drift();
      }),
      update: vi.fn((_point: Point) => assertActive()),
      data: vi.fn(() => []),
      priceScale: vi.fn(() => scale),
      applyOptions: vi.fn(),
      markRemoved: () => {
        assertActive();
        removed = true;
      },
    };
  }
  type Series = ReturnType<typeof makeSeries>;
  function makePane(weight = 1) {
    const scale = makeScale();
    const scales = new Map([["right", scale]]);
    const attached = new Set<Series>();
    const pane = {
      getStretchFactor: vi.fn(() => weight),
      setStretchFactor: vi.fn(),
      addSeries: vi.fn(
        (_definition: unknown, options: { priceScaleId?: string }): Series => {
          drift();
          const priceScaleId = options.priceScaleId ?? "right";
          let seriesScale = scales.get(priceScaleId);
          if (!seriesScale) {
            seriesScale = makeScale();
            scales.set(priceScaleId, seriesScale);
          }
          const series = makeSeries(seriesScale);
          attached.add(series);
          owned.push({
            pane,
            series,
            scale: seriesScale,
            scales,
            attached,
            priceScaleId,
          });
          return series;
        },
      ),
    };
    return { pane, scale, scales, attached };
  }
  const owned: {
    pane: ReturnType<typeof makePane>["pane"];
    series: Series;
    scale: ReturnType<typeof makeScale>;
    scales: Map<string, ReturnType<typeof makeScale>>;
    attached: Set<Series>;
    priceScaleId: string;
  }[] = [];
  const main = makePane(12);
  const priceSeries = makeSeries(main.scale);
  main.attached.add(priceSeries);
  const active = [main.pane];
  const chart = {
    panes: vi.fn(() => active),
    timeScale: () => timeScale,
    priceScale: vi.fn(() => main.scale),
    addPane: vi.fn((_preserve: boolean) => {
      drift();
      const next = makePane();
      active.push(next.pane);
      return next.pane;
    }),
    removeSeries: vi.fn((series: unknown) => {
      drift();
      const entry = owned.find((entry) => entry.series === series);
      if (!entry || !entry.attached.has(entry.series)) {
        throw new Error("removing unowned or already removed series");
      }
      entry.series.markRemoved();
      entry.attached.delete(entry.series);
      if (
        entry.priceScaleId !== "right" &&
        entry.priceScaleId !== "left" &&
        !owned.some(
          (other) =>
            other.pane === entry.pane &&
            other.priceScaleId === entry.priceScaleId &&
            other.attached.has(other.series),
        )
      ) {
        entry.scales.delete(entry.priceScaleId);
      }
      if (entry.attached.size === 0) {
        const index = active.indexOf(entry.pane);
        if (index >= 0) active.splice(index, 1);
      }
    }),
    removePane: vi.fn(),
    addSeries: vi.fn(),
    chartElement: vi.fn(),
    applyOptions: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    remove: vi.fn(() => {
      disposed = true;
      main.attached.clear();
      for (const entry of owned) entry.attached.clear();
      active.length = 0;
    }),
  };
  const api = chart as unknown as IChartApi;
  return {
    chart,
    api,
    volume: new VolumePane(api),
    main,
    priceSeries,
    owned,
    active,
    histograms: () => owned.filter((entry) => entry.attached.has(entry.series)),
    timeScale,
    range: () => range,
  };
}

describe("volumePoint", () => {
  it.each([undefined, null, -1, NaN, Infinity, -Infinity])(
    "uses time-only whitespace for unreported/invalid volume %s",
    (volume) => {
      const point: Point = volumePoint(bar(100, volume), colors);
      expect(point).toEqual({ time: 100 });
    },
  );
  it.each([0, 0.5, 10, Number.MAX_VALUE])(
    "retains finite nonnegative reported volume %s",
    (volume) => {
      expect(volumePoint(bar(100, volume), colors)).toEqual({
        time: 100,
        value: volume,
        color: colors.bull,
      });
    },
  );
  it.each([
    [11, colors.bull],
    [10, colors.bull],
    [9, colors.bear],
  ] as const)(
    "colors raw close %s against open, including dojis",
    (close, color) => {
      expect(volumePoint(bar(100, 5, close), colors)).toEqual({
        time: 100,
        value: 5,
        color,
      });
    },
  );
});

describe("VolumePane", () => {
  it("lazily creates a native 20%-weight pane with an independent normal volume scale", () => {
    const { volume, chart, main, owned, active } = fixture();
    expect(chart.addPane).not.toHaveBeenCalled();
    expect(volume.update([bar(1, 5)], "pane")).toBe("shown");
    const { pane, scale, series } = owned[0];
    expect(active).toEqual([main.pane, pane]);
    expect(chart.addPane).toHaveBeenCalledExactlyOnceWith(false);
    expect(pane.addSeries).toHaveBeenCalledExactlyOnceWith(
      HistogramSeries,
      expect.objectContaining({
        priceScaleId: "right",
        priceFormat: { type: "volume" },
        base: 0,
        lastValueVisible: false,
        priceLineVisible: false,
      }),
    );
    expect(pane.setStretchFactor).toHaveBeenCalledExactlyOnceWith(
      main.pane.getStretchFactor() / 4,
    );
    expect(series.priceScale).toHaveBeenCalled();
    expect(scale).not.toBe(main.scale);
    expect(scale.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: PriceScaleMode.Normal,
        autoScale: true,
        scaleMargins: { top: 0.15, bottom: 0 },
      }),
    );
    expect(main.pane.setStretchFactor).not.toHaveBeenCalled();
    expect(main.scale.applyOptions).not.toHaveBeenCalled();
    expect(chart.priceScale).not.toHaveBeenCalled();
    expect(chart.addSeries).not.toHaveBeenCalled();
    expect(chart.applyOptions).not.toHaveBeenCalled();
  });

  it("creates overlay volume on the main pane with an independent hidden scale and no layout changes", () => {
    const f = fixture();
    const priceOptions = f.main.scale.options();
    expect(f.volume.update([bar(1, 5)], "overlay")).toBe("shown");
    const { pane, scale, series } = f.owned[0];
    expect(pane).toBe(f.main.pane);
    expect(f.active).toEqual([f.main.pane]);
    expect(f.histograms()).toHaveLength(1);
    expect(f.main.attached).toEqual(new Set([f.priceSeries, series]));
    expect(f.main.pane.addSeries).toHaveBeenCalledExactlyOnceWith(
      HistogramSeries,
      expect.objectContaining({
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        base: 0,
        lastValueVisible: false,
        priceLineVisible: false,
      }),
    );
    expect(scale).toBe(f.main.scales.get("volume"));
    expect(scale).not.toBe(f.main.scale);
    expect(series.priceScale).toHaveBeenCalled();
    expect(scale.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: PriceScaleMode.Normal,
        autoScale: true,
        scaleMargins: { top: 0.8, bottom: 0 },
      }),
    );
    for (const [options] of scale.applyOptions.mock.calls) {
      expect(options).not.toHaveProperty("visible");
    }
    expect(f.chart.addPane).not.toHaveBeenCalled();
    expect(f.main.pane.getStretchFactor).not.toHaveBeenCalled();
    expect(f.main.pane.setStretchFactor).not.toHaveBeenCalled();
    expect(f.main.scale.applyOptions).not.toHaveBeenCalled();
    expect(f.main.scale.options()).toEqual(priceOptions);
    expect(f.priceSeries.applyOptions).not.toHaveBeenCalled();
    expect(f.chart.priceScale).not.toHaveBeenCalled();
    expect(f.chart.addSeries).not.toHaveBeenCalled();
    expect(f.chart.applyOptions).not.toHaveBeenCalled();
  });

  describe.each(enabledModes)("%s mode", (mode) => {
    const noPositiveVolumes = [
      [],
      [0],
      [null],
      [undefined],
      [-1],
      [NaN],
      [Infinity],
      [-Infinity],
      [0, null, undefined, -1, NaN, Infinity],
    ].map((volumes) => ({ volumes }));

    it.each(noPositiveVolumes)(
      "stays empty without a positive finite volume in loaded bars: %j",
      ({ volumes }) => {
        const f = fixture();
        const status: VolumeStatus = f.volume.update(
          volumes.map((value, index) => bar(index + 1, value)),
          mode,
        );
        expect(status).toBe("empty");
        expect(f.chart.addPane).not.toHaveBeenCalled();
        expect(f.main.pane.addSeries).not.toHaveBeenCalled();
        expect(f.owned).toHaveLength(0);
        expect(f.active).toEqual([f.main.pane]);
        expect(getChartColors).not.toHaveBeenCalled();
      },
    );

    it("keeps zero and whitespace alongside positives, reusing one histogram for history revisions", () => {
      const f = fixture();
      const bars = Object.freeze([
        bar(1, 5, 90, 100),
        bar(2, 0, 95, 96),
        bar(3, null),
        bar(4),
        bar(5, -1),
        bar(6, NaN),
        bar(7, Infinity),
        bar(8, -Infinity),
      ]);
      expect(f.volume.update(bars, mode)).toBe("shown");
      const { series } = f.owned[0];
      expect(series.setData).toHaveBeenLastCalledWith([
        { time: 1, value: 5, color: "#ef53504d" },
        { time: 2, value: 0, color: "#ef53504d" },
        { time: 3 },
        { time: 4 },
        { time: 5 },
        { time: 6 },
        { time: 7 },
        { time: 8 },
      ]);
      expect(f.volume.update([bar(1, 7), bar(2, 8)], mode)).toBe("shown");
      expect(series.setData).toHaveBeenLastCalledWith([
        { time: 1, value: 7, color: "#26a69a4d" },
        { time: 2, value: 8, color: "#26a69a4d" },
      ]);
      expect(f.owned).toHaveLength(1);
      expect(f.histograms()).toEqual([f.owned[0]]);
      expect(f.chart.addPane).toHaveBeenCalledTimes(mode === "pane" ? 1 : 0);
      expect(f.chart.removeSeries).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      "removes only its histogram when off (live=%s) without reading bars or series data, then can re-enable",
      (live) => {
        const f = fixture();
        expect(f.volume.update(unreadable, "off", live)).toBe("off");
        expect(f.volume.update([bar(1, 2)], mode)).toBe("shown");
        const { series } = f.owned[0];
        vi.mocked(getChartColors).mockClear();
        expect(f.volume.update(unreadable, "off", live)).toBe("off");
        expect(f.volume.update(unreadable, "off", live)).toBe("off");
        expect(f.chart.removeSeries).toHaveBeenCalledExactlyOnceWith(series);
        expect(f.chart.removePane).not.toHaveBeenCalled();
        expect(series.data).not.toHaveBeenCalled();
        expect(series.setData).toHaveBeenCalledOnce();
        expect(series.update).not.toHaveBeenCalled();
        expect(getChartColors).not.toHaveBeenCalled();
        expect(f.histograms()).toHaveLength(0);
        expect(f.active).toEqual([f.main.pane]);
        expect(f.main.attached).toEqual(new Set([f.priceSeries]));
        expect(f.volume.update([bar(2, 3)], mode)).toBe("shown");
        expect(f.owned).toHaveLength(2);
        expect(f.owned[1].series).not.toBe(series);
        expect(f.histograms()).toEqual([f.owned[1]]);
        expect(f.chart.addPane).toHaveBeenCalledTimes(mode === "pane" ? 2 : 0);
        expect(f.main.scale.applyOptions).not.toHaveBeenCalled();
      },
    );

    it.each(noPositiveVolumes)(
      "removes stale volume on a no-data full revision: %j, awaiting history before reactivation",
      ({ volumes }) => {
        const f = fixture();
        f.volume.update([bar(1, 2)], mode);
        const { series } = f.owned[0];
        const original = f.range();
        vi.mocked(getChartColors).mockClear();
        expect(
          f.volume.update(
            volumes.map((value, index) => bar(index + 1, value)),
            mode,
          ),
        ).toBe("empty");
        expect(f.chart.removeSeries).toHaveBeenCalledExactlyOnceWith(series);
        expect(f.histograms()).toHaveLength(0);
        expect(f.active).toEqual([f.main.pane]);
        expect(f.main.attached).toEqual(new Set([f.priceSeries]));
        expect(f.range()).toEqual(original);
        expect(f.volume.update(unreadable, mode, true)).toBe("empty");
        expect(f.volume.update([bar(3)], mode, true)).toBe("empty");
        expect(f.volume.update([bar(3, 4)], mode, true)).toBe("empty");
        expect(f.owned).toHaveLength(1);
        expect(series.setData).toHaveBeenCalledOnce();
        expect(series.update).not.toHaveBeenCalled();
        expect(getChartColors).not.toHaveBeenCalled();
        expect(f.volume.update([bar(3, 4)], mode)).toBe("shown");
        expect(f.owned).toHaveLength(2);
        expect(f.histograms()).toEqual([f.owned[1]]);
      },
    );

    it("does not create a histogram or read history/theme from a live tick before a full update", () => {
      const f = fixture();
      expect(f.volume.update(unreadable, mode, true)).toBe("empty");
      expect(f.volume.update([bar(1, 5)], mode, true)).toBe("empty");
      expect(f.owned).toHaveLength(0);
      expect(f.chart.addPane).not.toHaveBeenCalled();
      expect(f.main.pane.addSeries).not.toHaveBeenCalled();
      expect(getChartColors).not.toHaveBeenCalled();
    });

    it("updates only the last live point with cached colors, appending whitespace without fabricated volume", () => {
      const f = fixture();
      f.volume.update([bar(1, 5)], mode);
      const { series, scale } = f.owned[0];
      vi.mocked(getChartColors)
        .mockReset()
        .mockImplementation(() => {
          throw new Error("live theme lookup");
        });
      f.timeScale.getVisibleLogicalRange.mockClear();
      f.timeScale.setVisibleLogicalRange.mockClear();
      const scaleChanges = scale.applyOptions.mock.calls.length;
      const older = new Proxy(bar(1, 5), {
        get: () => {
          throw new Error("live scanned history");
        },
      });
      const updates: [Bar, Point][] = [
        [
          bar(1, 6, 9),
          { time: 1 as UTCTimestamp, value: 6, color: "#ef53504d" },
        ],
        [bar(2, 0), { time: 2 as UTCTimestamp, value: 0, color: "#26a69a4d" }],
        [
          bar(3, 2, 10),
          { time: 3 as UTCTimestamp, value: 2, color: "#26a69a4d" },
        ],
        [bar(4), { time: 4 as UTCTimestamp }],
        [bar(5, null), { time: 5 as UTCTimestamp }],
        [bar(6, -1), { time: 6 as UTCTimestamp }],
        [bar(7, NaN), { time: 7 as UTCTimestamp }],
        [bar(8, Infinity), { time: 8 as UTCTimestamp }],
        [bar(9, -Infinity), { time: 9 as UTCTimestamp }],
      ];
      for (const [last, expected] of updates) {
        expect(f.volume.update([older, last], mode, true)).toBe("shown");
        expect(series.update).toHaveBeenLastCalledWith(expected);
      }
      expect(f.volume.update([], mode, true)).toBe("shown");
      expect(series.update).toHaveBeenCalledTimes(updates.length);
      expect(series.setData).toHaveBeenCalledOnce();
      expect(series.data).not.toHaveBeenCalled();
      expect(getChartColors).not.toHaveBeenCalled();
      expect(f.owned).toHaveLength(1);
      expect(f.chart.addPane).toHaveBeenCalledTimes(mode === "pane" ? 1 : 0);
      expect(f.chart.removeSeries).not.toHaveBeenCalled();
      expect(scale.applyOptions).toHaveBeenCalledTimes(scaleChanges);
      expect(f.timeScale.getVisibleLogicalRange).not.toHaveBeenCalled();
      expect(f.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    });

    it("recolors at 4d opacity on a fresh full update without recreating the histogram", () => {
      const f = fixture();
      const bars = [bar(1, 2), bar(2, 3, 9)];
      f.volume.update(bars, mode);
      const { series } = f.owned[0];
      vi.mocked(getChartColors).mockReturnValue({
        bull: "#2196f3",
        bear: "#ff9800",
      } as ReturnType<typeof getChartColors>);
      expect(f.volume.update(bars, mode)).toBe("shown");
      expect(series.setData).toHaveBeenLastCalledWith([
        { time: 1, value: 2, color: "#2196f34d" },
        { time: 2, value: 3, color: "#ff98004d" },
      ]);
      expect(getChartColors).toHaveBeenCalledTimes(2);
      expect(f.owned).toHaveLength(1);
      expect(f.chart.addPane).toHaveBeenCalledTimes(mode === "pane" ? 1 : 0);
      expect(f.chart.removeSeries).not.toHaveBeenCalled();
      vi.mocked(getChartColors).mockClear();
      expect(f.volume.update([bar(3, 4, 9)], mode, true)).toBe("shown");
      expect(series.update).toHaveBeenLastCalledWith({
        time: 3 as UTCTimestamp,
        value: 4,
        color: "#ff98004d",
      });
      expect(getChartColors).not.toHaveBeenCalled();
    });

    it("captures and restores the logical viewport around full add/setData/remove, never fitting or resetting", () => {
      const f = fixture();
      const original = f.range();
      for (const [bars, selectedMode] of [
        [[bar(1, 2)], mode],
        [[bar(1, 3)], mode],
        [[bar(1)], mode],
        [[bar(2, 4)], mode],
        [unreadable, "off"],
      ] as const) {
        f.timeScale.getVisibleLogicalRange.mockClear();
        f.timeScale.setVisibleLogicalRange.mockClear();
        f.volume.update(bars, selectedMode);
        expect(f.timeScale.getVisibleLogicalRange).toHaveBeenCalled();
        expect(f.timeScale.setVisibleLogicalRange).toHaveBeenLastCalledWith(
          original,
        );
        expect(f.range()).toEqual(original);
      }
      expect(f.timeScale.fitContent).not.toHaveBeenCalled();
      expect(f.timeScale.resetTimeScale).not.toHaveBeenCalled();
      expect(
        f.timeScale.subscribeVisibleLogicalRangeChange,
      ).not.toHaveBeenCalled();
    });
  });

  const transitions = modes.flatMap((from) =>
    modes.map((to) => ({ from, to })),
  );
  it.each(transitions)(
    "handles a full $from -> $to transition with at most one owned histogram and the original logical range",
    ({ from, to }) => {
      const f = fixture();
      const original = f.range();
      f.volume.update(from === "off" ? unreadable : [bar(1, 2)], from);
      const previous = f.histograms()[0];
      const creations = f.owned.length;
      expect(f.volume.update(to === "off" ? unreadable : [bar(1, 3)], to)).toBe(
        to === "off" ? "off" : "shown",
      );
      expect(f.range()).toEqual(original);
      expect(f.histograms()).toHaveLength(to === "off" ? 0 : 1);
      expect(f.active).toHaveLength(to === "pane" ? 2 : 1);
      expect(f.main.attached.has(f.priceSeries)).toBe(true);
      expect(f.owned).toHaveLength(
        creations + (to !== "off" && from !== to ? 1 : 0),
      );
      if (previous && from !== to) {
        expect(f.chart.removeSeries).toHaveBeenCalledExactlyOnceWith(
          previous.series,
        );
        expect(previous.attached.has(previous.series)).toBe(false);
        expect(previous.series.setData).toHaveBeenCalledOnce();
        expect(previous.series.update).not.toHaveBeenCalled();
      } else {
        expect(f.chart.removeSeries).not.toHaveBeenCalled();
      }
      if (to !== "off") {
        const current = f.histograms()[0];
        expect(current.priceScaleId).toBe(
          to === "overlay" ? "volume" : "right",
        );
        expect(current.pane === f.main.pane).toBe(to === "overlay");
        expect(current.series.setData).toHaveBeenLastCalledWith([
          { time: 1, value: 3, color: "#26a69a4d" },
        ]);
        if (previous && from !== to) {
          expect(current.series).not.toBe(previous.series);
          expect(f.chart.removeSeries.mock.invocationCallOrder[0]).toBeLessThan(
            current.pane.addSeries.mock.invocationCallOrder.at(-1)!,
          );
        }
      }
      expect(f.chart.removePane).not.toHaveBeenCalled();
      expect(f.main.scale.applyOptions).not.toHaveBeenCalled();
      expect(f.main.pane.setStretchFactor).not.toHaveBeenCalled();
      expect(f.priceSeries.applyOptions).not.toHaveBeenCalled();
      expect(f.chart.priceScale).not.toHaveBeenCalled();
      expect(f.chart.applyOptions).not.toHaveBeenCalled();
    },
  );

  it.each(transitions)(
    "does not restore a fabricated logical range for a null-range $from -> $to transition",
    ({ from, to }) => {
      const f = fixture(null);
      f.volume.update(from === "off" ? unreadable : [bar(1, 2)], from);
      f.timeScale.getVisibleLogicalRange.mockReturnValue(null);
      f.timeScale.setVisibleLogicalRange.mockClear();
      expect(f.volume.update(to === "off" ? unreadable : [bar(1, 3)], to)).toBe(
        to === "off" ? "off" : "shown",
      );
      expect(f.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
      expect(f.timeScale.fitContent).not.toHaveBeenCalled();
      expect(f.timeScale.resetTimeScale).not.toHaveBeenCalled();
    },
  );

  it.each(enabledModes)(
    "does not restore a fabricated logical range when removing no-data %s volume",
    (mode) => {
      const f = fixture(null);
      f.volume.update([bar(1, 2)], mode);
      f.timeScale.getVisibleLogicalRange.mockReturnValue(null);
      f.timeScale.setVisibleLogicalRange.mockClear();
      expect(f.volume.update([bar(1, 0)], mode)).toBe("empty");
      expect(f.chart.removeSeries).toHaveBeenCalledExactlyOnceWith(
        f.owned[0].series,
      );
      expect(f.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    },
  );

  it.each(
    enabledModes.flatMap((from) =>
      enabledModes.filter((to) => from !== to).map((to) => ({ from, to })),
    ),
  )(
    "returns empty for a live $from -> $to mismatch without scanning, recoloring or changing series, until a full update",
    ({ from, to }) => {
      const f = fixture();
      f.volume.update([bar(1, 2)], from);
      const previous = f.owned[0];
      vi.mocked(getChartColors).mockClear();
      f.timeScale.getVisibleLogicalRange.mockClear();
      f.timeScale.setVisibleLogicalRange.mockClear();
      expect(f.volume.update(unreadable, to, true)).toBe("empty");
      expect(f.volume.update([bar(1, 3)], to, true)).toBe("empty");
      expect(f.histograms()).toEqual([previous]);
      expect(f.owned).toHaveLength(1);
      expect(previous.series.setData).toHaveBeenCalledOnce();
      expect(previous.series.update).not.toHaveBeenCalled();
      expect(previous.series.data).not.toHaveBeenCalled();
      expect(f.chart.removeSeries).not.toHaveBeenCalled();
      expect(getChartColors).not.toHaveBeenCalled();
      expect(f.timeScale.getVisibleLogicalRange).not.toHaveBeenCalled();
      expect(f.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
      expect(f.volume.update([bar(1, 3)], to)).toBe("shown");
      expect(f.chart.removeSeries).toHaveBeenCalledExactlyOnceWith(
        previous.series,
      );
      expect(f.owned).toHaveLength(2);
      expect(f.histograms()).toEqual([f.owned[1]]);
      expect(f.volume.update([bar(2, 4)], to, true)).toBe("shown");
      expect(f.owned[1].series.update).toHaveBeenLastCalledWith({
        time: 2 as UTCTimestamp,
        value: 4,
        color: "#26a69a4d",
      });
    },
  );

  it.each(
    enabledModes.flatMap((from) =>
      enabledModes.filter((to) => from !== to).map((to) => ({ from, to })),
    ),
  )(
    "removes $from volume without creating $to volume when a mode change has no usable history",
    ({ from, to }) => {
      const f = fixture();
      f.volume.update([bar(1, 2)], from);
      const original = f.range();
      expect(f.volume.update([bar(1, 0), bar(2)], to)).toBe("empty");
      expect(f.chart.removeSeries).toHaveBeenCalledExactlyOnceWith(
        f.owned[0].series,
      );
      expect(f.owned).toHaveLength(1);
      expect(f.histograms()).toHaveLength(0);
      expect(f.active).toEqual([f.main.pane]);
      expect(f.range()).toEqual(original);
      expect(f.volume.update([bar(3, 4)], to, true)).toBe("empty");
      expect(f.owned).toHaveLength(1);
      expect(f.volume.update([bar(3, 4)], to)).toBe("shown");
      expect(f.histograms()).toEqual([f.owned[1]]);
    },
  );

  it("supports repeated off/overlay/pane cycles without accumulating or reusing removed histograms", () => {
    const f = fixture();
    for (const mode of [
      "overlay",
      "pane",
      "overlay",
      "off",
      "pane",
      "off",
      "overlay",
    ] as const) {
      expect(
        f.volume.update(mode === "off" ? unreadable : [bar(1, 2)], mode),
      ).toBe(mode === "off" ? "off" : "shown");
      expect(f.histograms()).toHaveLength(mode === "off" ? 0 : 1);
      expect(f.active).toHaveLength(mode === "pane" ? 2 : 1);
      expect(f.main.attached.has(f.priceSeries)).toBe(true);
    }
    expect(f.owned).toHaveLength(5);
    expect(new Set(f.owned.map(({ series }) => series)).size).toBe(5);
    expect(f.chart.removeSeries).toHaveBeenCalledTimes(4);
    expect(f.histograms()).toEqual([f.owned[4]]);
    expect(f.chart.addPane).toHaveBeenCalledTimes(2);
    expect(f.chart.removePane).not.toHaveBeenCalled();
  });

  it("retains a shared overlay scale until its last owner is removed, then creates a fresh scale", () => {
    const f = fixture();
    const other = new VolumePane(f.api);
    f.volume.update([bar(1, 2)], "overlay");
    other.update([bar(1, 3)], "overlay");
    const sharedScale = f.owned[0].scale;
    expect(f.owned[1].scale).toBe(sharedScale);
    expect(f.main.scales.get("volume")).toBe(sharedScale);

    expect(f.volume.update(unreadable, "off")).toBe("off");
    expect(f.main.scales.get("volume")).toBe(sharedScale);
    expect(f.histograms()).toEqual([f.owned[1]]);
    expect(other.update([bar(2, 4)], "overlay", true)).toBe("shown");
    expect(f.owned[1].series.update).toHaveBeenLastCalledWith({
      time: 2 as UTCTimestamp,
      value: 4,
      color: "#26a69a4d",
    });

    expect(other.update(unreadable, "off")).toBe("off");
    expect(f.main.scales.has("volume")).toBe(false);
    expect(f.main.scales.get("right")).toBe(f.main.scale);
    expect(f.main.attached).toEqual(new Set([f.priceSeries]));
    expect(f.active).toEqual([f.main.pane]);
    expect(f.histograms()).toHaveLength(0);

    expect(f.volume.update([bar(3, 5)], "overlay")).toBe("shown");
    const freshScale = f.owned[2].scale;
    expect(freshScale).not.toBe(sharedScale);
    expect(f.main.scales.get("volume")).toBe(freshScale);
    expect(freshScale.applyOptions).toHaveBeenCalledExactlyOnceWith({
      mode: PriceScaleMode.Normal,
      autoScale: true,
      scaleMargins: { top: 0.8, bottom: 0 },
    });
  });

  it("scopes custom-scale removal to attached owners with the same scale ID on the same pane", () => {
    const f = fixture();
    f.volume.update([bar(1, 2)], "overlay");
    const unrelatedSeries = f.main.pane.addSeries(HistogramSeries, {
      priceScaleId: "other-volume",
    });
    const unrelatedScale = f.owned[1].scale;
    const otherPane = f.chart.addPane(false);
    const otherSeries = otherPane.addSeries(HistogramSeries, {
      priceScaleId: "volume",
    });
    const otherEntry = f.owned[2];
    expect(otherEntry.scale).not.toBe(f.owned[0].scale);

    expect(f.volume.update(unreadable, "off")).toBe("off");
    expect(f.main.scales.has("volume")).toBe(false);
    expect(f.main.scales.get("other-volume")).toBe(unrelatedScale);
    expect(otherEntry.scales.get("volume")).toBe(otherEntry.scale);
    expect(f.main.attached).toEqual(new Set([f.priceSeries, unrelatedSeries]));
    expect(otherEntry.attached.has(otherSeries)).toBe(true);
    expect(f.active).toEqual([f.main.pane, otherPane]);

    f.chart.removeSeries(unrelatedSeries);
    expect(f.main.scales.has("other-volume")).toBe(false);
    expect(otherEntry.scales.get("volume")).toBe(otherEntry.scale);
    f.chart.removeSeries(otherSeries);
    expect(otherEntry.scales.has("volume")).toBe(false);
    expect(f.main.scales.get("right")).toBe(f.main.scale);
    expect(f.main.attached).toEqual(new Set([f.priceSeries]));
    expect(f.active).toEqual([f.main.pane]);
  });

  it.each(
    enabledModes.flatMap((first) =>
      enabledModes.map((second) => ({ first, second })),
    ),
  )(
    "isolates $first/$second instance ownership and leaves final cleanup to chart.remove without helper disposal or listeners",
    ({ first, second }) => {
      const listener = vi.spyOn(EventTarget.prototype, "addEventListener");
      try {
        const f = fixture();
        const other = new VolumePane(f.api);
        f.volume.update([bar(1, 2)], first);
        other.update([bar(1, 3)], second);
        const otherEntry = f.owned[1];
        expect(f.owned[0].series).not.toBe(otherEntry.series);
        f.volume.update(unreadable, "off");
        expect(f.chart.removeSeries).toHaveBeenCalledExactlyOnceWith(
          f.owned[0].series,
        );
        expect(f.histograms()).toEqual([otherEntry]);
        expect(f.active).toContain(otherEntry.pane);
        expect(f.main.attached.has(f.priceSeries)).toBe(true);
        expect(other.update([bar(1, 4)], second)).toBe("shown");
        expect(f.owned).toHaveLength(2);
        expect(otherEntry.series.setData).toHaveBeenCalledTimes(2);
        expect(f.volume).not.toHaveProperty("dispose");
        expect(f.chart.chartElement).not.toHaveBeenCalled();
        expect(f.chart.subscribeCrosshairMove).not.toHaveBeenCalled();
        expect(f.chart.subscribeClick).not.toHaveBeenCalled();
        expect(
          f.timeScale.subscribeVisibleLogicalRangeChange,
        ).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
        f.chart.remove();
        expect(f.histograms()).toHaveLength(0);
        expect(f.active).toHaveLength(0);
        expect(f.chart.removeSeries).toHaveBeenCalledTimes(1);
        const recreated = fixture();
        expect(recreated.volume.update([bar(1, 5)], first)).toBe("shown");
        expect(recreated.owned[0].series).not.toBe(otherEntry.series);
      } finally {
        listener.mockRestore();
      }
    },
  );
});
