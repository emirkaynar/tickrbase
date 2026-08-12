import { formatCurrency } from "../../../utils";

interface Props {
    primaryValue: number;
    primaryCurrency: string; // base currency (always shown on top)
    nativeValue: number;
    nativeCurrency: string; // native asset currency (shown as subtitle)
    showSubtitle?: boolean; // driven by portfolio.showNativeSubtitles setting
    isPositive?: boolean; // optional P/L color override (true = bull, false = bear)
    bold?: boolean;
}

export function DualCurrencyCell({
    primaryValue,
    primaryCurrency,
    nativeValue,
    nativeCurrency,
    showSubtitle = true,
    isPositive,
    bold = false,
}: Props) {
    const isCross = primaryCurrency !== nativeCurrency;
    const renderSubtitle = showSubtitle && isCross;

    const colorStyle =
        isPositive !== undefined
            ? isPositive
                ? "var(--color-bull)"
                : "var(--color-bear)"
            : undefined;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                justifyContent: "center",
            }}
        >
            <span
                style={{
                    fontWeight: bold ? 600 : 400,
                    color: colorStyle,
                }}
            >
                {formatCurrency(primaryValue, primaryCurrency, {
                    currency: primaryCurrency,
                    compact: false
                })}
            </span>
            {renderSubtitle ? (
                <span
                    style={{
                        fontSize: "11px",
                        color: "var(--color-text-muted)",
                    }}
                >
                    {formatCurrency(nativeValue, nativeCurrency, {
                        currency: nativeCurrency,
                    })}
                </span>
            )
                : null}
        </div>
    );
}
