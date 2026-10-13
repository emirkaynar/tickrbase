import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { createPortal } from "preact/compat";
import { ChartLegendReadout } from "./ChartLegendReadout";
import { livePricesClient } from "../../../services/livePrices";
import type { useChartData } from "../hooks/useChartData";
import type { ChartQuote } from "../hooks/useChartQuote";
import type { LegendSource } from "../hooks/useChartLegend";
import type { InstrumentIdentity } from "../hooks/useInstrumentIdentity";
import type { GraphicSettings } from "../settings/basicChartSettings";
import { marketCountdown, marketStatus, marketTooltip } from "../marketStatus";
import { MarketStatusOverlay } from "./MarketStatusOverlay";
import styles from "./ChartOverlay.module.css";

type Props = {
  symbol: string;
  identity: InstrumentIdentity;
  data: ReturnType<typeof useChartData>;
  quote: ChartQuote;
  warning: string;
  stripHost: HTMLDivElement | null;
  settings: GraphicSettings;
  legendSource: LegendSource;

  onCompactHeight: (height: number) => void;
};

export function ChartOverlay({
  symbol,
  identity,
  data,
  quote,
  warning,
  stripHost,
  settings,
  legendSource,

  onCompactHeight,
}: Props) {
  const compactRef = useRef<HTMLDivElement | null>(null);
  const [changeHost, setChangeHost] = useState<HTMLSpanElement | null>(null);
  const [now, setNow] = useState(() => livePricesClient.now());
  const [connection, setConnection] = useState(livePricesClient.getStatus());
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(livePricesClient.now()),
      1000,
    );
    const unsubscribe = livePricesClient.onStatus(setConnection);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, []);
  const ownData = data.dataSymbol === symbol;
  const context = ownData ? data.marketContext : null;
  const tick = data.lastTick?.symbol === symbol ? data.lastTick : null;
  const coverage = ownData ? data.coverage : null;
  const status = marketStatus(context, tick, coverage, now);
  const notices = [
    connection !== "open"
      ? connection === "error"
        ? "Connection error"
        : connection === "reconnecting"
          ? "Reconnecting"
          : connection === "connecting"
            ? "Connecting"
            : "Disconnected"
      : null,
    ownData ? warning || null : null,
  ].filter((notice): notice is string => Boolean(notice));
  const strip =
    settings.legendOHLC || settings.legendVolume || settings.legendChange;
  useLayoutEffect(() => {
    const element = compactRef.current;
    if (strip || !element) {
      onCompactHeight(0);
      return;
    }
    const measure = () =>
      onCompactHeight(element.offsetTop + element.offsetHeight + 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [strip, quote.ready, symbol, onCompactHeight]);

  // Reuse the leaf vnode on timer/status renders. Only its own selection state,
  // quote change, or relevant configuration updates render the readout.
  const fields = useMemo(
    () =>
      strip ? (
        <ChartLegendReadout
          source={legendSource}
          settings={settings}
          quoteChange={quote.changePercent}
          changeHost={changeHost}
        />
      ) : null,
    [strip, legendSource, settings, quote.changePercent, changeHost],
  );
  const overlay = (
    <MarketStatusOverlay
      key={symbol}
      // Portal roots can generate overlapping useId values before the app root has a counter.
      tooltipIdPrefix={`chart-overlay-${encodeURIComponent(legendSource.id)}`}
      symbol={symbol}
      name={identity.name}
      exchange={identity.exchange ?? context?.exchange ?? null}
      quote={quote}
      tooltip={marketTooltip(context, tick, coverage, now)}
      delayed={status.delayed}
      delaySeconds={status.delaySeconds}
      countdown={marketCountdown(context, status, now)}
      notices={notices}
      strip={strip}
      barInfo={fields}
      priceDecimals={
        strip
          ? legendSource.binding?.series.options().priceFormat.precision
          : undefined
      }
      compactRef={compactRef}
      changeInfo={
        strip ? (
          <span class={styles.changeHost} ref={setChangeHost} />
        ) : undefined
      }
    />
  );
  // Only the presenter moves. The information owner (and its timer) stays mounted.
  return strip
    ? stripHost
      ? createPortal(overlay, stripHost)
      : null
    : overlay;
}
