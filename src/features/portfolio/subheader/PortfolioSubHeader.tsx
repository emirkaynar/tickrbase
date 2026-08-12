import { Plus, RotateCw } from "lucide-react";
import { Button, Select, Skeleton } from "../../../ui";
import type { PortfolioKPIs } from "../../../services/types";
import { formatCurrency, formatPercentChange } from "../../../utils";
import styles from "./PortfolioSubHeader.module.css";

interface PortfolioSubHeaderProps {
    baseCurrency: string;
    kpis: PortfolioKPIs | null;
    loading: boolean;
    pnlPeriod: string;
    onPnlPeriodChange: (period: string) => void;
    onRefresh: () => void;
    onOpenTradeModal: () => void;
}

const PNL_PERIOD_OPTIONS = [
    { label: "Today", value: "daily" },
    { label: "This Week", value: "weekly" },
    { label: "This Month", value: "monthly" },
    { label: "All Time", value: "all" },
];

export function PortfolioSubHeader({
    baseCurrency,
    kpis,
    loading,
    pnlPeriod,
    onPnlPeriodChange,
    onRefresh,
    onOpenTradeModal,
}: PortfolioSubHeaderProps) {
    const isPositive = (kpis?.unrealized_pnl ?? 0) >= 0;
    const pnlFormatted = kpis
        ? `${formatCurrency(kpis.unrealized_pnl, baseCurrency, {
              currency: baseCurrency,
          })} (${formatPercentChange(kpis.unrealized_pnl_percent, { showArrow: false })})`
        : "-";

    return (
        <div className={styles.subHeader}>
            {/* Net Worth & P/L on Left */}
            <div className={styles.leftGroup}>
                <div className={styles.metricsBox}>
                    {loading || !kpis ? (
                        <Skeleton height={28} width={180} />
                    ) : (
                        <span className={styles.netWorthValue}>
                            {formatCurrency(
                                kpis.total_net_worth,
                                baseCurrency,
                                {
                                    currency: baseCurrency,
                                    compact: false,
                                },
                            )}
                        </span>
                    )}

                    <div className={styles.pnlRow}>
                        {loading || !kpis ? (
                            <Skeleton height={22} width={240} />
                        ) : (
                            <>
                                <span
                                    className={
                                        isPositive
                                            ? styles.positive
                                            : styles.negative
                                    }
                                >
                                    {pnlFormatted}
                                </span>
                                <Select
                                    items={PNL_PERIOD_OPTIONS}
                                    value={pnlPeriod}
                                    onChange={onPnlPeriodChange}
                                />
                            </>
                        )}
                    </div>

                </div>
            </div>

            {/* Actions on Right */}
            <div className={styles.rightActions}>
                <Button variant="solid" size="sm" onClick={onOpenTradeModal}>
                    <Plus size={14} /> Add Trade
                </Button>
                <Button variant="ghost" size="sm" onClick={onRefresh}>
                    <RotateCw size={14} /> Refresh
                </Button>
            </div>
        </div>
    );
}
