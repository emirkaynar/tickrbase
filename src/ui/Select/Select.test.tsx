// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookHarness, nodes } from "../Combobox/testHarness";
import { Select } from "./Select";

const state = vi.hoisted(() => ({ harness: null as ReturnType<typeof createHookHarness> | null }));
vi.mock("preact/hooks", async () => {
    const { createHookHarness } = await import("../Combobox/testHarness");
    state.harness = createHookHarness();
    return { ...state.harness.hooks, useId: () => "portal-generated-id" };
});
vi.mock("@ark-ui/react/select", () => ({
    createListCollection: (options: unknown) => options,
    Select: {
        Root: "select-root", Control: "select-control", Trigger: "select-trigger", ValueText: "select-value",
        Indicator: "select-indicator", Positioner: "select-positioner", Content: "select-content", Item: "select-item",
        ItemIndicator: "select-item-indicator", ItemText: "select-item-text", HiddenSelect: "select-hidden",
    },
}));
vi.mock("@ark-ui/react/portal", () => ({ Portal: "portal" }));
vi.mock("lucide-react", () => ({ CheckIcon: "check", ChevronsUpDownIcon: "chevrons", Lock: "lock" }));

beforeEach(() => state.harness!.reset());
const items = [{ label: "Free", value: "free" }, { label: "Snap to close", value: "close" }];
function render(id: string, triggerVariant: "default" | "icon" = "default") {
    return state.harness!.render(() => Select({ id, items, value: "close", triggerVariant }));
}
function part(tree: unknown, type: string) { return nodes(tree).find(node => node.type === type)!; }

// Structural regression guards; real Ark positioning still requires manual browser verification.
describe("Select instance positioning", () => {
    it.each(["default", "icon"] as const)("anchors the %s trigger directly and retains positioning across rerenders", triggerVariant => {
        const first = render("widget-one-crosshair", triggerVariant);
        const root = part(first, "select-root");
        const trigger = part(first, "select-trigger");
        const anchor = { getBoundingClientRect: vi.fn() };
        (trigger.ref as { current: unknown }).current = anchor;
        expect(root.props.id).toBe("widget-one-crosshair");
        expect(root.props.positioning).toMatchObject({ placement: "bottom-start", strategy: "fixed" });
        expect(root.props.positioning.getAnchorElement()).toBe(anchor);
        expect(part(render("widget-one-crosshair", triggerVariant), "select-root").props.positioning).toBe(root.props.positioning);
    });

    it("keeps widget instances distinct even when generated portal ids repeat", () => {
        const first = render("widget-one-crosshair");
        const firstAnchor = {};
        (part(first, "select-trigger").ref as { current: unknown }).current = firstAnchor;
        state.harness!.reset();
        const second = render("widget-two-crosshair");
        const secondAnchor = {};
        (part(second, "select-trigger").ref as { current: unknown }).current = secondAnchor;
        expect(part(first, "select-root").props.id).not.toBe(part(second, "select-root").props.id);
        expect(part(first, "select-root").props.positioning.getAnchorElement()).toBe(firstAnchor);
        expect(part(second, "select-root").props.positioning.getAnchorElement()).toBe(secondAnchor);
    });
});
