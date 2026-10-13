import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "preact/hooks";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import {
  applyChartScale,
  getInitialChartRange,
  setInitialChartRange,
} from "../chartConfig";
import { useWidgetState } from "../../settings/useWidgetState";
import { stateRecord } from "../../settings/widgetStateStore";

import type { WidgetSettingsProps } from "../../settings/types";
import {
  defaultWidgetSettings,
  isWidgetSettingValue,
  widgetSettingItems,
} from "../../settings/definitions";
import {
  graphicSettingsDefinition,
  resolveGraphicSettings,
} from "../settings/basicChartSettings";
import type { GraphicSettings } from "../settings/basicChartSettings";
import type {
  Bar,
  Interval,
  ScaleMode,
  MarketContext,
} from "../../../services/types";
import { INTERVALS } from "../../../services/types";

import type { ChartType } from "../../../services/types";
import { useUserTimezone } from "../../../services/useUserTimezone";
import { useChartData } from "./useChartData";
import { SessionLines } from "../sessionLines";
import { observationGaps, gapWhitespace } from "../observationGaps";
import { intervalSeconds } from "../barStore";
import {
  candleContext,
  regularBars,
  sessionBoundaries,
} from "../sessionPolicy";
import type { VolumePane } from "../volumePane";
import {
  getWidgetCacheToken,
  isWidgetCacheCurrent,
  registerWidgetCache,
} from "../../widgetCache";

/** Module-level maps survive RGL remount cycles during drag */
const everLoaded = registerWidgetCache("loadedCharts", new Set<string>());
const lastState = registerWidgetCache(
  "chartBars",
  new Map<string, { bars: Bar[]; interval: Interval; symbol: string }>(),
);

const getLastState = (id: string) => lastState.get(id);
// Delivered raw arrays are immutable snapshots. Share the exact full-history
// transformation between the series and readout; WeakMap does not retain history.
const heikinAshiCache = new WeakMap<readonly Bar[], Bar[]>();
export function calculateHeikinAshi(bars: readonly Bar[]): Bar[] {
  const cached = heikinAshiCache.get(bars);
  if (cached) return cached;
  if (!bars.length) return [];
  const result: Bar[] = [];
  let prevHaOpen = (bars[0].open + bars[0].close) / 2;
  let prevHaClose =
    (bars[0].open + bars[0].high + bars[0].low + bars[0].close) / 4;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = i === 0 ? prevHaOpen : (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    result.push({
      time: b.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
    });
    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }
  heikinAshiCache.set(bars, result);
  return result;
}

type ChartRefs = {
  chartRef: { current: IChartApi | null };
  seriesRef: { current: ISeriesApi<any> | null };
  intervalRef: { current: Interval };
  volumeRef: { current: VolumePane | null };
};

type UseChartStateReturn = {
  data: ReturnType<typeof useChartData>;
  status: "loading" | "ok" | "error";
  errorMsg: string;
  warning: string;
  symbol: string;
  interval: Interval;
  chartType: ChartType;
  timezone: string;
  scaleMode: ScaleMode;
  stateReady: boolean;
  settings: WidgetSettingsProps;
  graphicSettings: GraphicSettings;
  hasBars: boolean;

  refreshVolume: () => void;
  setSymbol: (s: string) => void;
  selectInterval: (i: Interval) => void;
  setChartType: (c: ChartType) => void;
  setScaleMode: (m: ScaleMode) => void;
  applyScaleFormatting: () => void;
  reapplyCurrentBars: () => void;
  initializeRange: () => void;
  resetView: () => void;
  isViewReady: () => boolean;
  viewResetRevision: number;
  setPrevClose: (val: number | null) => void;
  everLoadedRef: typeof everLoaded;
  getLastState: (
    id: string,
  ) => { bars: Bar[]; interval: Interval; symbol: string } | undefined;
};

