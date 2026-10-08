import { afterEach, describe, expect, it, vi } from "vitest";
import { getSettingDefinition, getSettingOptions, type SettingDefinition } from "./registry";

afterEach(() => vi.restoreAllMocks());

async function timezoneDefinition() {
  vi.resetModules();
  const registry = await import("./registry");
  const def = registry.getSettingDefinition("general.timezone");
  expect(def?.type).toBe("select");
  if (!def || def.type !== "select") throw new Error("Expected timezone select");
  return { registry, def };
}

describe("select setting declarations", () => {
  it("resolves static and lazy options without cloning", () => {
    const options = [{ label: "First", value: "first" }];
    const def: Extract<SettingDefinition, { type: "select" }> = {
      id: "test.select", type: "select", label: "Select", description: "",
      category: "test", subcategoryId: "test", subcategoryLabel: "Test",
      defaultValue: "first", options,
    };
    expect(getSettingOptions(def)).toBe(options);
    const provider = vi.fn(() => options);
    expect(getSettingOptions({ ...def, options: provider })).toBe(options);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("enumerates timezone options lazily once with UTC and readable labels", async () => {
    const supported = vi.spyOn(Intl, "supportedValuesOf").mockReturnValue([
      "America/New_York", "UTC", "America/New_York",
    ]);
    const { registry, def } = await timezoneDefinition();
    expect(supported).not.toHaveBeenCalled();
    const options = registry.getSettingOptions(def);
    expect(options).toEqual([
      { label: "UTC", value: "UTC" },
      { label: "America/New York", value: "America/New_York" },
    ]);
    expect(registry.getSettingOptions(def)).toBe(options);
    expect(supported).toHaveBeenCalledTimes(1);
    expect(def.validate?.("US/Eastern")).toBeNull();
    expect(def.validate?.("bad/zone")).toBe("Invalid IANA timezone");
  });

  it("falls back to UTC and the local timezone without supportedValuesOf", async () => {
    vi.spyOn(Intl, "supportedValuesOf");
        Object.defineProperty(Intl, "supportedValuesOf", { value: undefined, configurable: true });
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { registry, def } = await timezoneDefinition();
    expect(registry.getSettingOptions(def).map(option => option.value))
      .toEqual([...new Set(["UTC", local])]);
  });

  it.each([
    ["basicChart.defaultInterval", "1d", "basic-chart"],
    ["defaultChartSymbol", "XU100.IS", "basic-chart"],
    ["crosshairMode", 1, "basic-chart"],
    ["advancedChart.defaultSymbol", "NVDA", "advanced-chart"],
    ["economicCalendar.defaultCountryFilter", "ar,au,br,ca,cn,fr,de,in,id,it,jp,kr,mx,ru,sa,za,tr,gb,us,eu", "economic-calendar"],
    ["economicCalendar.defaultImportanceFilter", false, "economic-calendar"],
    ["watchlist.disablePulse", false, "lists"],
  ])("registers %s without importing a widget", (id, defaultValue, subcategoryId) => {
    expect(getSettingDefinition(String(id))).toMatchObject({
      defaultValue, subcategoryId, category: "Widgets",
    });
  });
});
