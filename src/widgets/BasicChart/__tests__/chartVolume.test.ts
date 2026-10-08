// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "preact/hooks";
import type { Bar, MarketContext } from "../../../services/types";
import type { VolumeMode, VolumePane } from "../volumePane";
import type { WidgetStateDocument } from "../../settings/widgetStateStore";
import { useWidgetState } from "../../settings/useWidgetState";
import {
  activateWidgetCache,
  clearWidgetCaches,
  removeWidgetCaches,
} from "../../widgetCache";
import { useChartData } from "../hooks/useChartData";
import { useChartState } from "../hooks/useChartState";

type Slot = { value?: any; deps?: unknown[]; cleanup?: (() => void) | void };
const hooks = vi.hoisted(() => ({
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as Array<() => void>,
}));
vi.mock("preact/hooks", () => {
  const slot = () =>
    hooks.slots[hooks.cursor++] ?? (hooks.slots[hooks.cursor - 1] = {});
  const changed = (old: unknown[] | undefined, next: unknown[]) =>
    !old ||
    old.length !== next.length ||
    next.some((value, i) => !Object.is(value, old[i]));
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const current = slot();
    if (changed(current.deps, deps)) {
      current.value = factory();
      current.deps = deps;
    }
    return current.value;
  };
  return {
    useRef: (initial: unknown) => {
      const current = slot();
      return (current.value ??= { current: initial });
    },
    useState: (initial: unknown) => {
      const current = slot();
      current.value ??= [
        initial,
        (value: unknown) => {
          current.value[0] = value;
        },
      ];
      return current.value;
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: unknown[]) =>
      memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const current = slot();
      if (changed(current.deps, deps)) {
        current.deps = deps;
        hooks.effects.push(() => {
          current.cleanup?.();
          current.cleanup = effect();
        });
      }
    },
  };
});
vi.mock("../../settings/useWidgetState", () => ({ useWidgetState: vi.fn() }));
vi.mock("../../../services/useUserTimezone", () => ({
  useUserTimezone: () => "UTC",
}));
vi.mock("../hooks/useChartData", () => ({ useChartData: vi.fn() }));

type ApplyBars = Parameters<typeof useChartData>[4];
const widgets = new Map<string, ReturnType<typeof fixture>>();
function fixture(id = "volume", volume: VolumeMode = "off") {
  activateWidgetCache(id);
  const slots: Slot[] = [];
  const update = vi.fn<VolumePane["update"]>((bars, mode) =>
    mode === "off"
      ? "off"
      : bars.some((bar) => (bar.volume ?? 0) > 0)
        ? "shown"
        : "empty",
  );
  const series = {
    data: () => [],
    setData: vi.fn(),
    applyOptions: vi.fn(),
    attachPrimitive: vi.fn(),
  };
  const refs = {
    chartRef: { current: null },
    seriesRef: { current: series },
    intervalRef: { current: "1d" },
    volumeRef: { current: { update } },
  } as unknown as Parameters<typeof useChartState>[1];
  const persisted = {
    document: {
      symbol: "AAPL",
      interval: "1d",
      state: { settings: { volume } },
    } as WidgetStateDocument,
    ready: true,
    status: "ready" as const,
    error: null,
    retry: vi.fn(),
    update: vi.fn(
      (edit: (document: WidgetStateDocument) => WidgetStateDocument) => {
        persisted.document = edit(persisted.document);
      },
    ),
  };
  const widget = {
    slots,
    refs,
    update,
    series,
    persisted,
    onBars: null as ApplyBars | null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    render() {
      hooks.slots = slots;
      hooks.cursor = 0;
      const result = useChartState(id, refs);
      for (const effect of hooks.effects.splice(0)) effect();
      return result;
    },
  };
  widgets.set(id, widget);
  return widget;
}
const bars: Bar[] = [
  { time: 100, open: 10, high: 30, low: 8, close: 9, volume: 50 },
];

beforeEach(() => {
  clearWidgetCaches();
  widgets.clear();
  vi.clearAllMocks();
  vi.mocked(useWidgetState).mockImplementation(
    (id) => widgets.get(id)!.persisted,
  );
  vi.mocked(useChartData).mockImplementation(
    (id, symbol, interval, ready, onBars, onStatus, onWarning) => {
      const widget = widgets.get(id)!;
      widget.onBars = onBars;
      // Mirror the real history effect's dependencies without fetching or subscribing to prices.
      useEffect(() => {
        widget.subscribe();
        return () => {
          widget.unsubscribe();
        };
      }, [id, symbol, interval, ready, onBars, onStatus, onWarning]);
      return {
        dataSymbol: symbol,
        marketContext: null,
        coverage: null,
        source: "fixture",
        lastTick: null,
        historyStale: false,
        historyUpdated: null,
        refresh: vi.fn(),
      };
    },
  );
});
afterEach(() => {
  for (const widget of widgets.values())
    for (const slot of widget.slots) slot.cleanup?.();
  hooks.effects.length = 0;
  clearWidgetCaches();
});

