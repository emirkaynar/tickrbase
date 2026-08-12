import type { PositionResponse, TransactionResponse } from "../services/types";
import { formatPercent, isCrossCurrency } from "./";

export interface ReturnBreakdownData {
    symbol: string;
    quantity: number;
    nativeCurrency: string;
    baseCurrency: string;
    entryFxRate: number;
    currentFxRate: number;
    isCrossCurrency: boolean;

    stockReturnNative: number;
    stockReturnBase: number;
    stockReturnPct: number;

    fxReturnBase: number;
    fxReturnPct: number;

    totalReturnNative: number;
    totalReturnBase: number;
    totalReturnPct: number;
}

export function formatSignedPercent(value: number | null | undefined): string {
    if (value == null || isNaN(value)) return "-";
    const formatted = formatPercent(value, { signDisplay: "exceptZero" });
    if (formatted.startsWith("++")) {
        return formatted.slice(1);
    }
    return formatted;
}

export function computeReturnBreakdown(
    pos: PositionResponse,
    baseCurrency: string,
): ReturnBreakdownData {
    const symbol = pos.ticker || "";
    const quantity = pos.quantity || 0;
    const nativeCurrency = pos.currency || "USD";
    const cross = isCrossCurrency(nativeCurrency, baseCurrency);

    const currentFxRate = pos.fx_rate_to_base || 1.0;
    const avgPriceBase = pos.avg_price || 0;
    const avgPriceNative =
        pos.avg_price_native ||
        (currentFxRate > 0 ? avgPriceBase / currentFxRate : avgPriceBase);

    // Entry FX rate at historical execution (WAC)
    const entryFxRate =
        avgPriceNative > 0 ? avgPriceBase / avgPriceNative : currentFxRate;

    // Stock Return (Asset price movement)
    const stockReturnNative = pos.pnl_native ?? pos.pnl ?? 0;
    const stockReturnPct = pos.pnl_percent_native ?? pos.pnl_percent ?? 0;
    const stockReturnBase = stockReturnNative * entryFxRate;

    // FX Return (Currency movement)
    let fxReturnPct = 0;
    let fxReturnBase = 0;

    if (cross && entryFxRate > 0) {
        fxReturnPct = ((currentFxRate - entryFxRate) / entryFxRate) * 100;
        fxReturnBase =
            (pos.market_value_native ?? 0) * (currentFxRate - entryFxRate);
    }

    // Total Return (Compounded for cross-currency)
    const totalReturnNative = stockReturnNative;
    const totalReturnBase = pos.pnl ?? 0;

    let totalReturnPct = pos.pnl_percent ?? 0;
    if (cross && !isNaN(stockReturnPct) && !isNaN(fxReturnPct)) {
        const sFactor = 1 + (stockReturnPct || 0) / 100;
        const fFactor = 1 + (fxReturnPct || 0) / 100;
        totalReturnPct = (sFactor * fFactor - 1) * 100;
    }

    if (isNaN(totalReturnPct) || !isFinite(totalReturnPct)) {
        totalReturnPct = pos.pnl_percent ?? 0;
    }

    return {
        symbol,
        quantity,
        nativeCurrency,
        baseCurrency,
        entryFxRate,
        currentFxRate,
        isCrossCurrency: cross,
        stockReturnNative,
        stockReturnBase,
        stockReturnPct,
        fxReturnBase,
        fxReturnPct,
        totalReturnNative,
        totalReturnBase,
        totalReturnPct,
    };
}

export function computeHistoricReturnBreakdown(
    tx: TransactionResponse,
    baseCurrency: string,
): ReturnBreakdownData {
    const symbol = tx.ticker || "";
    const quantity = tx.quantity || 0;
    const nativeCurrency = tx.currency || "USD";
    const cross = isCrossCurrency(nativeCurrency, baseCurrency);

    const sellFxRate = tx.fx_rate_to_base || 1.0;
    const buyFxRate = tx.buy_fx_rate || sellFxRate;

    const totalReturnNative = tx.realized_pnl ?? 0;
    const totalReturnBase = tx.realized_pnl_base ?? 0;

    const stockReturnNative = totalReturnNative;
    const stockReturnBase = stockReturnNative * buyFxRate;

    let fxReturnBase = 0;
    let fxReturnPct = 0;
    let stockReturnPct = 0;

    if (cross && buyFxRate > 0) {
        fxReturnBase = totalReturnBase - stockReturnBase;
        fxReturnPct = ((sellFxRate - buyFxRate) / buyFxRate) * 100;
    }

    const netProceedsNative = tx.unit_price * quantity - tx.fee - tx.tax;
    const costBasisNative = netProceedsNative - stockReturnNative;
    if (costBasisNative > 0) {
        stockReturnPct = (stockReturnNative / costBasisNative) * 100;
    }

    let totalReturnPct = 0;
    if (cross) {
        const sFactor = 1 + stockReturnPct / 100;
        const fFactor = 1 + fxReturnPct / 100;
        totalReturnPct = (sFactor * fFactor - 1) * 100;
    } else {
        totalReturnPct = stockReturnPct;
    }

    if (isNaN(totalReturnPct) || !isFinite(totalReturnPct)) {
        totalReturnPct = 0;
    }

    return {
        symbol,
        quantity,
        nativeCurrency,
        baseCurrency,
        entryFxRate: buyFxRate,
        currentFxRate: sellFxRate,
        isCrossCurrency: cross,
        stockReturnNative,
        stockReturnBase,
        stockReturnPct,
        fxReturnBase,
        fxReturnPct,
        totalReturnNative,
        totalReturnBase,
        totalReturnPct,
    };
}
