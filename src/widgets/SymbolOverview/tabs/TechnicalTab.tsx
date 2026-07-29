import type { OverviewData, QuoteSnapshot } from "../../../services/types";
import { formatCurrency } from "../../../utils/currency";
import styles from "../SymbolOverview.module.css";

type Props = {
    quote: QuoteSnapshot | null;
    overview: OverviewData | null;
};

const NUM_FMT = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const PCT_FMT = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
});

export function TechnicalTab({ quote, overview }: Props) {
    const currentPrice = quote?.current_price;
    const low52 = overview?.fifty_two_week_low;
    const high52 = overview?.fifty_two_week_high;
    const symbol = quote?.symbol || overview?.symbol;
    const currency = quote?.currency || overview?.currency;

    let rangePct = 50;
    if (currentPrice != null && low52 != null && high52 != null && high52 > low52) {
        rangePct = Math.max(0, Math.min(100, ((currentPrice - low52) / (high52 - low52)) * 100));
    }

    const calcDiff = (ma: number | null | undefined) => {
        if (!currentPrice || !ma || ma === 0) return null;
        return ((currentPrice - ma) / ma) * 100;
    };

    const diff50d = calcDiff(overview?.fifty_day_average);
    const diff200d = calcDiff(overview?.two_hundred_day_average);

    return (
        <div className={styles.tabPadding}>
            {/* 52-Week Range Bar */}
            <div className={styles.rangeBox}>
                <div className={styles.rangeHeader}>
                    <span>52-Week Range</span>
                    <span>{formatCurrency(currentPrice, symbol, { currency, compact: false })}</span>
                </div>
                <div className={styles.rangeTrack}>
                    <div className={styles.rangeProgress} style={{ width: `${rangePct}%` }} />
                    <div className={styles.rangeThumb} style={{ left: `${rangePct}%` }} />
                </div>
                <div className={styles.rangeFooter}>
                    <span>Low: {low52 ? NUM_FMT.format(low52) : "-"}</span>
                    <span>High: {high52 ? NUM_FMT.format(high52) : "-"}</span>
                </div>
            </div>

            {/* Technical indicators grid */}
            <div className={styles.metricsGrid}>
                <div className={styles.metricCard}>
                    <div className={styles.metricLabel}>50-Day MA</div>
                    <div className={styles.metricValue}>
                        {formatCurrency(overview?.fifty_day_average, symbol, { currency, compact: false })}
                    </div>
                    {diff50d != null && (
                        <div
                            className={[
                                styles.metricSub,
                                diff50d >= 0 ? styles.bull : styles.bear,
                            ].join(" ")}
                        >
                            Dist. from Price: {PCT_FMT.format(diff50d)}%
                        </div>
                    )}
                </div>

                <div className={styles.metricCard}>
                    <div className={styles.metricLabel}>200-Day MA</div>
                    <div className={styles.metricValue}>
                        {formatCurrency(overview?.two_hundred_day_average, symbol, { currency, compact: false })}
                    </div>
                    {diff200d != null && (
                        <div
                            className={[
                                styles.metricSub,
                                diff200d >= 0 ? styles.bull : styles.bear,
                            ].join(" ")}
                        >
                            Dist. from Price: {PCT_FMT.format(diff200d)}%
                        </div>
                    )}
                </div>

                <div className={styles.metricCard}>
                    <div className={styles.metricLabel}>VWAP</div>
                    <div className={styles.metricValue}>
                        {formatCurrency(overview?.vwap, symbol, { currency, compact: false })}
                    </div>
                </div>

                <div className={styles.metricCard}>
                    <div className={styles.metricLabel}>Beta</div>
                    <div className={styles.metricValue}>
                        {overview?.beta != null ? overview.beta.toFixed(2) : "-"}
                    </div>
                </div>
            </div>
        </div>
    );
}
