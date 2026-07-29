export type CurrencyCode = "TRY" | "USD" | "EUR" | "GBP" | string;

export interface CurrencyConfig {
    code: CurrencyCode;
    symbol: string; // e.g. "₺", "$", "€", "£"
    position: "prefix" | "suffix"; // e.g. "$100" vs "100 ₺"
    space: boolean; // Space between number and symbol: "$100" vs "100 ₺"
}

const CURRENCY_MAP: Record<string, CurrencyConfig> = {
    TRY: { code: "TRY", symbol: "₺", position: "suffix", space: false },
    USD: { code: "USD", symbol: "$", position: "prefix", space: false },
    EUR: { code: "EUR", symbol: "€", position: "prefix", space: false },
    GBP: { code: "GBP", symbol: "£", position: "prefix", space: false },
};

/**
 * Resolves currency config from explicit currency code or symbol ticker fallback.
 */
export function resolveCurrency(
    currency?: string | null,
    symbol?: string | null,
): CurrencyConfig {
    if (currency && CURRENCY_MAP[currency.toUpperCase()]) {
        return CURRENCY_MAP[currency.toUpperCase()];
    }

    if (symbol) {
        const uppercase = symbol.toUpperCase();
        if (uppercase.endsWith(".IS")) return CURRENCY_MAP.TRY;
        if (uppercase.endsWith(".L")) return CURRENCY_MAP.GBP;
        if (
            uppercase.endsWith(".DE") ||
            uppercase.endsWith(".PA") ||
            uppercase.endsWith(".AS")
        ) {
            return CURRENCY_MAP.EUR;
        }
    }

    // Default to USD for US stocks / general fallback
    return CURRENCY_MAP.USD;
}

/**
 * Returns just the currency symbol (e.g. "₺", "$", "€", "£") for a asset/currency.
 */
export function getCurrencySymbol(
    symbolOrCurrency?: string | null,
    currency?: string | null,
): string {
    return resolveCurrency(currency, symbolOrCurrency).symbol;
}

export interface FormatCurrencyOptions {
    compact?: boolean;
    decimals?: number;
    currency?: string | null;
}

/**
 * Formats a monetary number with correct scale (K, M, B, T) and currency symbol.
 * Examples:
 * formatCurrency(360.5, "ASELS.IS") -> "360.50 ₺"
 * formatCurrency(1234500000, "ASELS.IS") -> "1.23B ₺"
 * formatCurrency(225.4, "AAPL") -> "$225.40"
 * formatCurrency(3420000000000, "AAPL") -> "$3.42T"
 */
export function formatCurrency(
    val: number | null | undefined,
    symbolOrCurrency?: string | null,
    options?: FormatCurrencyOptions,
): string {
    if (val == null || isNaN(val)) return "-";

    const config = resolveCurrency(options?.currency, symbolOrCurrency);
    const compact = options?.compact ?? Math.abs(val) >= 1_000_000;
    const decimals = options?.decimals ?? 2;

    let numberStr = "";
    const abs = Math.abs(val);

    if (compact) {
        if (abs >= 1_000_000_000_000) {
            numberStr = `${(val / 1_000_000_000_000).toFixed(decimals)}T`;
        } else if (abs >= 1_000_000_000) {
            numberStr = `${(val / 1_000_000_000).toFixed(decimals)}B`;
        } else if (abs >= 1_000_000) {
            numberStr = `${(val / 1_000_000).toFixed(decimals)}M`;
        } else if (abs >= 1_000) {
            numberStr = `${(val / 1_000).toFixed(decimals)}K`;
        } else {
            numberStr = val.toFixed(decimals);
        }
    } else {
        numberStr = new Intl.NumberFormat("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(val);
    }

    if (config.position === "prefix") {
        return `${config.symbol}${config.space ? " " : ""}${numberStr}`;
    }
    return `${numberStr}${config.space ? " " : ""}${config.symbol}`;
}
