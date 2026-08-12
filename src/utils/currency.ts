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
    INR: { code: "INR", symbol: "₹", position: "prefix", space: false },
    CNY: { code: "CNY", symbol: "¥", position: "prefix", space: false },
    CAD: { code: "CAD", symbol: "$", position: "prefix", space: false },
    JPY: { code: "JPY", symbol: "¥", position: "prefix", space: false },
    AUD: { code: "AUD", symbol: "$", position: "prefix", space: false },
    CHF: { code: "CHF", symbol: "CHF", position: "suffix", space: true },
    SEK: { code: "SEK", symbol: "kr", position: "suffix", space: true },
    NOK: { code: "NOK", symbol: "kr", position: "suffix", space: true },
    DKK: { code: "DKK", symbol: "kr.", position: "suffix", space: true },
    HKD: { code: "HKD", symbol: "HK$", position: "prefix", space: false },
};

export const ALL_CURRENCY_OPTIONS = [
    { label: "TRY (₺)", value: "TRY" },
    { label: "USD ($)", value: "USD" },
    { label: "EUR (€)", value: "EUR" },
    { label: "GBP (£)", value: "GBP" },
    { label: "INR (₹)", value: "INR" },
    { label: "CNY (¥)", value: "CNY" },
    { label: "CAD ($)", value: "CAD" },
    { label: "JPY (¥)", value: "JPY" },
    { label: "AUD ($)", value: "AUD" },
];

/**
 * Resolves currency config from explicit currency code or symbol ticker fallback.
 */
export function resolveCurrency(
    currency?: string | null,
    symbol?: string | null,
): CurrencyConfig {
    if (currency) {
        const key = currency.toUpperCase().trim();
        if (CURRENCY_MAP[key]) return CURRENCY_MAP[key];
    }

    if (symbol) {
        const uppercase = symbol.toUpperCase().trim();
        if (CURRENCY_MAP[uppercase]) return CURRENCY_MAP[uppercase];

        if (uppercase.endsWith(".IS")) return CURRENCY_MAP.TRY;
        if (uppercase.endsWith(".L")) return CURRENCY_MAP.GBP;
        if (
            uppercase.endsWith(".DE") ||
            uppercase.endsWith(".PA") ||
            uppercase.endsWith(".AS") ||
            uppercase.endsWith(".MI") ||
            uppercase.endsWith(".BR") ||
            uppercase.endsWith(".MC")
        ) {
            return CURRENCY_MAP.EUR;
        }
        if (uppercase.endsWith(".NS") || uppercase.endsWith(".BO")) return CURRENCY_MAP.INR;
        if (uppercase.endsWith(".SS") || uppercase.endsWith(".SZ")) return CURRENCY_MAP.CNY;
        if (uppercase.endsWith(".HK")) return CURRENCY_MAP.HKD;
        if (uppercase.endsWith(".TO") || uppercase.endsWith(".V")) return CURRENCY_MAP.CAD;
        if (uppercase.endsWith(".T")) return CURRENCY_MAP.JPY;
        if (uppercase.endsWith(".AX")) return CURRENCY_MAP.AUD;
        if (uppercase.endsWith(".SW")) return CURRENCY_MAP.CHF;
        if (uppercase.endsWith(".ST")) return CURRENCY_MAP.SEK;
        if (uppercase.endsWith(".OL")) return CURRENCY_MAP.NOK;
        if (uppercase.endsWith(".CO")) return CURRENCY_MAP.DKK;
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
    const isNegative = val < 0;
    const abs = Math.abs(val);
    const compact = options?.compact ?? abs >= 1_000_000;
    const decimals = options?.decimals ?? 2;

    let numberStr = "";

    if (compact) {
        if (abs >= 1_000_000_000_000) {
            numberStr = `${(abs / 1_000_000_000_000).toFixed(decimals)}T`;
        } else if (abs >= 1_000_000_000) {
            numberStr = `${(abs / 1_000_000_000).toFixed(decimals)}B`;
        } else if (abs >= 1_000_000) {
            numberStr = `${(abs / 1_000_000).toFixed(decimals)}M`;
        } else if (abs >= 1_000) {
            numberStr = `${(abs / 1_000).toFixed(decimals)}K`;
        } else {
            numberStr = abs.toFixed(decimals);
        }
    } else {
        numberStr = new Intl.NumberFormat("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(abs);
    }

    const sign = isNegative ? "-" : "";
    const space = config.space ? " " : "";

    if (config.position === "prefix") {
        return `${sign}${config.symbol}${space}${numberStr}`;
    }
    return `${sign}${numberStr}${space}${config.symbol}`;
}

export type FxRates = Record<string, number>; // e.g. { "USD_TRY": 38.5 }

/**
 * Converts an amount from one currency to another using a pre-fetched rates map.
 * The key format is "FROM_TO" (e.g. "USD_TRY").
 * Returns the original amount unchanged if no rate is found.
 */
export function convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    rates: FxRates,
): number {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    if (from === to) return amount;
    const rate = rates[`${from}_${to}`] ?? rates[`${to}_${from}`];
    if (!rate) return amount;
    return rates[`${from}_${to}`] != null ? amount * rate : amount / rate;
}

/**
 * Returns true if two currency codes differ (case-insensitive).
 */
export function isCrossCurrency(a: string, b: string): boolean {
    return a.toUpperCase() !== b.toUpperCase();
}
