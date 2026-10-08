import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MismatchDirection } from "lightweight-charts";
import type {
  BarData,
  DataChangedHandler,
  DataChangedScope,
  IChartApi,
  IPrimitivePaneRenderer,
  IRange,
  ISeriesApi,
  ISeriesPrimitive,
  LineData,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";
import { findVisibleExtrema, VisibleExtrema } from "../visibleExtrema";
import type { PriceSeriesType } from "../visibleExtrema";

const theme = vi.hoisted(() => ({ textMuted: "#778899" }));
vi.mock("../../../styles/tokens", () => ({
  getChartColors: () => ({ ...theme }),
}));

const utc = (index: number): UTCTimestamp =>
  (1700000000 + index * 60) as UTCTimestamp;
type Row = {
  index: number;
  point: BarData<Time> | LineData<Time> | WhitespaceData<Time>;
};
const bar = (index: number, high = 120.125, low = 80.875): Row => ({
  index,
  point: { time: utc(index), open: 100, high, low, close: 100 },
});
const value = (index: number, price: number): Row => ({
  index,
  point: { time: utc(index), value: price },
});
const empty = { high: null, low: null };

function fixture(
  rows: Row[] = [bar(0)],
  type: PriceSeriesType = "Candlestick",
) {
  const listeners = new Set<DataChangedHandler>();
  let lookups = 0;
  const mutate = vi.fn();
  const state = {
    range: { from: 0, to: 2 } as IRange<number> | null,
    width: 400,
    height: 100,
    invertScale: false,
    layout: { fontFamily: "Test Sans", fontSize: 12 },
    x: (time: Time): number | null => 50 + (Number(time) - Number(utc(0))) / 6,
    y: (price: number): number | null => (price >= 100 ? 30 : 70),
  };
  const timeScale = {
    getVisibleLogicalRange: vi.fn(() => state.range),
    timeToIndex: vi.fn(
      (time: Time) =>
        rows.find((row) => row.point.time === time)?.index ?? null,
    ),
    timeToCoordinate: vi.fn((time: Time) => state.x(time)),
    width: () => state.width,
    setVisibleLogicalRange: mutate,
    setVisibleRange: mutate,
    fitContent: mutate,
    scrollToRealTime: mutate,
    applyOptions: mutate,
    subscribeVisibleLogicalRangeChange: vi.fn(),
  };
  const scale = {
    options: () => ({ invertScale: state.invertScale, autoScale: true }),
    applyOptions: mutate,
  };
  const format = vi.fn((price: number) => `fmt(${price})`);
  const series = {
    // Native lookup addresses global logical indices and skips whitespace, not array offsets.
    dataByIndex: vi.fn((cursor: number, direction = MismatchDirection.None) => {
      if (++lookups > 100) throw new Error("Unbounded logical-index scan");
      const priced = rows.filter(
        (row) => "high" in row.point || "value" in row.point,
      );
      const row =
        direction === MismatchDirection.NearestRight
          ? priced.find((row) => row.index >= cursor)
          : direction === MismatchDirection.NearestLeft
            ? priced.filter((row) => row.index <= cursor).at(-1)
            : priced.find((row) => row.index === cursor);
      return row?.point ?? null;
    }),
    data: vi.fn(() => {
      throw new Error("Extrema must not read full series data");
    }),
    seriesType: () => type,
    subscribeDataChanged: vi.fn((handler: DataChangedHandler) => {
      listeners.add(handler);
    }),
    unsubscribeDataChanged: vi.fn((handler: DataChangedHandler) => {
      listeners.delete(handler);
    }),
    priceToCoordinate: vi.fn((price: number) => state.y(price)),
    priceFormatter: () => ({ format }),
    priceScale: () => scale,
    getPane: () => pane,
    applyOptions: mutate,
    setData: mutate,
    update: mutate,
    createPriceLine: mutate,
  };
  const volume = {
    data: vi.fn(),
    dataByIndex: vi.fn(),
    subscribeDataChanged: vi.fn(),
  };
  const pane = {
    getHeight: () => state.height,
    paneIndex: () => 0,
    getSeries: (): ISeriesApi<PriceSeriesType>[] => [
      series as unknown as ISeriesApi<PriceSeriesType>,
    ],
  };
  const chart = {
    timeScale: () => timeScale,
    options: vi.fn(() => ({ layout: state.layout })),
    priceScale: () => scale,
    applyOptions: mutate,
    // The renderer's media height is the price pane, not the whole chart plus volume.
    panes: () => [pane, { getHeight: () => 250, getSeries: () => [volume] }],
  };
  const requestUpdate = vi.fn();
  return {
    rows,
    state,
    series,
    chart,
    timeScale,
    scale,
    volume,
    format,
    requestUpdate,
    listeners,
    mutate,
    chartApi: chart as unknown as IChartApi,
    seriesApi: series as unknown as ISeriesApi<PriceSeriesType>,
    emit: (scope: DataChangedScope = "update") => {
      for (const handler of listeners) handler(scope);
    },
  };
}

function attach(
  f: ReturnType<typeof fixture>,
  primitive = new VisibleExtrema(),
) {
  primitive.attached({
    chart: f.chartApi,
    series: f.seriesApi,
    requestUpdate: f.requestUpdate,
  } as SeriesAttachedParameter<Time>);
  return primitive;
}

type Label = {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  color: string;
  font: string;
};
function draw(primitive: VisibleExtrema, width = 400, height = 100) {
  const labels: Label[] = [];
  const context = {
    font: "12px sans-serif",
    fillStyle: "#000",
    textAlign: "start",
    textBaseline: "alphabetic",
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn(
      (
        text: string,
      ): Pick<
        TextMetrics,
        | "width"
        | "actualBoundingBoxAscent"
        | "actualBoundingBoxDescent"
        | "fontBoundingBoxAscent"
        | "fontBoundingBoxDescent"
      > => {
        const size = Number(context.font.match(/([\d.]+)px/)?.[1] ?? 12);
        return {
          width: text.length * 6,
          actualBoundingBoxAscent: (size * 2) / 3,
          actualBoundingBoxDescent: size / 3,
          fontBoundingBoxAscent: (size * 2) / 3,
          fontBoundingBoxDescent: size / 3,
        };
      },
    ),
    fillText: vi.fn((text: string, x: number, y: number): void => {
      const metrics = context.measureText(text);
      const size =
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      const left =
        x -
        (context.textAlign === "right" || context.textAlign === "end"
          ? metrics.width
          : context.textAlign === "center"
            ? metrics.width / 2
            : 0);
      const top =
        y -
        (context.textBaseline === "middle"
          ? size / 2
          : context.textBaseline === "bottom" ||
              context.textBaseline === "ideographic"
            ? size
            : context.textBaseline === "top" ||
                context.textBaseline === "hanging"
              ? 0
              : metrics.actualBoundingBoxAscent);
      labels.push({
        text,
        left,
        right: left + metrics.width,
        top,
        bottom: top + size,
        color: context.fillStyle,
        font: context.font,
      });
    }),
  };
  const target = {
    useMediaCoordinateSpace: vi.fn((callback) =>
      callback({ context, mediaSize: { width, height } }),
    ),
  };
  primitive
    .paneViews()[0]
    .renderer()
    ?.draw(target as unknown as Parameters<IPrimitivePaneRenderer["draw"]>[0]);
  return { labels, context, target };
}

function label(labels: Label[], kind: "H" | "L") {
  const found = labels.find((item) => item.text.startsWith(`${kind}:`));
  expect(found, `${kind}: label`).toBeDefined();
  return found!;
}

beforeEach(() => {
  theme.textMuted = "#778899";
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("findVisibleExtrema", () => {
  it.each<PriceSeriesType>(["Bar", "Candlestick"])(
    "uses OHLC high/low rather than open/close for %s",
    (type) => {
      const f = fixture(
        [bar(0, 110, 90), bar(1, 140, 70), bar(2, 130, 60)],
        type,
      );
      expect(
        findVisibleExtrema(f.chartApi, f.seriesApi, { from: 0, to: 2 }),
      ).toEqual({
        high: { time: utc(1), price: 140 },
        low: { time: utc(2), price: 60 },
      });
      expect(f.series.data).not.toHaveBeenCalled();
    },
  );

  it.each([
    { from: 0.1, to: 2.9 },
    { from: 1, to: 2 },
  ])("includes only logical centers in $from..$to", (range) => {
    const f = fixture([
      bar(0, 900, -900),
      bar(1, 120, 80),
      bar(2, 130, 70),
      bar(3, 800, -800),
    ]);
    expect(findVisibleExtrema(f.chartApi, f.seriesApi, range)).toEqual({
      high: { time: utc(2), price: 130 },
      low: { time: utc(2), price: 70 },
    });
    expect(f.series.dataByIndex.mock.calls.map((call) => call[0])).toEqual([
      1, 2,
    ]);
  });

  it("jumps over large global whitespace gaps and rejects a nearest-right point beyond the range", () => {
    const f = fixture([
      bar(1, 999, -999),
      bar(20, 120, 80),
      { index: 500000, point: { time: utc(500000) } },
      bar(1000000, 130, 70),
      bar(1000003, 999, -999),
    ]);
    expect(
      findVisibleExtrema(f.chartApi, f.seriesApi, { from: 2, to: 1000002 }),
    ).toEqual({
      high: { time: utc(1000000), price: 130 },
      low: { time: utc(1000000), price: 70 },
    });
    expect(f.series.dataByIndex.mock.calls).toEqual([
      [2, MismatchDirection.NearestRight],
      [21, MismatchDirection.NearestRight],
      [1000001, MismatchDirection.NearestRight],
    ]);
    expect(f.timeScale.timeToIndex.mock.calls.map((call) => call[0])).toEqual([
      utc(20),
      utc(1000000),
      utc(1000003),
    ]);
    expect(f.series.data).not.toHaveBeenCalled();
    expect(f.volume.dataByIndex).not.toHaveBeenCalled();
  });

  it.each<{ range: IRange<number> | null }>([
    { range: null },
    { range: { from: NaN, to: 2 } },
    { range: { from: 0, to: NaN } },
    { range: { from: -Infinity, to: 2 } },
    { range: { from: 0, to: Infinity } },
    { range: { from: 3, to: 2 } },
    { range: { from: 0.2, to: 0.8 } },
  ])("does not scan an invalid or centerless range: $range", ({ range }) => {
    const f = fixture();
    expect(findVisibleExtrema(f.chartApi, f.seriesApi, range)).toEqual(empty);
    expect(f.series.dataByIndex).not.toHaveBeenCalled();
  });

  it.each<{ rows: Row[] }>([
    { rows: [] },
    { rows: [{ index: 0, point: { time: utc(0) } }] },
    { rows: [bar(10)] },
  ])(
    "returns no extrema for empty, whitespace-only, or off-range data (%#)",
    ({ rows }) => {
      const f = fixture(rows);
      expect(
        findVisibleExtrema(f.chartApi, f.seriesApi, { from: 0, to: 2 }),
      ).toEqual(empty);
    },
  );

  it("keeps the first visible point when extrema tie", () => {
    const f = fixture([bar(0, 120, 80), bar(1, 120, 80), bar(2, 120, 80)]);
    expect(
      findVisibleExtrema(f.chartApi, f.seriesApi, { from: 1, to: 2 }),
    ).toEqual({
      high: { time: utc(1), price: 120 },
      low: { time: utc(1), price: 80 },
    });
  });

  it("ignores nonfinite OHLC fields independently", () => {
    const f = fixture([
      bar(0, NaN, 70),
      bar(1, 150, -Infinity),
      bar(2, Infinity, NaN),
    ]);
    expect(
      findVisibleExtrema(f.chartApi, f.seriesApi, { from: 0, to: 2 }),
    ).toEqual({
      high: { time: utc(1), price: 150 },
      low: { time: utc(0), price: 70 },
    });
  });

  it.each<PriceSeriesType>(["Line", "Area", "Baseline"])(
    "uses finite values, including zero and negatives, for %s",
    (type) => {
      const f = fixture(
        [
          value(0, NaN),
          value(1, 0),
          value(2, -5),
          value(3, 12),
          value(4, Infinity),
          value(5, 12),
          value(6, -Infinity),
        ],
        type,
      );
      expect(
        findVisibleExtrema(f.chartApi, f.seriesApi, { from: 0, to: 6 }),
      ).toEqual({
        high: { time: utc(3), price: 12 },
        low: { time: utc(2), price: -5 },
      });
      expect(
        findVisibleExtrema(f.chartApi, f.seriesApi, { from: 1, to: 1 }),
      ).toEqual({
        high: { time: utc(1), price: 0 },
        low: { time: utc(1), price: 0 },
      });
    },
  );

  it("returns null extrema when every price is nonfinite", () => {
    const f = fixture([bar(0, NaN, Infinity), bar(1, -Infinity, NaN)]);
    expect(
      findVisibleExtrema(f.chartApi, f.seriesApi, { from: 0, to: 2 }),
    ).toEqual(empty);
  });
});

describe("VisibleExtrema native primitive", () => {
  it("exposes one stable top pane view and is inert before attachment", () => {
    const primitive = new VisibleExtrema();
    const native: ISeriesPrimitive<Time> = primitive;
    const views = primitive.paneViews();
    expect(views).toHaveLength(1);
    expect(primitive.paneViews()).toBe(views);
    expect(views[0].zOrder?.()).toBe("top");
    native.updateAllViews?.();
    primitive.refreshTheme();
    expect(draw(primitive).labels).toEqual([]);
    primitive.detached();
    primitive.detached();
  });

  it("caches by rounded bounds but reprojects both coordinates on every native redraw", () => {
    const f = fixture();
    const primitive = attach(f);
    primitive.updateAllViews();
    const before = draw(primitive).labels;
    const scans = f.series.dataByIndex.mock.calls.length;
    f.timeScale.timeToCoordinate.mockClear();
    f.series.priceToCoordinate.mockClear();
    f.state.range = { from: -0.4, to: 2.8 };
    f.state.x = () => 60;
    f.state.y = (price) => (price >= 100 ? 35 : 75);
    primitive.updateAllViews();
    const after = draw(primitive).labels;
    expect(f.series.dataByIndex).toHaveBeenCalledTimes(scans);
    expect(f.timeScale.timeToCoordinate).toHaveBeenCalledWith(utc(0));
    expect(
      f.series.priceToCoordinate.mock.calls.map((call) => call[0]),
    ).toEqual(expect.arrayContaining([120.125, 80.875]));
    for (const kind of ["H", "L"] as const) {
      expect(label(after, kind).left).toBe(label(before, kind).left + 10);
      expect(label(after, kind).top).toBe(label(before, kind).top + 5);
    }
    primitive.updateAllViews();
    expect(f.series.dataByIndex).toHaveBeenCalledTimes(scans);
    expect(f.timeScale.timeToCoordinate.mock.calls.length).toBeGreaterThan(2);
  });

  it("rescans when either rounded logical bound changes", () => {
    const f = fixture([bar(0, 150, 50), bar(1, 120, 80), bar(2, 140, 60)]);
    const primitive = attach(f);
    primitive.updateAllViews();
    const scans = f.series.dataByIndex.mock.calls.length;
    f.state.range = { from: 0.1, to: 2 };
    primitive.updateAllViews();
    expect(f.series.dataByIndex.mock.calls.length).toBeGreaterThan(scans);
    expect(label(draw(primitive).labels, "H").text).toMatch(/H:\s*fmt\(140\)/);
    f.state.range = { from: 0.1, to: 1.9 };
    primitive.updateAllViews();
    expect(label(draw(primitive).labels, "H").text).toMatch(/H:\s*fmt\(120\)/);
  });

  it.each<DataChangedScope>(["update", "full"])(
    "invalidates cached data lazily after a native %s event",
    (scope) => {
      const f = fixture();
      const primitive = attach(f);
      primitive.updateAllViews();
      const scans = f.series.dataByIndex.mock.calls.length;
      f.requestUpdate.mockClear();
      f.rows.splice(0, f.rows.length, bar(0, 150.375, 60.625));
      f.emit(scope);
      expect(f.requestUpdate).toHaveBeenCalledOnce();
      expect(f.series.dataByIndex).toHaveBeenCalledTimes(scans);
      primitive.updateAllViews();
      expect(f.series.dataByIndex.mock.calls.length).toBeGreaterThan(scans);
      expect(label(draw(primitive).labels, "H").text).toMatch(
        /H:\s*fmt\(150\.375\)/,
      );
      expect(label(draw(primitive).labels, "L").text).toMatch(
        /L:\s*fmt\(60\.625\)/,
      );
    },
  );

  it("clears labels for a missing visible range and restores them when it returns", () => {
    const f = fixture();
    const primitive = attach(f);
    primitive.updateAllViews();
    expect(draw(primitive).labels).toHaveLength(2);
    f.state.range = null;
    primitive.updateAllViews();
    expect(draw(primitive).labels).toEqual([]);
    f.state.range = { from: 0, to: 2 };
    primitive.updateAllViews();
    expect(draw(primitive).labels).toHaveLength(2);
    f.rows.splice(0);
    f.emit("full");
    primitive.updateAllViews();
    expect(draw(primitive).labels).toEqual([]);
  });

  it("draws muted formatted text six pixels right, above the high and below the low, without decorations", () => {
    const f = fixture();
    const primitive = attach(f);
    primitive.updateAllViews();
    const { labels, context, target } = draw(primitive);
    expect(labels).toHaveLength(2);
    expect(target.useMediaCoordinateSpace).toHaveBeenCalledOnce();
    expect(f.format).toHaveBeenCalledWith(120.125);
    expect(f.format).toHaveBeenCalledWith(80.875);
    expect(label(labels, "H").text).toMatch(/H:\s*fmt\(120\.125\)/);
    expect(label(labels, "L").text).toMatch(/L:\s*fmt\(80\.875\)/);
    expect(label(labels, "H").bottom).toBeLessThanOrEqual(30 - 6);
    expect(label(labels, "L").top).toBeGreaterThanOrEqual(70 + 6);
    for (const item of labels) {
      expect(item.left).toBe(50 + 6);
      expect(item.color).toBe(theme.textMuted);
      expect(item.font).toContain("12px");
      expect(item.font).toContain("Test Sans");
    }
    for (const method of [
      context.stroke,
      context.fill,
      context.arc,
      context.fillRect,
      context.strokeRect,
      context.moveTo,
      context.lineTo,
    ]) {
      expect(method).not.toHaveBeenCalled();
    }
    expect(context.restore.mock.calls.length).toBe(
      context.save.mock.calls.length,
    );
  });

  it("flips text left near the right edge and clamps within the price pane rather than the volume pane", () => {
    const f = fixture();
    f.state.x = () => 390;
    const primitive = attach(f);
    primitive.updateAllViews();
    const flipped = draw(primitive).labels;
    expect(flipped).toHaveLength(2);
    for (const item of flipped) expect(item.right).toBe(390 - 6);
    f.state.x = () => 0;
    f.state.y = (price) => (price >= 100 ? 0 : 100);
    primitive.updateAllViews();
    const labels = draw(primitive).labels;
    expect(labels).toHaveLength(2);
    for (const item of labels) {
      expect(item.left).toBeGreaterThanOrEqual(4);
      expect(item.right).toBeLessThanOrEqual(396);
      expect(item.top).toBeGreaterThanOrEqual(4);
      expect(item.bottom).toBeLessThanOrEqual(96);
    }
  });

  it("places the high below and low above their points when the attached series scale is inverted", () => {
    const f = fixture();
    const primitive = attach(f);
    primitive.updateAllViews();
    f.state.invertScale = true;
    f.state.y = (price) => (price >= 100 ? 70 : 30);
    primitive.updateAllViews();
    const labels = draw(primitive).labels;
    expect(label(labels, "H").top).toBeGreaterThanOrEqual(70 + 6);
    expect(label(labels, "L").bottom).toBeLessThanOrEqual(30 - 6);
  });

  it("refreshes token color and chart typography without rescanning prices", () => {
    const f = fixture();
    const primitive = attach(f);
    primitive.updateAllViews();
    const scans = f.series.dataByIndex.mock.calls.length;
    theme.textMuted = "#aabbcc";
    f.state.layout = { fontFamily: "Updated Mono", fontSize: 14 };
    f.requestUpdate.mockClear();
    primitive.refreshTheme();
    primitive.updateAllViews();
    const labels = draw(primitive).labels;
    expect(labels).toHaveLength(2);
    for (const item of labels) {
      expect(item.color).toBe("#aabbcc");
      expect(item.font).toContain("14px");
      expect(item.font).toContain("Updated Mono");
    }
    expect(f.series.dataByIndex).toHaveBeenCalledTimes(scans);
  });

  it.each([
    { axis: "x", coordinate: null },
    { axis: "x", coordinate: NaN },
    { axis: "x", coordinate: Infinity },
    { axis: "x", coordinate: -1 },
    { axis: "x", coordinate: 401 },
    { axis: "y", coordinate: null },
    { axis: "y", coordinate: NaN },
    { axis: "y", coordinate: -Infinity },
    { axis: "y", coordinate: -1 },
    { axis: "y", coordinate: 101 },
  ])(
    "hides points with $axis coordinate $coordinate",
    ({ axis, coordinate }) => {
      const f = fixture();
      if (axis === "x") f.state.x = () => coordinate;
      else f.state.y = () => coordinate;
      const primitive = attach(f);
      primitive.updateAllViews();
      expect(draw(primitive).labels).toEqual([]);
    },
  );

  it("hides only the unprojectable extremum and recovers on the next redraw without a scan", () => {
    const f = fixture();
    f.state.y = (price) => (price >= 100 ? null : 70);
    const primitive = attach(f);
    primitive.updateAllViews();
    const scans = f.series.dataByIndex.mock.calls.length;
    const labels = draw(primitive).labels;
    expect(labels).toHaveLength(1);
    expect(label(labels, "L").text).toMatch(/fmt\(80\.875\)/);
    f.state.y = (price) => (price >= 100 ? 30 : 70);
    primitive.updateAllViews();
    expect(draw(primitive).labels).toHaveLength(2);
    expect(f.series.dataByIndex).toHaveBeenCalledTimes(scans);
  });

  it("does not draw out-of-bounds text when a tiny pane cannot accommodate padding", () => {
    const f = fixture();
    f.state.width = 3;
    f.state.height = 3;
    f.state.x = () => 1;
    f.state.y = () => 1;
    const primitive = attach(f);
    primitive.updateAllViews();
    expect(draw(primitive, 3, 3).labels).toEqual([]);
  });

  it("isolates subscriptions, detaches idempotently, clears labels, and can reattach to a different series", () => {
    const f = fixture();
    const first = attach(f);
    const second = attach(f);
    first.updateAllViews();
    second.updateAllViews();
    expect(f.listeners.size).toBe(2);
    const handler = f.series.subscribeDataChanged.mock.calls[0][0];
    first.detached();
    first.detached();
    expect(f.series.unsubscribeDataChanged.mock.calls).toEqual([[handler]]);
    expect(f.listeners.size).toBe(1);
    expect(draw(first).labels).toEqual([]);
    expect(draw(second).labels).toHaveLength(2);
    f.chart.options.mockClear();
    f.series.dataByIndex.mockClear();
    f.requestUpdate.mockClear();
    first.updateAllViews();
    first.refreshTheme();
    expect(f.chart.options).not.toHaveBeenCalled();
    expect(f.series.dataByIndex).not.toHaveBeenCalled();
    expect(f.requestUpdate).not.toHaveBeenCalled();
    f.emit();
    expect(f.requestUpdate).toHaveBeenCalledOnce();
    const next = fixture([value(0, 42)], "Line");
    attach(next, first);
    first.updateAllViews();
    expect(label(draw(first).labels, "H").text).toMatch(/fmt\(42\)/);
    expect(next.series.subscribeDataChanged).toHaveBeenCalledOnce();
    second.detached();
    first.detached();
    expect(f.listeners.size).toBe(0);
    expect(next.listeners.size).toBe(0);
  });

  it("uses no timers or external observers and does not mutate ranges, autoscale, price data, or volume", () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    const animation = vi.fn();
    const observer = vi.fn();
    vi.stubGlobal("requestAnimationFrame", animation);
    vi.stubGlobal("MutationObserver", observer);
    vi.stubGlobal("ResizeObserver", observer);
    const f = fixture();
    const primitive = attach(f);
    primitive.updateAllViews();
    primitive.refreshTheme();
    f.emit();
    primitive.updateAllViews();
    draw(primitive);
    primitive.detached();
    for (const method of [
      timeout,
      interval,
      animation,
      observer,
      f.mutate,
      f.series.data,
      f.timeScale.subscribeVisibleLogicalRangeChange,
      f.volume.data,
      f.volume.dataByIndex,
      f.volume.subscribeDataChanged,
    ])
      expect(method).not.toHaveBeenCalled();
  });

  it("constructs multiple instances under the real development refresh transform", async () => {
    // Normal Vitest imports skip HMR; match the SessionLines regression harness.
    const require = createRequire(import.meta.url);
    const presetRequire = createRequire(require.resolve("@preact/preset-vite"));
    const prefresh = presetRequire("@prefresh/vite")();
    const esbuild = createRequire(require.resolve("vite"))("esbuild");
    const filename = new URL("../visibleExtrema.ts", import.meta.url);
    const transformed = await prefresh.transform.call(
      {
        resolve: (id: string) => ({ id: presetRequire.resolve(id) }),
      },
      readFileSync(filename, "utf8"),
      fileURLToPath(filename),
    );
    const compiled = esbuild.buildSync({
      stdin: {
        contents:
          typeof transformed === "string" ? transformed : transformed.code,
        loader: "ts",
        resolveDir: fileURLToPath(new URL(".", filename)),
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      define: { "import.meta.hot": "hot" },
    });
    const sandbox = {
      hot: { accept: vi.fn(), dispose: vi.fn() },
      module: { exports: {} as { VisibleExtrema: typeof VisibleExtrema } },
    };
    runInNewContext(
      "self = globalThis;\n" + compiled.outputFiles[0].text,
      sandbox,
    );
    const instances = Array.from(
      { length: 3 },
      () => new sandbox.module.exports.VisibleExtrema(),
    );
    expect(instances.map((instance) => instance.paneViews().length)).toEqual([
      1, 1, 1,
    ]);
  });
});
