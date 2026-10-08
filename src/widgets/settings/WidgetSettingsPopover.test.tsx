// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookHarness, nodes, text } from "../../ui/Combobox/testHarness";
import { Select } from "../../ui/Select/Select";
import { Switch } from "../../ui/Switch/Switch";
import { WidgetOptionsButton } from "../../ui/WidgetActions/WidgetActions";
import { WidgetRemoveButton } from "../../ui";
import { Shell } from "../Shell";
import type { WidgetSettingsProps } from "./types";
import { WidgetSettingsPopover } from "./WidgetSettingsPopover";

const state = vi.hoisted(() => ({ harness: null as ReturnType<typeof createHookHarness> | null }));
vi.mock("preact/hooks", async () => {
    const { createHookHarness } = await import("../../ui/Combobox/testHarness");
    state.harness = createHookHarness();
    return { ...state.harness.hooks, useId: () => "shell-fallback" };
});
vi.mock("@ark-ui/react/popover", () => ({ Popover: { Root: "popover-root", Trigger: "popover-trigger", Positioner: "popover-positioner", Content: "popover-content", Title: "popover-title" } }));
vi.mock("@ark-ui/react/tabs", () => ({ Tabs: { Root: "tabs-root", List: "tabs-list", Trigger: "tabs-trigger", Content: "tabs-content" } }));
vi.mock("@ark-ui/react/portal", () => ({ Portal: "portal" }));
vi.mock("../../ui", () => ({ Skeleton: () => null, WidgetRemoveButton: () => null }));
vi.mock("../../ui/WidgetActions/WidgetActions", () => ({ WidgetOptionsButton: () => null, WidgetRemoveButton: () => null }));
vi.mock("../../ui/Select/Select", () => ({ Select: () => null }));
vi.mock("../../ui/Switch/Switch", () => ({ Switch: () => null }));

function props(overrides: Partial<WidgetSettingsProps> = {}): WidgetSettingsProps & { id: string } {
    return {
        id: "chart-1",
        definition: {
            title: "Chart options",
            tabs: [{ id: "graphic", label: "Graphic", groups: [
                { id: "price", label: "Price", settings: [{ id: "scale", label: "Scale", description: "Price scale mode", type: "select", defaultValue: "linear", options: [{ label: "Linear", value: "linear" }, { label: "Logarithmic", value: "log" }] }] },
                { id: "display", label: "Display", settings: [{ id: "grid", label: "Grid", type: "boolean", defaultValue: true }] },
            ] }],
        },
        values: {}, onChange: vi.fn(), onReset: vi.fn(), ready: true,
        status: "ready", error: null, onRetry: vi.fn(), ...overrides,
    };
}
const render = (input = props()) => state.harness!.render(() => WidgetSettingsPopover(input));
const part = (tree: unknown, type: string) => nodes(tree).find(node => node.type === type)!;
const button = (tree: unknown, label: string) => nodes(tree).find(node => node.type === "button" && text(node) === label)!;

beforeEach(() => { vi.clearAllMocks(); state.harness!.reset(); });