export function useChartState(
  id: string,
  refs: ChartRefs,
): UseChartStateReturn {
  const { chartRef, seriesRef, intervalRef, volumeRef } = refs;

  const cacheToken = getWidgetCacheToken(id);
  const _prev = lastState.get(id);
  const contextRef = useRef<MarketContext | null>(null);
  const boundarySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const gapCountRef = useRef(-1);
  const boundaryTimesRef = useRef<number[]>([]);
  const primitiveRef = useRef<{
    series: ISeriesApi<any>;
    primitive: SessionLines;
  } | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const [viewResetRevision, setViewResetRevision] = useState(0);

  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [warning, setWarning] = useState("");
  const [barAvailability, setBarAvailability] = useState(() =>
    _prev
      ? {
          symbol: _prev.symbol,
          interval: _prev.interval,
          hasBars: _prev.bars.length > 0,
        }
      : null,
  );

  const persisted = useWidgetState(id);
  const saved = persisted.document;

  const symbol = saved.symbol || _prev?.symbol || "XU100.IS";
  const interval = INTERVALS.includes(saved.interval as Interval)
    ? (saved.interval as Interval)
    : (_prev?.interval ?? "1d");
  const savedChartType = saved.state.chartType;
  const chartType: ChartType = [
    "candlestick",
    "heikin_ashi",
    "line",
    "area",
    "bar",
    "baseline",
  ].includes(String(savedChartType))
    ? (savedChartType as ChartType)
    : "candlestick";
  const timezone = useUserTimezone();
  const savedScaleMode = stateRecord(saved.state.priceScale).mode;
  const scaleMode: ScaleMode =
    savedScaleMode === "percentage" || savedScaleMode === "logarithmic"
      ? savedScaleMode
      : "normal";
  // A failed preference load can still display data, but the owner blocks all writes until retry succeeds.
  const stateReady = persisted.ready || persisted.status === "error";
  const graphicSettings = useMemo(
    () => resolveGraphicSettings(stateRecord(saved.state.settings)),
    [saved.state.settings],
  );
  // A volume preference edit must not replace applyBars and restart the history effect.
  const fitAfterUpdateRef = useRef<() => void>(() => {});
  const volumeModeRef = useRef(graphicSettings.volume);
  volumeModeRef.current = graphicSettings.volume;
  const updateVolume = useCallback(
    (bars: readonly Bar[], live = false) => {
      if (!isWidgetCacheCurrent(id, cacheToken) || !volumeRef.current) return;
      volumeRef.current.update(bars, volumeModeRef.current, live);
      fitAfterUpdateRef.current();
    },
    [id, cacheToken, volumeRef],
  );
  const refreshVolume = useCallback(() => {
    const cached = lastState.get(id);
    updateVolume(
      cached?.symbol === symbol && cached.interval === interval
        ? cached.bars
        : [],
    );
  }, [id, symbol, interval, updateVolume]);
  useEffect(() => {
    refreshVolume();
  }, [graphicSettings.volume, refreshVolume]);
  // A new selection is an epoch, including A -> empty B -> A. Cached/tick
  // deliveries cannot complete it until a full-history delivery qualifies it.
  const viewRef = useRef({ symbol, interval, qualified: false, pending: true });
  if (
    viewRef.current.symbol !== symbol ||
    viewRef.current.interval !== interval
  ) {
    viewRef.current = { symbol, interval, qualified: false, pending: true };
  }
  const selectionEpoch = viewRef.current;
  const isViewReady = useCallback(() => !viewRef.current.pending, []);
  const initializeRange = useCallback(
    (attempt = 0) => {
      // If a very narrow scale clamps the range, leave it pending for resize/data
      // rather than spinning indefinitely. New updates start a fresh attempt.
      if (attempt > 2) return;
      const epoch = viewRef.current;
      const chart = chartRef.current;
      if (!epoch.pending || !epoch.qualified || !chart) return;
      if (fitFrameRef.current !== null)
        cancelAnimationFrame(fitFrameRef.current);
      // LWC queues logical ranges until draw. Apply after all price/boundary/volume
      // updates, then confirm after that draw rather than marking a request done.
      fitFrameRef.current = requestAnimationFrame(() => {
        fitFrameRef.current = null;
        if (viewRef.current !== epoch || chartRef.current !== chart) return;
        const series = seriesRef.current;
        const cached = lastState.get(id);
        if (
          !series ||
          cached?.symbol !== epoch.symbol ||
          cached.interval !== epoch.interval
        )
          return;
        if (!setInitialChartRange(chart, series)) return;
        fitFrameRef.current = requestAnimationFrame(() => {
          fitFrameRef.current = null;
          if (viewRef.current !== epoch || chartRef.current !== chart) return;
          if (seriesRef.current !== series) {
            initializeRange(attempt + 1);
            return;
          }
          const actual = chart.timeScale().getVisibleLogicalRange();
          const target = getInitialChartRange(chart, series);
          if (!actual || !target) return;
          if (
            Math.abs(actual.from - target.from) > 0.01 ||
            Math.abs(actual.to - target.to) > 0.01 ||
            !series.priceScale().options().autoScale
          ) {
            initializeRange(attempt + 1);
            return;
          }
          epoch.pending = false;
          setViewResetRevision((revision) => revision + 1);
        });
      });
    },
    [id, chartRef, seriesRef],
  );
  fitAfterUpdateRef.current = initializeRange;
  const resetView = useCallback(() => {
    // A button click during selection loading must not qualify provisional data.
    if (viewRef.current.pending) {
      initializeRange();
      return;
    }
    // Manual reset uses only the existing price series; no data refresh/reapply.
    viewRef.current.pending = true;
    viewRef.current.qualified = true;
    initializeRange();
  }, [initializeRange]);
  useEffect(
    () => () => {
      if (fitFrameRef.current !== null)
        cancelAnimationFrame(fitFrameRef.current);
    },
    [],
  );
  const setSymbol = useCallback(
    (symbol: string) =>
      persisted.update((document) => ({ ...document, symbol })),
    [persisted.update],
  );
  const selectInterval = useCallback(
    (interval: Interval) =>
      persisted.update((document) => ({ ...document, interval })),
    [persisted.update],
  );
  const setChartType = useCallback(
    (chartType: ChartType) =>
      persisted.update((document) => ({
        ...document,
        state: { ...document.state, chartType },
      })),
    [persisted.update],
  );
  const setScaleMode = useCallback(
    (mode: ScaleMode) => {
      persisted.update((document) => ({
        ...document,
        state: {
          ...document.state,
          priceScale: { ...stateRecord(document.state.priceScale), mode },
        },
      }));
    },
    [persisted.update],
  );
  const settings: WidgetSettingsProps = {
    definition: graphicSettingsDefinition,
    values: graphicSettings,
    ready: persisted.ready,
    status: persisted.status,
    error: persisted.error,
    onRetry: () => {
      void persisted.retry();
    },
    onChange: (key, value) => {
      const definition = widgetSettingItems(graphicSettingsDefinition).find(
        (item) => item.id === key,
      );
      if (!definition || !isWidgetSettingValue(definition, value)) return;
      persisted.update((document) => ({
        ...document,
        state: {
          ...document.state,
          settings: { ...stateRecord(document.state.settings), [key]: value },
        },
      }));
    },
    onReset: () =>
      persisted.update((document) => ({
        ...document,
        state: {
          ...document.state,
          settings: {
            ...stateRecord(document.state.settings),
            ...defaultWidgetSettings(graphicSettingsDefinition),
          },
        },
      })),
  };

  const chartTypeRef = useRef<ChartType>(chartType);
  const prevCloseRef = useRef<number | null>(null);
  const scaleModeRef = useRef(scaleMode);
  scaleModeRef.current = scaleMode;
  useEffect(() => {
    chartTypeRef.current = chartType;
  }, [chartType]);

  const applyScaleFormatting = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    applyChartScale(chart, seriesRef.current, scaleModeRef.current);
  }, [chartRef, seriesRef]);

  useEffect(() => {
    applyScaleFormatting();
  }, [scaleMode, applyScaleFormatting]);

  const setPrevClose = useCallback(
    (val: number | null) => {
      prevCloseRef.current = val;
      if (
        chartTypeRef.current === "baseline" &&
        seriesRef.current &&
        val !== null
      ) {
        seriesRef.current.applyOptions({
          baseValue: { type: "price", price: val },
        });
      }
    },
    [seriesRef],
  );

  function formatSeriesPoint(bar: Bar, type: ChartType): any {
    if (type === "line" || type === "area" || type === "baseline") {
      return { time: bar.time as UTCTimestamp, value: bar.close };
    }
    return {
      time: bar.time as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    };
  }

  function formatSeriesData(bars: Bar[], type: ChartType): any[] {
    if (type === "heikin_ashi") {
      const haBars = calculateHeikinAshi(bars);
      return haBars.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
    }
    return bars.map((b) => formatSeriesPoint(b, type));
  }

  const applyBars = useCallback(
    (
      bars: Bar[],
      fit: boolean,
      context: MarketContext | null = contextRef.current,
      live = false,
    ) => {
      if (
        !isWidgetCacheCurrent(id, cacheToken) ||
        viewRef.current !== selectionEpoch
      )
        return;
      // Cache delivery can precede chart creation on mount. Keep its qualification
      // so reapplyCurrentBars can fit without waiting for a network response.
      if (fit) viewRef.current.qualified = true;
      const series = seriesRef.current;
      if (!series) {
        contextRef.current = context;
        const cached = {
          bars:
            intervalSeconds(interval) !== null
              ? regularBars(bars, context)
              : bars,
          interval,
          symbol,
        };
        lastState.set(id, cached);
        setBarAvailability((previous) =>
          previous?.symbol === symbol &&
          previous.interval === interval &&
          previous.hasBars === Boolean(cached.bars.length)
            ? previous
            : { symbol, interval, hasBars: cached.bars.length > 0 },
        );
        return;
      }
      intervalRef.current = interval;
      const chart = chartRef.current;
      const range = chart?.timeScale().getVisibleRange();
      const logical = chart?.timeScale().getVisibleLogicalRange();
      const lastTime = series.data().at(-1)?.time;
      const lastIndex =
        lastTime === undefined
          ? null
          : chart?.timeScale().timeToIndex(lastTime);
      const nearLatest =
        !logical || lastIndex == null || logical.to >= lastIndex - 2;

      contextRef.current = context;
      const intraday = intervalSeconds(interval) !== null;
      if (intraday) bars = regularBars(bars, context);
      if (chart && !boundarySeriesRef.current) {
        boundarySeriesRef.current = chart.addSeries(LineSeries, {
          visible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        });
      }
      if (primitiveRef.current?.series !== series) {
        const primitive = new SessionLines();
        series.attachPrimitive(primitive);
        primitiveRef.current = { series, primitive };
      }
      const gaps = observationGaps(bars, interval, candleContext(context));
      const gapChanged = gapCountRef.current !== gaps.length;
      gapCountRef.current = gaps.length;
      primitiveRef.current.primitive.setContext(
        intraday ? context : null,
        gaps,
        bars.at(-1)?.time ?? null,
      );
      const boundaries = intraday ? sessionBoundaries(bars, context) : [];
      const boundariesChanged =
        boundaries.length !== boundaryTimesRef.current.length ||
        boundaries.some(
          (time, index) => time !== boundaryTimesRef.current[index],
        );
      boundaryTimesRef.current = boundaries;
      if (!live || gapChanged || boundariesChanged)
        boundarySeriesRef.current?.setData(
          [
            ...new Set([
              ...boundaries,
              ...gapWhitespace(gaps, interval),
              ...gaps.map((gap) => gap.end),
            ]),
          ]
            .sort((a, b) => a - b)
            .map((time) => ({ time: time as UTCTimestamp })),
        );
      if (
        live &&
        !gapChanged &&
        chartTypeRef.current !== "heikin_ashi" &&
        bars.length &&
        series.data().length
      ) {
        series.update(
          formatSeriesPoint(bars[bars.length - 1], chartTypeRef.current),
        );
      } else {
        const points = formatSeriesData(bars, chartTypeRef.current);
        if (["line", "area", "baseline"].includes(chartTypeRef.current)) {
          // Per-point colors govern the segment leaving that point.
          // Hide the segment crossing an observed gap without inventing prices.
          for (let i = 0; i < bars.length - 1; i++) {
            if (
              gaps.some(
                (gap) =>
                  gap.start >= bars[i].time && gap.end <= bars[i + 1].time,
              )
            ) {
              Object.assign(points[i], {
                color: "transparent",
                lineColor: "transparent",
                topColor: "transparent",
                bottomColor: "transparent",
                topLineColor: "transparent",
                bottomLineColor: "transparent",
                topFillColor1: "transparent",
                topFillColor2: "transparent",
                bottomFillColor1: "transparent",
                bottomFillColor2: "transparent",
              });
            }
          }
        }
        series.setData(points);
      }
      if (chartTypeRef.current === "baseline" && bars.length) {
        const basePrice =
          prevCloseRef.current ??
          (bars.length > 1 ? bars[bars.length - 2].close : bars[0].close);
        series.applyOptions({
          baseValue: { type: "price", price: basePrice },
        });
      }
      updateVolume(bars, live);
      chartRef.current?.timeScale().applyOptions({
        timeVisible: !["1d", "1wk", "1mo"].includes(interval),
        secondsVisible: false,
      });
      if (chart && !viewRef.current.pending && !fit && range && !nearLatest) {
        chart.timeScale().setVisibleRange(range);
      }
      const cached = { bars, interval, symbol };
      lastState.set(id, cached);
      setBarAvailability((previous) =>
        previous?.symbol === symbol &&
        previous.interval === interval &&
        previous.hasBars === Boolean(bars.length)
          ? previous
          : { symbol, interval, hasBars: bars.length > 0 },
      );
      if (bars.length) initializeRange();

      everLoaded.add(id);
      setStatus("ok");
    },
    [
      id,
      symbol,
      interval,
      chartRef,
      seriesRef,
      intervalRef,
      cacheToken,
      selectionEpoch,
      initializeRange,
      updateVolume,
    ],
  );

  const reapplyCurrentBars = useCallback(() => {
    const state = lastState.get(id);
    if (state && state.symbol === symbol && state.interval === interval) {
      applyBars(state.bars, false);
    } else {
      applyBars([], false, null);
    }
  }, [id, symbol, interval, applyBars]);

  const onDataStatus = useCallback(
    (next: "loading" | "ok" | "error", message?: string) => {
      setStatus(next);
      setErrorMsg(message ?? "");
    },
    [],
  );
  const data = useChartData(
    id,
    symbol,
    interval,
    stateReady,
    applyBars,
    onDataStatus,
    setWarning,
  );

  return {
    data,
    status,
    errorMsg,
    warning,
    symbol,
    interval,
    chartType,
    timezone,
    scaleMode,
    stateReady,
    settings,
    graphicSettings,
    hasBars:
      barAvailability?.symbol === symbol &&
      barAvailability.interval === interval &&
      barAvailability.hasBars,

    refreshVolume,
    setSymbol,
    selectInterval,
    setChartType,
    setScaleMode,
    applyScaleFormatting,
    reapplyCurrentBars,
    initializeRange,
    resetView,
    isViewReady,
    viewResetRevision,
    setPrevClose,
    everLoadedRef: everLoaded,
    getLastState,
  };
}
