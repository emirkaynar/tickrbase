import { memo, createPortal } from "preact/compat";

import { formatPercentChange, formatVolume } from "../../../utils";
import { useChartLegend } from "../hooks/useChartLegend";
import type { LegendSource } from "../hooks/useChartLegend";
import type { GraphicSettings } from "../settings/basicChartSettings";
import styles from "./ChartOverlay.module.css";

type Props = {
  source: LegendSource;
  settings: GraphicSettings;
  quoteChange: number | null;
  changeHost: HTMLSpanElement | null;
};

export const ChartLegendReadout = memo(function ChartLegendReadout({
  source,
  settings,
  quoteChange,
  changeHost,
}: Props) {
  const legend = useChartLegend(source);
  const bar = legend.bar;
  const directionClass =
    bar && Number.isFinite(bar.open) && Number.isFinite(bar.close)
      ? bar.close >= bar.open
        ? styles.barBull
        : styles.barBear
      : "";
  const valueClass = (value: number | null | undefined) =>
    `${styles.barValue} ${value != null && Number.isFinite(value) ? directionClass : ""}`;

  const barChange = settings.legendChange && legend.hovered;
  const percent = barChange ? legend.changePercent : quoteChange;

  const changeClass =
    percent === null || percent === 0
      ? styles.changeNeutral
      : percent > 0
        ? styles.changePositive
        : styles.changeNegative;
  return (
    <>
      {changeHost &&
        createPortal(
          <span class={`${changeClass} ${styles.changeSlot}`}>
            {percent !== null ? formatPercentChange(percent) : "—"}
          </span>,
          changeHost,
        )}
      {(settings.legendOHLC || settings.legendVolume) && (
        <div
          class={styles.barRegion}
          data-ohlc={settings.legendOHLC}
          role="group"
          aria-label="Bar information"
        >
          {settings.legendOHLC && (
            <span
              class={styles.ohlcGroup}
              aria-label={
                legend.heikinAshi ? "Heikin-Ashi calculated OHLC" : "Bar OHLC"
              }
            >
              {legend.heikinAshi && <span class={styles.haLabel}>HA</span>}
              {(["open", "high", "low", "close"] as const).map(
                (field, index) => (
                  <span key={field} class={styles.barField}>
                    <span class={styles.barLabel}>
                      {["O", "H", "L", "C"][index]}
                    </span>{" "}
                    <span class={valueClass(bar?.[field])}>
                      {legend.formatPrice(bar?.[field])}
                    </span>
                  </span>
                ),
              )}
            </span>
          )}
          {settings.legendVolume && (
            <span class={styles.barField}>
              <span class={styles.barLabel}>V</span>
              <span class={valueClass(legend.actual?.volume)}>
                {legend.actual?.volume != null &&
                Number.isFinite(legend.actual.volume)
                  ? legend.actual.volume === 0
                    ? "0"
                    : formatVolume(legend.actual.volume)
                  : "—"}
              </span>
            </span>
          )}
        </div>
      )}
    </>
  );
});