// Structural contract tests only: real Ark positioning, layering, and focus need browser coverage.
describe("WidgetSettingsPopover", () => {
    it("hides the whole options UI when there are no settings", () => {
        expect(render(props({ definition: { title: "Empty", tabs: [] } }))).toBeNull();
        expect(render(props({ definition: { title: "Empty", tabs: [{ id: "graphic", label: "Graphic", groups: [{ id: "empty", label: "Empty", settings: [] }] }] } }))).toBeNull();
    });

    it("renders the title, single tab strip, groups, and controls in definition order", () => {
        const tree = render();
        expect(text(part(tree, "popover-title"))).toBe("Chart options");
        expect(text(part(tree, "tabs-list"))).toBe("Graphic");
        expect(nodes(tree).filter(node => node.type === "h3").map(text)).toEqual(["Price", "Display"]);
        expect(nodes(tree).filter(node => node.type === Select || node.type === Switch).map(node => node.type)).toEqual([Select, Switch]);
        expect(text(tree)).not.toMatch(/Debug|Details/);
    });

    it("preserves multiple tab order and changes the active tab", () => {
        const input = props();
        input.definition.tabs.push({ id: "other", label: "Other", groups: [] });
        const tree = render(input);
        expect(nodes(tree).filter(node => node.type === "tabs-trigger").map(text)).toEqual(["Graphic", "Other"]);
        part(tree, "tabs-root").props.onValueChange({ value: "other" });
        expect(part(render(input), "tabs-root").props.value).toBe("other");
    });

    it("uses supplied values, defaults, accessible labels, and immediate callbacks", () => {
        const input = props({ values: { scale: "log", grid: false } });
        const tree = render(input);
        const select = nodes(tree).find(node => node.type === Select)!;
        const toggle = nodes(tree).find(node => node.type === Switch)!;
        expect(select.props.value).toBe("log");
        expect(select.props.variant).toBe("preferences");
        expect(select.props.id).toBe("widget-settings-chart-1-graphic-price-scale-select");
        expect(toggle.props.checked).toBe(false);
        expect(toggle.props.id).toBe("widget-settings-chart-1-graphic-display-grid-switch");
        for (const control of [select, toggle]) {
            const label = nodes(tree).find(node => node.props.id === control.props["aria-labelledby"]);
            expect(text(label)).toBe(control === select ? "Scale" : "Grid");
        }
        expect(text(nodes(tree).find(node => node.props.id === select.props["aria-describedby"]))).toBe("Price scale mode");
        select.props.onChange("linear");
        toggle.props.onChange(true);
        expect(input.onChange).toHaveBeenNthCalledWith(1, "scale", "linear");
        expect(input.onChange).toHaveBeenNthCalledWith(2, "grid", true);
        const defaults = render(props());
        expect(nodes(defaults).find(node => node.type === Select)!.props.value).toBe("linear");
        expect(nodes(defaults).find(node => node.type === Switch)!.props.checked).toBe(true);
    });

    it("namespaces nested select and switch machines by widget and setting", () => {
        const first = render({ ...props(), id: "first-widget" });
        const firstControls = nodes(first).filter(node => node.type === Select || node.type === Switch);
        state.harness!.reset();
        const second = render({ ...props(), id: "second-widget" });
        const secondControls = nodes(second).filter(node => node.type === Select || node.type === Switch);
        for (let index = 0; index < firstControls.length; index++) {
            expect(firstControls[index].props.id).not.toBe(secondControls[index].props.id);
            expect(firstControls[index].props.id).toContain("first-widget");
            expect(secondControls[index].props.id).toContain("second-widget");
        }
    });

    it("disables controls and reset until ready, without synthesizing reset changes", () => {
        const input = props({ ready: false, status: "loading" });
        const tree = render(input);
        expect(nodes(tree).filter(node => node.type === Select || node.type === Switch).every(node => node.props.disabled)).toBe(true);
        expect(button(tree, "Reset").props.disabled).toBe(true);
        const ready = render({ ...input, ready: true, status: "ready" });
        button(ready, "Reset").props.onClick();
        expect(input.onReset).toHaveBeenCalledOnce();
        expect(input.onChange).not.toHaveBeenCalled();
    });

    it("announces saving unobtrusively and exposes errors with retry", () => {
        const saving = render(props({ status: "saving" }));
        expect(text(nodes(saving).find(node => node.props.role === "status"))).toBe("Saving…");
        expect(button(saving, "Reset").props.disabled).toBe(false);
        const input = props({ ready: false, status: "error", error: "Unable to save preferences" });
        const failed = render(input);
        expect(text(nodes(failed).find(node => node.props.role === "alert"))).toContain(input.error);
        expect(button(failed, "Retry").props.disabled).not.toBe(true);
        button(failed, "Retry").props.onClick();
        expect(input.onRetry).toHaveBeenCalledOnce();
    });

    it("retains memoized fixed positioning with an explicit button anchor across reopening", () => {
        const input = props();
        const first = render(input);
        const root = part(first, "popover-root");
        const positioning = root.props.positioning;
        expect(positioning).toMatchObject({ placement: "bottom-end", strategy: "fixed" });
        expect(positioning.getAnchorElement()).toBeNull();
        const options = nodes(first).find(node => node.type === WidgetOptionsButton)!;
        const anchor = { focus: vi.fn() };
        (options.ref as { current: unknown }).current = anchor;
        expect(positioning.getAnchorElement()).toBe(anchor);
        expect(root.props.lazyMount).toBe(true);
        expect(root.props.unmountOnExit).not.toBe(true);
        root.props.onOpenChange({ open: true });
        part(render(input), "popover-root").props.onOpenChange({ open: false });
        part(render(input), "popover-root").props.onOpenChange({ open: true });
        expect(part(render(input), "popover-root").props.positioning).toBe(positioning);
        expect(part(render(input), "popover-root").props.positioning.getAnchorElement()).toBe(anchor);
    });
});

describe("Shell optional settings", () => {
    it("renders settings immediately after headerRight and before remove", () => {
        const settings = props();
        const tree = state.harness!.render(() => Shell({ id: "widget-1", headerRight: "Existing", settings, onRemove: vi.fn(), children: "Body" }));
        const settingsNode = nodes(tree).find(node => node.type === WidgetSettingsPopover)!;
        expect(settingsNode.props.id).toBe("widget-1");
        expect(settingsNode.props.definition).toBe(settings.definition);
        const right = nodes(tree).find(node => node.type === "div" && Array.isArray(node.props.children) && node.props.children[0] === "Existing")!;
        expect(right.props.children[1].type).toBe(WidgetSettingsPopover);
        expect(right.props.children[2].type).toBe(WidgetRemoveButton);
    });

    it("does not add settings or an empty header for nonopted or empty widgets", () => {
        const plain = state.harness!.render(() => Shell({ children: "Body" }));
        expect(nodes(plain).some(node => node.type === WidgetSettingsPopover)).toBe(false);
        expect(nodes(plain).some(node => String(node.props.className).includes("widget-handle"))).toBe(false);
        const empty = state.harness!.render(() => Shell({ settings: props({ definition: { title: "Empty", tabs: [] } }), children: "Body" }));
        expect(nodes(empty).some(node => String(node.props.className).includes("widget-handle"))).toBe(false);
    });
});
