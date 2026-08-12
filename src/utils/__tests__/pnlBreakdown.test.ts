import { describe, expect, it } from "vitest";
import type { PositionResponse } from "../../services/types";
import { computeHistoricReturnBreakdown, computeReturnBreakdown, formatSignedPercent } from "../pnlBreakdown";

describe("pnlBreakdown math & formatting", () => {
    it("compounds stock and FX return percentage correctly", () => {
        const mockPos: PositionResponse = {
            id: "pos_1",
            portfolio_id: "port_1",
            ticker: "AAPL",
            asset_class: "Equity",
            sector: null,
            quantity: 10,
            avg_price: 3600, // $100 * 36 entry rate
            current_price: 4070, // $110 * 37 current rate
            market_value: 40700,
            total_cost: 36000,
            pnl: 4700,
            pnl_percent: 13.06,
            weight_percent: 10.0,
            target_weight_pct: null,
            tags: [],
            is_closed: false,
            currency: "USD",
            fx_rate_to_base: 37.0,
            avg_price_native: 100.0,
            current_price_native: 110.0,
            market_value_native: 1100.0,
            pnl_native: 100.0,
            pnl_percent_native: 10.0, // +10% stock return
            created_at: 0,
            updated_at: 0,
        };

        const breakdown = computeReturnBreakdown(mockPos, "TRY");

        // Stock Return: +10%
        expect(breakdown.stockReturnPct).toBeCloseTo(10.0, 2);
        // Entry rate: 3600 / 100 = 36.0
        expect(breakdown.entryFxRate).toBeCloseTo(36.0, 2);
        // FX Return %: (37 - 36) / 36 = +2.7777%
        expect(breakdown.fxReturnPct).toBeCloseTo(2.7777, 2);
        // Compounded Total Return %: (1 + 0.10) * (1 + 0.027777) - 1 = 13.0555%
        expect(breakdown.totalReturnPct).toBeCloseTo(13.0555, 2);
    });

    it("suppresses FX return for TRY-native holdings (same base currency)", () => {
        const mockPos: PositionResponse = {
            id: "pos_2",
            portfolio_id: "port_1",
            ticker: "THYAO.IS",
            asset_class: "Equity",
            sector: null,
            quantity: 100,
            avg_price: 300.0,
            current_price: 330.0,
            market_value: 33000.0,
            total_cost: 30000.0,
            pnl: 3000.0,
            pnl_percent: 10.0,
            weight_percent: 10.0,
            target_weight_pct: null,
            tags: [],
            is_closed: false,
            currency: "TRY",
            fx_rate_to_base: 1.0,
            avg_price_native: 300.0,
            current_price_native: 330.0,
            market_value_native: 33000.0,
            pnl_native: 3000.0,
            pnl_percent_native: 10.0,
            created_at: 0,
            updated_at: 0,
        };

        const breakdown = computeReturnBreakdown(mockPos, "TRY");

        expect(breakdown.isCrossCurrency).toBe(false);
        expect(breakdown.fxReturnBase).toBe(0);
        expect(breakdown.fxReturnPct).toBe(0);
    });

    it("formats signed percentage without doubled plus signs", () => {
        expect(formatSignedPercent(10.5)).toBe("+10.50%");
        expect(formatSignedPercent(-5.2)).toBe("-5.20%");
        expect(formatSignedPercent(0)).toBe("0.00%");
    });

    it("calculates historic realized breakdown for cross-currency SELL transactions", () => {
        const mockTx = {
            id: "tx_1",
            portfolio_id: "port_1",
            ticker: "AAPL",
            asset_class: "Equity",
            type: "SELL" as const,
            quantity: 10,
            unit_price: 110.0,
            fee: 0,
            tax: 0,
            currency: "USD",
            fx_rate_to_base: 37.5,
            buy_fx_rate: 34.25,
            realized_pnl: 100.0,
            realized_pnl_base: 3750.0,
            executed_at: 1000,
            notes: null,
            created_at: 1000,
            unit_price_base: 4125.0,
            total_cost_base: 41250.0,
        };

        const breakdown = computeHistoricReturnBreakdown(mockTx, "TRY");

        expect(breakdown.isCrossCurrency).toBe(true);
        expect(breakdown.entryFxRate).toBe(34.25);
        expect(breakdown.currentFxRate).toBe(37.5);
        expect(breakdown.stockReturnNative).toBe(100.0);
        expect(breakdown.stockReturnBase).toBe(3425.0);
        expect(breakdown.fxReturnBase).toBe(325.0);
        expect(breakdown.totalReturnBase).toBe(3750.0);
    });
});
