import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentChildren, VNode } from "preact";
import { Tooltip as ArkTooltip } from "@ark-ui/react/tooltip";
import { MarketPillTooltip } from "../components/MarketPillTooltip";

const harness = vi.hoisted(() => ({
    state: [] as boolean[], stateIndex: 0,
    refs: [] as Array<{ current: unknown }>, refIndex: 0,
    effect: undefined as (() => (() => void) | undefined) | undefined,
}));
vi.mock("preact/hooks", () => ({
    useState: (initial: boolean) => {
        const index = harness.stateIndex++;
        harness.state[index] ??= initial;
        return [harness.state[index], (value: boolean) => { harness.state[index] = value; }];
    },
    useRef: (initial: unknown) => {
        const index = harness.refIndex++;
        harness.refs[index] ??= { current: initial };
        return harness.refs[index];
    },
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: typeof harness.effect) => { harness.effect = effect; },
}));
vi.mock("@ark-ui/react/tooltip", () => ({ Tooltip: {
    Root: () => null, Trigger: () => null, Positioner: () => null, Content: () => null,
} }));
vi.mock("@ark-ui/react/portal", () => ({ Portal: () => null }));

function nodes(child: ComponentChildren): VNode<Record<string, unknown>>[] {
    if (Array.isArray(child)) return child.flatMap(nodes);
    if (!child || typeof child !== "object" || !("props" in child)) return [];
    const node = child as VNode<Record<string, unknown>>;
    return [node, ...nodes(node.props.children as ComponentChildren)];
}
function render() {
    harness.stateIndex = 0;
    harness.refIndex = 0;
    const tree = nodes(MarketPillTooltip({ content: "Market open", children: "Trigger" }));
    const root = tree.find(node => node.type === ArkTooltip.Root)!;
    const trigger = tree.find(node => node.type === ArkTooltip.Trigger)!;
    return {
        root: root.props, trigger: trigger.props,
        click: () => (trigger.props.onClick as () => void)(),
        requestOpen: (open: boolean) => (root.props.onOpenChange as (details: { open: boolean }) => void)({ open }),
    };
}

beforeEach(() => {
    harness.state = [];
    harness.refs = [];
    harness.effect = undefined;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("market pill tooltip (hook harness)", () => {
    it("supports normal hover/focus opening until pinned", () => {
        render().requestOpen(true);
        expect(render().root.open).toBe(true);
        render().requestOpen(false);
        expect(render().root.open).toBe(false);
    });

    it("pins on activation, ignores hover dismissal, and closes on a second activation", () => {
        render().click();
        const pinned = render();
        expect(pinned.root.open).toBe(true);
        expect(pinned.trigger["aria-pressed"]).toBe(true);
        expect(pinned.root.closeOnClick).toBe(false);
        expect(pinned.root.closeOnPointerDown).toBe(false);
        pinned.requestOpen(false);
        expect(render().root.open).toBe(true);
        render().click();
        expect(render().root.open).toBe(false);
        expect(render().trigger["aria-pressed"]).toBe(false);
    });

    it.each(["outside", "escape"])("dismisses a pinned tooltip on %s and cleans up listeners", method => {
        class TestNode { contains(target: unknown) { return target === this; } }
        vi.stubGlobal("Node", TestNode);
        const listeners = new Map<string, (event: { target?: unknown; key?: string }) => void>();
        const document = {
            addEventListener: vi.fn((type: string, listener: (event: { target?: unknown; key?: string }) => void) => listeners.set(type, listener)),
            removeEventListener: vi.fn(),
        };
        vi.stubGlobal("document", document);
        render().click();
        render();
        const trigger = new TestNode(), content = new TestNode();
        harness.refs[0].current = trigger;
        harness.refs[1].current = content;
        const cleanup = harness.effect!()!;
        listeners.get("pointerdown")!({ target: trigger });
        listeners.get("pointerdown")!({ target: content });
        expect(render().root.open).toBe(true);
        if (method === "escape") listeners.get("keydown")!({ key: "Escape" });
        else listeners.get("pointerdown")!({ target: new TestNode() });
        expect(render().root.open).toBe(false);
        expect(render().trigger["aria-pressed"]).toBe(false);
        cleanup();
        expect(document.removeEventListener).toHaveBeenCalledTimes(2);
    });
});
