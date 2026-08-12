import { FxBadge } from "./FxBadge";
import styles from "./SymbolCell.module.css";

export interface SymbolCellProps {
    symbol: string;
    subtitle?: string;
    currency?: string;
    baseCurrency?: string;
    fxRate?: number;
    isHistoricFx?: boolean;
}

export function SymbolCell({
    symbol,
    subtitle,
    currency,
    baseCurrency,
    fxRate,
    isHistoricFx = false,
}: SymbolCellProps) {
    return (
        <div className={styles.container}>
            <div className={styles.title}>
                <span className={styles.symbol}>{symbol}</span>
                <FxBadge
                    currency={currency}
                    baseCurrency={baseCurrency}
                    fxRate={fxRate}
                    isHistoric={isHistoricFx}
                />
            </div>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
    );
}
