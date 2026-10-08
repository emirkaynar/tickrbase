// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { nodes } from "../Combobox/testHarness";
import { Switch } from "./Switch";
import styles from "./Switch.module.css";

vi.mock("@ark-ui/react/switch", () => ({
    Switch: {
        Root: "switch-root",
        HiddenInput: "switch-input",
        Control: "switch-control",
        Thumb: "switch-thumb",
    },
}));

const part = (tree: unknown, name: string) =>
    nodes(tree).find((node) => node.type === `switch-${name}`)!;

// These tests cover the wrapper contract; Ark owns native input interaction.
describe("Switch", () => {
    it("passes instance identity to Ark without overriding its input/label association", () => {
        const first = Switch({ id: "chart-one-grid", checked: false, onChange: vi.fn(), "aria-label": "Grid" });
        const second = Switch({ id: "chart-two-grid", checked: false, onChange: vi.fn(), "aria-label": "Grid" });
        expect(part(first, "root").props.id).toBe("chart-one-grid");
        expect(part(second, "root").props.id).toBe("chart-two-grid");
        expect(part(first, "input").props.id).toBeUndefined();
        expect(part(first, "root").props.htmlFor).toBeUndefined();
        expect(part(first, "control").props.onClick).toBeUndefined();
    });

    it("leaves Ark's generated identity intact when no id is supplied", () => {
        const tree = Switch({ checked: false, onChange: vi.fn(), "aria-label": "Grid" });
        expect(part(tree, "root").props).not.toHaveProperty("id");
    });

    it("forwards controlled state and maps checked changes to a boolean", () => {
        const onChange = vi.fn();
        const tree = Switch({ checked: false, onChange, "aria-label": "Enabled" });
        const root = part(tree, "root");

        expect(root.props.checked).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
        root.props.onCheckedChange({ checked: true });
        root.props.onCheckedChange({ checked: false });
        expect(onChange).toHaveBeenNthCalledWith(1, true);
        expect(onChange).toHaveBeenNthCalledWith(2, false);
        expect(root.props.checked).toBe(false);

        const updated = Switch({ checked: true, onChange, "aria-label": "Enabled" });
        expect(part(updated, "root").props.checked).toBe(true);
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("places the accessible name and description on the hidden input", () => {
        const tree = Switch({
            checked: true,
            onChange: vi.fn(),
            "aria-label": "Enabled",
            "aria-describedby": "enabled-help",
        });
        const input = part(tree, "input");

        expect(input.props["aria-label"]).toBe("Enabled");
        expect(input.props["aria-describedby"]).toBe("enabled-help");
        expect(input.props.className).toBe(styles.hiddenInput);
    });

    it("supports external labels and multiple description IDs", () => {
        const tree = Switch({
            checked: false,
            onChange: vi.fn(),
            "aria-labelledby": "enabled-label",
            "aria-describedby": "enabled-help enabled-error",
        });
        const input = part(tree, "input");

        expect(input.props["aria-labelledby"]).toBe("enabled-label");
        expect(input.props["aria-describedby"]).toBe("enabled-help enabled-error");
        expect(input.props["aria-label"]).toBeUndefined();
    });

    it("forwards disabled state and combines the root class names", () => {
        const tree = Switch({
            checked: false,
            onChange: vi.fn(),
            disabled: true,
            className: "custom-switch",
            "aria-label": "Enabled",
        });

        expect(part(tree, "root").props.disabled).toBe(true);
        expect(part(tree, "root").props.className).toBe(`${styles.root} custom-switch`);
        expect(part(tree, "control").props.className).toBe(styles.control);
        expect(part(tree, "thumb").props.className).toBe(styles.thumb);
    });

    it("does not disable the switch or add an empty class by default", () => {
        const tree = Switch({ checked: false, onChange: vi.fn(), "aria-label": "Enabled" });

        expect(part(tree, "root").props.disabled).toBeUndefined();
        expect(part(tree, "root").props.className).toBe(styles.root);
    });
});
