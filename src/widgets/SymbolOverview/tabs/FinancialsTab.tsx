import type { OverviewData } from "../../../services/types";
import { formatCurrency } from "../../../utils/currency";
import styles from "../SymbolOverview.module.css";

type Props = {
    overview: OverviewData | null;
};

const NUM_FMT = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function formatShares(val: number | null | undefined): string {
    if (val == null) return "-";
    if (Math.abs(val) >= 1_000_000_000_000) return `${(val / 1_000_000_000_000).toFixed(2)}T Shares`;
    if (Math.abs(val) >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B Shares`;
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M Shares`;
    return `${NUM_FMT.format(val)} Shares`;
}

export function FinancialsTab({ overview }: Props) {
    const symbol = overview?.symbol;
    const currency = overview?.currency;

    const gridItems = [
        {
            label: "Market Cap",
            value: formatCurrency(overview?.market_cap, symbol, { currency, compact: true }),
        },
        { label: "P/E Ratio", value: overview?.pe_ratio ? NUM_FMT.format(overview.pe_ratio) : "-" },
        { label: "Forward P/E", value: overview?.forward_pe ? NUM_FMT.format(overview.forward_pe) : "-" },
        {
            label: "EPS",
            value: formatCurrency(overview?.eps, symbol, { currency, compact: false }),
        },
        {
            label: "Forward EPS",
            value: formatCurrency(overview?.forward_eps, symbol, { currency, compact: false }),
        },
        {
            label: "Dividend Yield",
            value: overview?.dividend_yield ? `${(overview.dividend_yield * 100).toFixed(2)}%` : "-",
        },
        {
            label: "Dividend Rate",
            value: formatCurrency(overview?.dividend_rate, symbol, { currency, compact: false }),
        },
        { label: "Shares Outstanding", value: formatShares(overview?.shares_outstanding) },
        { label: "Float Shares", value: formatShares(overview?.float_shares) },
    ];

    return (
        <div className={styles.tabPadding}>
            <div className={styles.metricsGrid}>
                {gridItems.map((item) => (
                    <div key={item.label} className={styles.metricCard}>
                        <div className={styles.metricLabel}>{item.label}</div>
                        <div className={styles.metricValue}>{item.value}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
