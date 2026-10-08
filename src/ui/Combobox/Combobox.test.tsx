// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Combobox } from "./Combobox";
import { createHookHarness, nodes } from "./testHarness";

const state = vi.hoisted(() => ({
    harness: null as ReturnType<typeof createHookHarness> | null,
    filter: vi.fn(),
    set: vi.fn(),
}));
vi.mock("preact/hooks", async () => {
    const { createHookHarness } = await import("./testHarness");
    state.harness = createHookHarness();
    return state.harness.hooks;
});
vi.mock("@ark-ui/react/combobox", () => ({
    Combobox: Object.fromEntries(["Root", "Control", "Input", "Trigger", "Positioner", "Content", "Empty", "Item", "ItemText", "ItemIndicator"].map(name => [name, `combobox-${name}`])),
    useListCollection: ({ initialItems }: { initialItems: unknown[] }) => ({ collection: { items: initialItems }, filter: state.filter, set: state.set }),
}));
vi.mock("@ark-ui/react/locale", () => ({ useFilter: () => ({ contains: vi.fn() }) }));
vi.mock("@ark-ui/react/portal", () => ({ Portal: "portal" }));
vi.mock("lucide-react", () => ({ CheckIcon: "check-icon", ChevronsUpDownIcon: "chevrons-icon" }));

const items = [{ label: "Alpha", value: "a" }, { label: "Beta", value: "b" }];
const onChange = vi.fn();
type Props = Parameters<typeof Combobox>[0];
const render = (extra: Partial<Props> = {}) => state.harness!.render(() => Combobox({ items, value: "a", onChange, ...extra }));
const part = (tree: unknown, name: string) => nodes(tree).find(node => node.type === `combobox-${name}`)!;

beforeEach(() => {
    vi.clearAllMocks();
    state.harness!.reset();
});
afterEach(() => state.harness!.unmount());

describe("Combobox settings support", () => {
    it("forwards disabled, invalid, and accessible input attributes to Ark", () => {
        const tree = render({ disabled: true, invalid: true, "aria-label": "Mode", "aria-labelledby": "mode-label", "aria-describedby": "mode-help mode-error" });
        expect(part(tree, "Root").props.disabled).toBe(true);
        expect(part(tree, "Root").props.invalid).toBe(true);
        expect(part(tree, "Input").props["aria-label"]).toBe("Mode");
        expect(part(tree, "Input").props["aria-labelledby"]).toBe("mode-label");
        expect(part(tree, "Input").props["aria-describedby"]).toBe("mode-help mode-error");
        expect(part(tree, "Input").props["aria-invalid"]).toBe(true);
        const trigger = part(tree, "Trigger").props;
        expect(trigger["aria-label"] || trigger["aria-labelledby"]).toBeTruthy();
    });

    it("remains enabled by default and labels the icon-only trigger", () => {
        const tree = render();
        expect(part(tree, "Root").props.disabled).not.toBe(true);
        expect(part(tree, "Root").props.invalid).not.toBe(true);
        expect(part(tree, "Trigger").props["aria-label"]).toBe("Show options");
    });

    it("keeps an unmatched persisted value visible and does not select a default", () => {
        render({ value: "legacy-valid" });
        expect(part(render({ value: "legacy-valid" }), "Root").props.inputValue).toBe("legacy-valid");
        expect(onChange).not.toHaveBeenCalled();
    });

    it("filters queries without saving and restores the selected label on dismissal", () => {
        part(render(), "Root").props.onInputValueChange({ inputValue: "bet" });
        expect(part(render(), "Root").props.inputValue).toBe("bet");
        expect(state.filter).toHaveBeenCalledWith("bet");
        expect(onChange).not.toHaveBeenCalled();
        part(render(), "Root").props.onOpenChange({ open: false });
        expect(part(render(), "Root").props.inputValue).toBe("Alpha");
        expect(onChange).not.toHaveBeenCalled();
    });

    it("saves an empty-string option but ignores a cleared selection", () => {
        const root = part(render({ items: [...items, { label: "Automatic", value: "" }] }), "Root");
        root.props.onValueChange({ value: [""] });
        expect(onChange).toHaveBeenCalledExactlyOnceWith("");
        root.props.onValueChange({ value: [] });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("saves a selection and resets the displayed label when the parent rolls back", () => {
        part(render(), "Root").props.onValueChange({ value: ["b"] });
        expect(onChange).toHaveBeenCalledExactlyOnceWith("b");
        render({ value: "b" });
        expect(part(render({ value: "b" }), "Root").props.inputValue).toBe("Beta");
        render({ value: "a" });
        expect(part(render({ value: "a" }), "Root").props.inputValue).toBe("Alpha");
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
