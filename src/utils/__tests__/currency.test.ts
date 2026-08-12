import { describe, expect, it } from "vitest";
import { formatCurrency } from "../currency";

describe("formatCurrency formatting", () => {
    it("formats negative prefix currencies correctly with minus preceding symbol", () => {
        expect(formatCurrency(-107.14, "USD")).toBe("-$107.14");
        expect(formatCurrency(-50, "EUR")).toBe("-€50.00");
        expect(formatCurrency(-1250, "GBP")).toBe("-£1,250.00");
    });

    it("formats negative suffix currencies correctly", () => {
        expect(formatCurrency(-4961.16, "TRY")).toBe("-4,961.16₺");
    });

    it("formats positive currencies without minus sign", () => {
        expect(formatCurrency(107.14, "USD")).toBe("$107.14");
        expect(formatCurrency(4961.16, "TRY")).toBe("4,961.16₺");
    });

    it("formats compact negative numbers cleanly", () => {
        expect(formatCurrency(-1500000, "USD", { compact: true })).toBe("-$1.50M");
    });
});
