import { PnlBreakdownCard } from "./PnlBreakdownCard";
import styles from "./overview.module.css";

interface Props {
    portfolioId?: string;
    baseCurrency: string;
}

export function Row3({ portfolioId, baseCurrency }: Props) {
    return (
        <div className={styles.row3}>
            <PnlBreakdownCard portfolioId={portfolioId} baseCurrency={baseCurrency} />
        </div>
    );
}
