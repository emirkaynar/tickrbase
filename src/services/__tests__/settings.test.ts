import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../api", () => ({ api: { put: vi.fn(), get: vi.fn() } }));
import { api } from "../api";
import { getSettingValue, isValidTimezone, setSettingValue, subscribeSetting } from "../settings";
import { registerSetting } from "../../settings/registry";

describe("select settings validation", () => {
    const options = [{ label: "First", value: "first" }, { label: "None", value: "" }];
    beforeEach(() => {
        vi.resetAllMocks();
        registerSetting({
            id: "test.select", type: "select", label: "Select", description: "",
            category: "test", subcategoryId: "test", subcategoryLabel: "Test",
            defaultValue: "first", options: () => options,
        });
    });
    it("rejects nonstrings and values outside the options before writing", async () => {
        const listener = vi.fn();
        const off = subscribeSetting("test.select", listener);
        try {
            await expect(setSettingValue("test.select", 1)).rejects.toThrow("expected string");
            await expect(setSettingValue("test.select", "unknown")).rejects.toThrow("Invalid option");
            expect(api.put).not.toHaveBeenCalled();
            expect(listener).not.toHaveBeenCalled();
        } finally { off(); }
    });
    it("stores select values as strings, including empty options", async () => {
        await setSettingValue("test.select", "");
        expect(api.put).toHaveBeenCalledWith("/user/settings", { settings: { "test.select": "" } });
        expect(await getSettingValue("test.select")).toBe("");
    });
    it("preserves the cached value and subscribers when saving fails", async () => {
        await setSettingValue("test.select", "first");
        const listener = vi.fn();
        const off = subscribeSetting("test.select", listener);
        try {
            vi.mocked(api.put).mockRejectedValueOnce(new Error("offline"));
            await expect(setSettingValue("test.select", "")).rejects.toThrow("offline");
            expect(await getSettingValue("test.select")).toBe("first");
            expect(listener).not.toHaveBeenCalled();
        } finally { off(); }
    });
    it("uses custom validation instead of option membership", async () => {
        registerSetting({
            id: "test.alias", type: "select", label: "Alias", description: "",
            category: "test", subcategoryId: "test", subcategoryLabel: "Test",
            defaultValue: "first", options,
            validate: value => value === "alias" ? null : "Invalid alias",
        });
        await setSettingValue("test.alias", "alias");
        await expect(setSettingValue("test.alias", "first")).rejects.toThrow("Invalid alias");
        expect(api.put).toHaveBeenCalledTimes(1);
    });
});

describe("user timezone settings", () => {
    beforeEach(() => vi.resetAllMocks());
    it("validates timezones before saving", async () => {
        expect(isValidTimezone("Europe/Istanbul")).toBe(true);
        await expect(setSettingValue("general.timezone", "bad/zone")).rejects.toThrow();
        expect(api.put).not.toHaveBeenCalled();
    });
    it("updates every subscriber only after a successful save", async () => {
        const first = vi.fn(), second = vi.fn();
        const off1 = subscribeSetting("general.timezone", first);
        const off2 = subscribeSetting("general.timezone", second);
        vi.mocked(api.put).mockRejectedValueOnce(new Error("offline"));
        await expect(setSettingValue("general.timezone", "UTC")).rejects.toThrow();
        expect(first).not.toHaveBeenCalled();
        vi.mocked(api.put).mockResolvedValueOnce({});
        await setSettingValue("general.timezone", "Europe/Istanbul");
        expect(first).toHaveBeenCalledWith("Europe/Istanbul");
        expect(second).toHaveBeenCalledWith("Europe/Istanbul");
        off1(); off2();
    });
});
