import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VNode } from "preact";
import { BasicChart } from "../BasicChart";
import { useChartState } from "../hooks/useChartState";
import { useChartQuote } from "../hooks/useChartQuote";

vi.mock("preact/hooks", () => ({
    useRef: (current: unknown) => ({ current }),
    useEffect: () => {},
    useCallback: (callback: unknown) => callback,
}));
vi.mock("../hooks/useChartState", () => ({ useChartState: vi.fn() }));
vi.mock("../hooks/useChartQuote", () => ({ useChartQuote: vi.fn() }));
vi.mock("../hooks/useInstrumentIdentity", () => ({ useInstrumentIdentity: () => ({ name: "Apple", exchange: "NASDAQ" }) }));
vi.mock("../hooks/useExtendedPriceLabel", () => ({ useExtendedPriceLabel: () => {} }));
vi.mock("../../registry", () => ({ registerWidget: vi.fn() }));
vi.mock("../../../ui", () => ({ Select: () => null, TickerSelector: () => null, Tooltip: () => null, WidgetOptionsButton: () => null }));

const state = {
    symbol: "AAPL", interval: "1d", chartType: "candlestick", timezone: "UTC", status: "loading",
    errorMsg: "History unavailable", warning: "", stateReady: true,
    data: { lastTick: null }, setPrevClose: vi.fn(),
};
const quote = { price: 123, currency: "USD", changePercent: 1, snapshot: null, ready: true };

beforeEach(() => {
    vi.mocked(useChartState).mockReturnValue(state as unknown as ReturnType<typeof useChartState>);
    vi.mocked(useChartQuote).mockReturnValue(quote);
});

function composition() {
    const root = BasicChart({ id: "test", onRemove: vi.fn() }) as VNode<{
        warning: string;
        children: (overlay: null, options: null) => VNode<{ loading: boolean; error: string | null }>;
    }>;
    return { root, shell: root.props.children(null, null) };
}

describe("BasicChart summary and history loading", () => {
    it("does not cover a usable snapshot with the history loading overlay", () => {
        expect(composition().shell.props.loading).toBe(false);
    });

    it("keeps the initial skeleton until quote data is ready", () => {
        vi.mocked(useChartQuote).mockReturnValue({ ...quote, ready: false });
        expect(composition().shell.props.loading).toBe(true);
    });

    it("preserves a usable quote after history failure and exposes the error through details", () => {
        vi.mocked(useChartState).mockReturnValue({ ...state, status: "error" } as unknown as ReturnType<typeof useChartState>);
        const { root, shell } = composition();
        expect(shell.props.error).toBeNull();
        expect(root.props.warning).toBe("History unavailable");
    });

    it("retains the normal error overlay when no usable quote is available", () => {
        vi.mocked(useChartState).mockReturnValue({ ...state, status: "error" } as unknown as ReturnType<typeof useChartState>);
        vi.mocked(useChartQuote).mockReturnValue({ ...quote, ready: false });
        expect(composition().shell.props.error).toBe("History unavailable");
    });
});
