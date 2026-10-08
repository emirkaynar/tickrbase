import { describe, expect, it, vi } from "vitest";
import type { ComponentChildren, VNode } from "preact";
import { MarketStatusOverlay } from "../components/MarketStatusOverlay";
import type { ChartQuote } from "../hooks/useChartQuote";
import type { MarketContext } from "../../../services/types";
import { marketCountdown, marketStatus, marketTooltip } from "../marketStatus";
import type { MarketCountdown, MarketTooltip } from "../marketStatus";

vi.mock("../../../ui", () => ({ Tooltip: ({ children }: { children: ComponentChildren }) => children }));

function nodes(child: ComponentChildren): VNode<Record<string, unknown>>[] {
    if (Array.isArray(child)) return child.flatMap(nodes);
    if (!child || typeof child !== "object" || !("props" in child)) return [];
    const node = child as VNode<Record<string, unknown>>;
    return [node, ...nodes(node.props.children as ComponentChildren)];
}

const quote: ChartQuote = { price: 123.45, currency: "TRY", changePercent: 1.24, snapshot: null, ready: true };
const tooltip: MarketTooltip = { title: "Market open · 15m delayed", timing: "Closes in 2h 14m", range: "Regular session: 10:00–18:00", timezone: "Exchange time · Europe/Istanbul", session: "regular", known: true };
const props = { symbol: "ASELS.IS", name: "Aselsan Elektronik", exchange: "BIST", quote, tooltip, countdown: null as MarketCountdown | null, delayed: true, delaySeconds: 900 as number | null, notices: [] as string[] };

function rendered(overrides: Partial<typeof props> = {}) {
    return nodes(MarketStatusOverlay({ ...props, ...overrides }));
}

const hasText = (tree: VNode<Record<string, unknown>>[], text: string) => tree.some(node => node.props.children === text);

