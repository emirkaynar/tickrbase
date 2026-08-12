import { usePortfolioHistory } from "../../../hooks/usePortfolioHistory";
import type { PortfolioOverviewResponse } from "../../../services/types";
import { Skeleton } from "../../../ui";
import { Row1 } from "./overview/Row1";
import { Row2 } from "./overview/Row2";
import { Row3 } from "./overview/Row3";
import layoutStyles from "./overview/overview.module.css";
import styles from "./OverviewTab.module.css";

interface OverviewTabProps {
    data: PortfolioOverviewResponse | null;
    loading: boolean;
    error: string;
    baseCurrency: string;
}

export function OverviewTab({
    data,
    loading,
    error,
    baseCurrency = "TRY",
}: OverviewTabProps) {
    const portfolioId = data?.portfolio?.id;

    const { points: histPoints, loading: histLoading } = usePortfolioHistory(
        portfolioId,
        "1d",
        "none",
    );

    if (loading) {
        return (
            <div className={layoutStyles.container}>
                <Skeleton height={120} width="100%" />
                <Skeleton height={320} width="100%" />
                <Skeleton height={240} width="100%" />
            </div>
        );
    }

    if (error) {
        return <div className={styles.error}>{error}</div>;
    }

    const positions = data?.positions || [];
    const effectiveBaseCurrency = data?.portfolio?.base_currency || baseCurrency;

    return (
        <div className={layoutStyles.container}>
            <Row1
                points={histPoints}
                positions={positions}
                histLoading={histLoading}
                posLoading={loading}
                baseCurrency={effectiveBaseCurrency}
            />
            <Row2
                positions={positions}
                loading={loading}
                baseCurrency={effectiveBaseCurrency}
            />
            <Row3
                portfolioId={portfolioId}
                baseCurrency={effectiveBaseCurrency}
            />
        </div>
    );
}
