// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Combobox } from "../../ui/Combobox/Combobox";
import { Switch } from "../../ui/Switch/Switch";
import { createHookHarness, deferred, nodes, settle, text } from "../../ui/Combobox/testHarness";
import { getAllSettings, getSettingOptions, type SettingDefinition } from "../../settings/registry";
import { getSettingValue, setSettingValue } from "../../services/settings";
import { SettingsPage } from "./SettingsPage";

const state = vi.hoisted(() => ({ harness: null as ReturnType<typeof createHookHarness> | null }));
vi.mock("preact/hooks", async () => {
    const { createHookHarness } = await import("../../ui/Combobox/testHarness");
    state.harness = createHookHarness();
    return state.harness.hooks;
});
// The parent owns the registry contract. Mock only that boundary, not UI behavior.
vi.mock("../../settings/registry", () => ({ getAllSettings: vi.fn(), getSettingOptions: vi.fn() }));
vi.mock("../../services/settings", () => ({ getSettingValue: vi.fn(), setSettingValue: vi.fn() }));
vi.mock("../../ui/Combobox/Combobox", () => ({ Combobox: () => null }));
vi.mock("@ark-ui/react/tabs", () => ({ Tabs: { Root: "tabs-root", List: "tabs-list", Trigger: "tabs-trigger", Indicator: "tabs-indicator", Content: "tabs-content" } }));
vi.mock("@ark-ui/react/switch", () => ({ Switch: { Root: "switch-root", HiddenInput: "switch-input", Control: "switch-control", Thumb: "switch-thumb" } }));
vi.mock("@ark-ui/react/editable", () => ({ Editable: { Root: "editable-root", Area: "editable-area", Input: "editable-input", Preview: "editable-preview" } }));
vi.mock("@ark-ui/react", () => ({ ScrollArea: { Root: "scroll-root", Viewport: "scroll-viewport", Content: "scroll-content", Scrollbar: "scrollbar", Thumb: "scroll-thumb" } }));
vi.mock("lucide-react", () => ({}));

const options = Object.freeze([
    Object.freeze({ label: "Alpha", value: "a" }),
    Object.freeze({ label: "Beta", value: "b" }),
]);
const metadata = { category: "custom", subcategoryId: "display", subcategoryLabel: "Display", description: "Choose a mode" };
const first = { ...metadata, id: "custom.mode", label: "Mode", type: "select" as const, defaultValue: "a", options, placeholder: "Choose mode" };
const second = { ...first, id: "custom.other", label: "Other mode", options: vi.fn(() => options) };

const render = () => state.harness!.render(SettingsPage);
const controls = (tree = render()) => nodes(tree).filter(node => node.type === Combobox);
const byType = (type: string, tree = render()) => nodes(tree).find(node => node.type === type)!;
const byRole = (role: string, tree = render()) => nodes(tree).filter(node => node.props.role === role);
async function loaded(definitions: SettingDefinition[] = [first, second]) {
    vi.mocked(getAllSettings).mockReturnValue(definitions);
    render();
    await settle();
    return render();
}

beforeEach(() => {
    vi.clearAllMocks();
    state.harness!.reset();
    vi.mocked(getSettingValue).mockResolvedValue("legacy-valid");
    vi.mocked(setSettingValue).mockResolvedValue(undefined);
    vi.mocked(getSettingOptions).mockImplementation(def => typeof def.options === "function" ? def.options() : def.options);
});
afterEach(() => state.harness!.unmount());

