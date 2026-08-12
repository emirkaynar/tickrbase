import { useMemo, useState } from "preact/hooks";
import { usePortfolioHistory } from "../../../../hooks/usePortfolioHistory";
import {
    BENCHMARK_OPTIONS,
    DEFAULT_BENCHMARK,
    type BenchmarkTicker,
} from "../../../../services/types";
import { PnlChart, Select, Skeleton } from "../../../../ui";
import {
    decimatePoints,
    getEffectiveInterval,
    type ChartInterval,
} from "../../../../utils/chartHelpers";
import styles from "./overview.module.css";

interface Props {
    portfolioId?: string;
    baseCurrency: string;
}

export function PnlBreakdownCard({ portfolioId, baseCurrency: _baseCurrency }: Props) {
    const [requestedInterval, setRequestedInterval] = useState<ChartInterval>("1d");
    const [benchmark, setBenchmark] = useState<BenchmarkTicker>(DEFAULT_BENCHMARK);

    const { points, loading, error } = usePortfolioHistory(
        portfolioId,
        requestedInterval,
        benchmark,
    );

    const effectiveInterval = useMemo(
        () => getEffectiveInterval(points, requestedInterval),
        [points, requestedInterval],
    );

    const displayPoints = useMemo(
        () => decimatePoints(points, effectiveInterval),
        [points, effectiveInterval],
    );

    const activeBenchOption = useMemo(
        () => BENCHMARK_OPTIONS.find((b) => b.ticker === benchmark),
        [benchmark],
    );

    const selectItems = useMemo(
        () =>
            BENCHMARK_OPTIONS.map((opt) => ({
                value: opt.ticker,
                label: opt.label,
            })),
        [],
    );

    return (
        <div className={styles.card}>
            <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Realized & Period Return Breakdown</h3>
                <div className={styles.controlsGroup}>
                    <div className={styles.btnGroup}>
                        {(
                            [
                                { key: "1d", label: "Day" },
                                { key: "1wk", label: "Week" },
                                { key: "1mo", label: "Month" },
                                { key: "1y", label: "Year" },
                            ] as const
                        ).map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                className={[
                                    styles.controlBtn,
                                    effectiveInterval === item.key ? styles.controlBtnActive : "",
                                ].join(" ")}
                                onClick={() => setRequestedInterval(item.key)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <div style={{ width: "130px" }}>
                        <Select
                            items={selectItems}
                            value={benchmark}
                            onChange={(val) => setBenchmark(val as BenchmarkTicker)}
                        />
                    </div>
                </div>
            </div>

            <div className={styles.chartHeight}>
                {loading ? (
                    <Skeleton height="100%" width="100%" />
                ) : error ? (
                    <div className={styles.xrayPlaceholder}>{error}</div>
                ) : displayPoints.length === 0 ? (
                    <div className={styles.xrayPlaceholder}>
                        Not enough portfolio history to display P&L breakdown.
                    </div>
                ) : (
                    <PnlChart
                        points={displayPoints}
                        benchmarkLabel={activeBenchOption?.label ?? "Benchmark"}
                    />
                )}
            </div>
        </div>
    );
}