describe("useChartState volume integration (Node hook harness)", () => {
  it("switches and resets cached volume immediately without replacing applyBars or restarting history", () => {
    const widget = fixture();
    let state = widget.render();
    const applyBars = widget.onBars!;
    applyBars(bars, true, null, false);
    expect(widget.update).toHaveBeenLastCalledWith(bars, "off", false);
    for (const mode of ["overlay", "pane", "off", "pane", "overlay"] as const) {
      widget.update.mockClear();
      state.settings.onChange("volume", mode);
      state = widget.render();
      expect(widget.update.mock.calls).toEqual([[bars, mode, false]]);
      expect(state.graphicSettings.volume).toBe(mode);
      expect(widget.persisted.document.state.settings).toMatchObject({
        volume: mode,
      });

      expect(widget.onBars).toBe(applyBars);
    }
    state.settings.onReset();
    widget.render();
    expect(widget.update).toHaveBeenLastCalledWith(bars, "overlay", false);

    expect(widget.onBars).toBe(applyBars);
    expect(widget.subscribe).toHaveBeenCalledTimes(1);
    expect(widget.unsubscribe).not.toHaveBeenCalled();
    expect(widget.series.setData).toHaveBeenCalledTimes(1);
  });

  it.each(["overlay", "pane"] as const)(
    "uses session-filtered raw OHLC for Heikin-Ashi %s volume, forwards live, and forces a full refresh",
    (mode) => {
      const widget = fixture("raw", mode);
      widget.persisted.document.interval = "1h";
      widget.persisted.document.state.chartType = "heikin_ashi";
      let state = widget.render();
      const context = {
        ticker: "AAPL",
        exchange: "XNAS",
        instrument_type: "EQUITY",
        sessions: [
          {
            trading_date: "1970-01-01",
            regular_open: 100,
            regular_close: 200,
            windows: [],
          },
        ],
      } as unknown as MarketContext;
      const input = [
        { ...bars[0], time: 50 },
        ...bars,
        { ...bars[0], time: 200 },
      ];
      widget.onBars!(input, true, context, false);
      expect(widget.update).toHaveBeenLastCalledWith(bars, mode, false);
      expect(widget.series.setData).toHaveBeenLastCalledWith([
        { time: 100, open: 9.5, high: 30, low: 8, close: 14.25 },
      ]);
      widget.onBars!(input, false, context, true);
      expect(widget.update).toHaveBeenLastCalledWith(bars, mode, true);
      const pane = widget.refs.volumeRef.current;
      state.setChartType("line");
      state = widget.render();
      state.reapplyCurrentBars();
      expect(widget.series.setData).toHaveBeenLastCalledWith([
        { time: 100, value: 9 },
      ]);
      expect(widget.refs.volumeRef.current).toBe(pane);
      widget.update.mockClear();
      state.refreshVolume();
      expect(widget.update.mock.calls).toEqual([[bars, mode, false]]);
    },
  );

  it.each(["symbol", "interval"] as const)(
    "clears old volume when %s ownership changes",
    (field) => {
      const widget = fixture("owner", "overlay");
      widget.render();
      widget.onBars!(bars, true, null, false);
      widget.persisted.document = {
        ...widget.persisted.document,
        [field]: field === "symbol" ? "MSFT" : "1h",
      };
      widget.render();
      expect(widget.update).toHaveBeenLastCalledWith([], "overlay", false);
    },
  );

  it("keeps widget preferences and cached bars independent", () => {
    const first = fixture("first");
    const second = fixture("second", "pane");
    first.render();
    second.render();
    first.onBars!(bars, true, null, false);
    const otherBars = [{ ...bars[0], volume: 90 }];
    second.onBars!(otherBars, true, null, false);
    second.update.mockClear();
    first.render().settings.onChange("volume", "overlay");
    first.render();
    expect(first.update).toHaveBeenLastCalledWith(bars, "overlay", false);
    expect(second.update).not.toHaveBeenCalled();
    second.render().refreshVolume();
    expect(second.update).toHaveBeenLastCalledWith(otherBars, "pane", false);
    expect(second.persisted.update).not.toHaveBeenCalled();
  });

  it("rejects late bars and volume refreshes from an evicted widget lifetime", () => {
    const widget = fixture("evicted", "overlay");
    const state = widget.render();
    const lateBars = widget.onBars!;
    removeWidgetCaches("evicted");
    activateWidgetCache("evicted");
    widget.update.mockClear();
    lateBars(bars, false, null, true);
    state.refreshVolume();
    expect(widget.update).not.toHaveBeenCalled();
    expect(widget.series.setData).not.toHaveBeenCalled();
    expect(state.getLastState("evicted")).toBeUndefined();
  });
});