describe("market summary presentation", () => {
    it("hides the entire summary until a usable snapshot or accepted tick is ready", () => {
        expect(MarketStatusOverlay({ ...props, quote: { ...quote, ready: false } })).toBeNull();
    });

    it("keeps the long name, exchange and formatted quote without duplicate currency", () => {
        const tree = rendered({ name: "ASELSAN ELEKTRONIK" });
        expect(hasText(tree, "aselsan elektronik")).toBe(true);
        expect(hasText(tree, "TRY")).toBe(false);
        expect(hasText(tree, "▲ 1.24%")).toBe(true);
        expect(hasText(tree, "123.45₺")).toBe(true);
        expect(tree.some(node => Array.isArray(node.props.children) && node.props.children.includes("BIST"))).toBe(true);
    });

    it("uses an accessible session button and the D marker for known delay", () => {
        const tree = rendered();
        const pill = tree.find(node => node.type === "button" && node.props["data-session"] === "regular");
        expect(pill?.props["aria-label"]).toBe(tooltip.title);
        expect(pill?.props["aria-haspopup"]).toBeUndefined();
        expect(pill?.props["aria-controls"]).toBeUndefined();
        expect(hasText(tree, "D")).toBe(true);
        expect(pill?.props.onClick).toBeUndefined();
        const tooltipTrigger = tree.find(node => node.props.content && typeof node.props.content === "object");
        expect(nodes(tooltipTrigger?.props.children as ComponentChildren).some(node => node === pill)).toBe(true);
    });

    it("omits D for non-delayed data and exposes session timing in the tooltip", () => {
        const tree = rendered({ delayed: false });
        expect(hasText(tree, "D")).toBe(false);
        // Tooltip content is a prop rather than a child of the summary.
        const content = tree.find(node => node.props.content && typeof node.props.content === "object")?.props.content as ComponentChildren;
        expect(hasText(nodes(content), tooltip.timing!)).toBe(true);
    });

    it("keeps usable name and price visible without an authoritative unknown-session pill", () => {
        const tree = rendered({ tooltip: { ...tooltip, session: null, known: false } });
        expect(hasText(tree, "aselsan elektronik")).toBe(true);
        expect(tree.some(node => node.props["data-session"])).toBe(false);
    });

    it("combines warnings, the session dot and D in a single accessible pill", () => {
        const tree = rendered({ notices: ["Reconnecting"] });
        const buttons = tree.filter(node => node.type === "button");
        expect(buttons).toHaveLength(1);
        expect(buttons[0].props["aria-label"]).toBe(`${tooltip.title}; Data warnings: Reconnecting`);
        expect(buttons[0].props["data-session"]).toBe("regular");
        expect(hasText(nodes(buttons[0]), "D")).toBe(true);
        const content = tree.find(node => hasText(nodes(node.props.content as ComponentChildren), "Connection issue"))?.props.content as ComponentChildren;
        expect(hasText(nodes(content), "Reconnecting")).toBe(true);
    });

    it("shows a warning-only pill when the session cannot be verified", () => {
        const tree = rendered({ tooltip: { ...tooltip, session: null, known: false }, notices: ["Connection error"] });
        const buttons = tree.filter(node => node.type === "button");
        expect(buttons).toHaveLength(1);
        expect(buttons[0].props["aria-label"]).toBe("Data warnings: Connection error");
        expect(buttons[0].props["data-session"]).toBeUndefined();
    });

    it.each([
        [false, false, false], [false, false, true], [false, true, false], [false, true, true],
        [true, false, false], [true, false, true], [true, true, false], [true, true, true],
    ])("handles countdown=%s, delay=%s and warning=%s in one pill", (showCountdown, delayed, warning) => {
        const countdown = showCountdown ? { text: "4m to close", label: "Market closes in 4 minutes", duration: "4m", time: 1000, nextSession: "closed" as const } : null;
        const tree = rendered({ countdown, delayed, notices: warning ? ["Reconnecting"] : [] });
        const buttons = tree.filter(node => node.type === "button");
        expect(buttons).toHaveLength(1);
        expect(buttons[0].props["data-dot-only"]).toBe(!showCountdown && !delayed && !warning);
        expect(hasText(tree, "4m to close")).toBe(showCountdown);
        expect(hasText(tree, "D")).toBe(delayed);
        expect(buttons[0].props["aria-label"]).toBe([
            tooltip.title, countdown?.label, warning ? "Data warnings: Reconnecting" : null,
        ].filter(Boolean).join("; "));
        const countdownIndex = tree.findIndex(node => node.props.children === "4m to close");
        const delayIndex = tree.findIndex(node => node.props.children === "D");
        if (showCountdown && delayed) expect(delayIndex).toBeLessThan(countdownIndex);
        if (showCountdown) expect(tree[countdownIndex].props["data-next-session"]).toBe("closed");
        const pillTooltips = tree.filter(node => node.props.content && typeof node.props.content === "object");
        expect(pillTooltips).toHaveLength(1);
        expect(nodes(pillTooltips[0].props.children as ComponentChildren).filter(node => node.props.content)).toHaveLength(0);
        const content = nodes(pillTooltips[0].props.content as ComponentChildren);
        expect(hasText(content, "Market open")).toBe(true);
        expect(hasText(content, "15m delayed")).toBe(delayed);
        expect(hasText(content, "Closes in 4m")).toBe(showCountdown);
        expect(hasText(content, "Reconnecting")).toBe(warning);
        expect(content.some(node => node.props["data-next-session"] === "closed")).toBe(false);
    });

    it("explains unknown quote delay without implying real-time data", () => {
        const tree = rendered({ delayed: false, delaySeconds: null });
        const content = tree.find(node => node.props.content && typeof node.props.content === "object")?.props.content as ComponentChildren;
        expect(hasText(nodes(content), "Delay unknown")).toBe(true);
        expect(hasText(tree, "D")).toBe(false);
    });

    it("does not invent session or delay rows in a warning-only tooltip", () => {
        const tree = rendered({ tooltip: { ...tooltip, session: null, known: false }, notices: ["Connection error"] });
        const content = tree.find(node => node.props.content && typeof node.props.content === "object")?.props.content as ComponentChildren;
        expect(hasText(nodes(content), "Connection error")).toBe(true);
        expect(hasText(nodes(content), "Market open")).toBe(false);
        expect(hasText(nodes(content), "Delay")).toBe(false);
    });

    it("groups a regular opening under pre-market without a duplicate upcoming row", () => {
        const tree = rendered({
            tooltip: { ...tooltip, session: "pre" },
            countdown: { text: "4m to open", label: "Market opens in 4 minutes", duration: "4m", time: 1000, nextSession: "regular" },
        });
        const content = nodes(tree.find(node => node.props.content && typeof node.props.content === "object")?.props.content as ComponentChildren);
        expect(hasText(content, "Pre-market")).toBe(true);
        expect(hasText(content, "Market opens in 4m")).toBe(true);
        expect(content.some(node => node.props["data-next-session"])).toBe(false);
    });

    it("groups the next regular opening under Market closed", () => {
        const tree = rendered({
            tooltip: { ...tooltip, session: "closed" }, delayed: false,
            countdown: { text: "4m to open", label: "Market opens in 4 minutes", duration: "4m", time: 1000, nextSession: "regular" },
        });
        const content = nodes(tree.find(node => node.props.content && typeof node.props.content === "object")?.props.content as ComponentChildren);
        expect(hasText(content, "Market closed")).toBe(true);
        expect(hasText(content, "Opens in 4m")).toBe(true);
        expect(content.some(node => node.props["data-next-session"])).toBe(false);
    });

    it.each([
        ["2026-10-08T23:56:00Z", "post", "overnight"],
        ["2026-10-09T07:56:00Z", "overnight", "pre"],
    ] as const)("groups verified transitions at %s, including overnight", (iso, current, next) => {
        const seconds = (date: string) => Date.parse(date) / 1000;
        const context: MarketContext = {
            ticker: "TEST", exchange: "XNYS", exchange_timezone: "America/New_York", instrument_type: "EQUITY", server_time: 0,
            calendar_coverage: { from: seconds("2026-10-08T00:00:00Z"), to: seconds("2026-10-10T00:00:00Z") },
            sessions: [{ trading_date: "2026-10-08", regular_open: seconds("2026-10-08T13:30:00Z"), regular_close: seconds("2026-10-08T20:00:00Z"), windows: [
                { kind: "post", start: seconds("2026-10-08T20:00:00Z"), end: seconds("2026-10-09T00:00:00Z") },
                { kind: "overnight", start: seconds("2026-10-09T00:00:00Z"), end: seconds("2026-10-09T08:00:00Z") },
                { kind: "pre", start: seconds("2026-10-09T08:00:00Z"), end: seconds("2026-10-09T13:30:00Z") },
            ] }],
        };
        const now = Date.parse(iso);
        const status = marketStatus(context, null, null, now);
        const tree = rendered({ tooltip: marketTooltip(context, null, null, now), countdown: marketCountdown(context, status, now), delayed: false, delaySeconds: null });
        const content = nodes(tree.find(node => node.props.content && typeof node.props.content === "object")?.props.content as ComponentChildren);
        expect(content.some(node => node.props["data-session"] === current)).toBe(true);
        expect(content.some(node => node.props["data-next-session"] === next)).toBe(true);
        expect(hasText(content, "Ends in 4m")).toBe(true);
        expect(hasText(content, "Starts in 4m")).toBe(true);
        expect(hasText(content, "Overnight session")).toBe(true);
        if (current === "overnight") expect(hasText(content, "Overnight session: Oct 8, 2026, 20:00–Oct 9, 2026, 04:00")).toBe(false);
    });

    it("keeps session range and timezone out of the pill tooltip", () => {
        const tree = rendered();
        const content = nodes(tree.find(node => node.props.content && typeof node.props.content === "object")?.props.content as ComponentChildren);
        expect(hasText(content, tooltip.range!)).toBe(false);
        expect(hasText(content, tooltip.timezone!)).toBe(false);
        expect(hasText(content, tooltip.timing!)).toBe(true);
    });

    it("shows an honest unavailable-quote label rather than inventing a price", () => {
        expect(hasText(rendered({ quote: { ...quote, price: null, changePercent: null } }), "Quote unavailable")).toBe(true);
    });
});