describe("registry-driven select settings", () => {
    it("renders arbitrary selects with cloned stable options and preserves unmatched persisted values", async () => {
        const tree = await loaded();
        const [mode, other] = controls(tree);
        expect(controls(tree)).toHaveLength(2);
        expect(mode.props.value).toBe("legacy-valid");
        expect(mode.props.placeholder).toBe("Choose mode");
        expect(mode.props.items).toEqual(options);
        expect(mode.props.items).not.toBe(options);
        expect(mode.props.items[0]).not.toBe(options[0]);
        expect(other.props.items).toEqual(options);
        expect(second.options).toHaveBeenCalledTimes(1);
        mode.props.onChange("b");
        await settle();
        expect(controls()[0].props.items).toBe(mode.props.items);
        expect(getSettingOptions).toHaveBeenCalledTimes(2);
        expect(second.options).toHaveBeenCalledTimes(1);
    });

    it("associates select labels and descriptions with actual elements", async () => {
        const tree = await loaded([first]);
        const control = controls(tree)[0];
        const label = nodes(tree).find(node => node.props.id === control.props["aria-labelledby"]);
        const description = nodes(tree).find(node => node.props.id === control.props["aria-describedby"]);
        expect(label).toBeDefined();
        expect(text(label)).toBe("Mode");
        expect(text(description)).toBe("Choose a mode");
    });

    it("optimistically saves once per id before rerender while allowing another select to save", async () => {
        const request = deferred<void>();
        vi.mocked(setSettingValue).mockReturnValue(request.promise);
        await loaded();
        const [mode, other] = controls();
        mode.props.onChange("b");
        mode.props.onChange("a");
        other.props.onChange("a");
        expect(setSettingValue).toHaveBeenCalledTimes(2);
        expect(setSettingValue).toHaveBeenNthCalledWith(1, first.id, "b");
        expect(setSettingValue).toHaveBeenNthCalledWith(2, second.id, "a");
        expect(controls().map(control => control.props.value)).toEqual(["b", "a"]);
        expect(controls().every(control => control.props.disabled)).toBe(true);
        expect(byRole("status").map(node => text(node))).toEqual(["Saving…", "Saving…"]);
        request.resolve();
        await settle();
        expect(controls().every(control => !control.props.disabled)).toBe(true);
        expect(byRole("status")).toHaveLength(0);
        expect(byRole("alert")).toHaveLength(0);
        expect(controls()[0].props.value).toBe("b");
    });

    it("rolls back on rejection, announces a described error, and permits a successful retry", async () => {
        const request = deferred<void>();
        vi.mocked(setSettingValue).mockReturnValueOnce(request.promise);
        await loaded([first]);
        controls()[0].props.onChange("b");
        expect(controls()[0].props.value).toBe("b");
        request.reject(new Error("Unable to save mode"));
        await settle();
        const tree = render();
        const control = controls(tree)[0];
        expect(control.props.value).toBe("legacy-valid");
        expect(control.props.disabled).toBe(false);
        expect(control.props.invalid).toBe(true);
        const alert = byRole("alert", tree)[0];
        expect(text(alert)).toBe("Unable to save mode");
        expect(control.props["aria-describedby"].split(" ")).toContain(alert.props.id);
        expect(byRole("status", tree)).toHaveLength(0);
        control.props.onChange("a");
        expect(byRole("alert")).toHaveLength(0);
        await settle();
        expect(controls()[0].props.value).toBe("a");
        expect(controls()[0].props.invalid).toBe(false);
    });

    it("provides a failure message for non-Error rejections and does not affect other selects", async () => {
        vi.mocked(setSettingValue).mockRejectedValueOnce(null);
        await loaded();
        controls()[0].props.onChange("b");
        await settle();
        expect(text(byRole("alert")[0])).toBe("Failed to save setting. Please try again.");
        expect(controls()[1].props.invalid).toBe(false);
        expect(controls()[1].props.disabled).toBe(false);
    });

    it("does not update state or continue loading after unmount", async () => {
        const request = deferred<string>();
        vi.mocked(getAllSettings).mockReturnValue([first, second]);
        vi.mocked(getSettingValue).mockReturnValueOnce(request.promise);
        expect(text(render())).toContain("Loading settings");
        state.harness!.unmount();
        const updates = state.harness!.updates;
        request.resolve("a");
        await settle();
        expect(state.harness!.updates).toBe(updates);
        expect(getSettingValue).toHaveBeenCalledTimes(1);
    });

    it("leaves boolean, string, and integer immediate-save behavior unchanged", async () => {
        const defs: SettingDefinition[] = [
            { ...metadata, id: "custom.enabled", label: "Enabled", type: "boolean", defaultValue: false },
            { ...metadata, id: "custom.text", label: "Text", type: "string", defaultValue: "" },
            { ...metadata, id: "custom.count", label: "Count", type: "integer", defaultValue: 1 },
        ];
        await loaded(defs);
        const editable = byType("editable-root");
        editable.props.onValueChange({ value: "first" });
        editable.props.onValueChange({ value: "second" });
        nodes(render()).find(node => node.type === Switch)!.props.onChange(true);
        byType("input").props.onChange({ currentTarget: { value: "42" } });
        expect(setSettingValue).toHaveBeenCalledWith("custom.text", "first");
        expect(setSettingValue).toHaveBeenCalledWith("custom.text", "second");
        expect(setSettingValue).toHaveBeenCalledWith("custom.enabled", true);
        expect(setSettingValue).toHaveBeenCalledWith("custom.count", 42);
        expect(byType("editable-root").props.disabled).toBeUndefined();
        expect(nodes(render()).find(node => node.type === Switch)!.props.disabled).toBeUndefined();
        expect(byType("input").props.disabled).toBeUndefined();
        expect(getSettingOptions).not.toHaveBeenCalled();
    });
});
