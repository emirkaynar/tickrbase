import { beforeEach, describe, expect, it } from "vitest";
import {
    activateWidgetCache,
    cacheWidgetState,
    clearWidgetCaches,
    getWidgetCacheToken,
    getWidgetStateFromCache,
    isWidgetCacheCurrent,
    registerWidgetCache,
    removeWidgetCaches,
    syncWidgetCacheIds,
} from "../widgetCache";

describe("widget cache ownership", () => {
    beforeEach(clearWidgetCaches);

    it("preserves cached bars through temporary unmounts and screen changes", () => {
        const bars = registerWidgetCache("chartBars", new Map<string, number[]>());
        syncWidgetCacheIds(["chart", "inactive-chart"]);
        const token = getWidgetCacheToken("chart");
        bars.set("chart", [1, 2, 3]);
        syncWidgetCacheIds(["inactive-chart", "chart"]);
        expect(bars.get("chart")).toEqual([1, 2, 3]);
        expect(isWidgetCacheCurrent("chart", token)).toBe(true);
    });

    it("evicts every cache entry for a permanently removed widget", () => {
        const bars = registerWidgetCache("chartBars", new Map<string, number[]>());
        const loaded = registerWidgetCache("loadedCharts", new Set<string>());
        activateWidgetCache("chart");
        const token = getWidgetCacheToken("chart");
        bars.set("chart", [1, 2, 3]);
        loaded.add("chart");
        cacheWidgetState("chart", { symbol: "TEST" }, token);
        removeWidgetCaches("chart");
        expect(bars.size).toBe(0);
        expect(loaded.size).toBe(0);
        expect(getWidgetStateFromCache("chart")).toBeUndefined();
        expect(isWidgetCacheCurrent("chart", token)).toBe(false);
    });

    it("reconciles caches against all surviving layout widgets", () => {
        const bars = registerWidgetCache("chartBars", new Map<string, number[]>());
        syncWidgetCacheIds(["removed-screen-chart", "survivor"]);
        bars.set("removed-screen-chart", [1]);
        bars.set("survivor", [2]);
        syncWidgetCacheIds(["survivor"]);
        expect([...bars.keys()]).toEqual(["survivor"]);
        expect(getWidgetCacheToken("removed-screen-chart")).toBeUndefined();
    });

    it("invalidates old writers across logout and reuse of the same widget id", () => {
        activateWidgetCache("chart");
        const expired = getWidgetCacheToken("chart");
        clearWidgetCaches();
        activateWidgetCache("chart");
        cacheWidgetState("chart", { symbol: "OLD" }, expired);
        expect(isWidgetCacheCurrent("chart", expired)).toBe(false);
        expect(getWidgetStateFromCache("chart")).toBeUndefined();
    });

    it("does not retain a prefetch response after its consumer has already mounted", () => {
        activateWidgetCache("chart");
        const token = getWidgetCacheToken("chart");
        expect(getWidgetStateFromCache("chart")).toBeUndefined();
        expect(cacheWidgetState("chart", { symbol: "LATE" }, token)).toBe(false);
        expect(getWidgetStateFromCache("chart")).toBeUndefined();
    });

    it("consumes prefetched state exactly once", () => {
        activateWidgetCache("chart");
        const saved = { symbol: "TEST" };
        expect(cacheWidgetState("chart", saved, getWidgetCacheToken("chart"))).toBe(true);
        expect(getWidgetStateFromCache("chart")).toBe(saved);
        expect(getWidgetStateFromCache("chart")).toBeUndefined();
    });

    it("does not accumulate deleted ids over repeated create/delete cycles", () => {
        const bars = registerWidgetCache("chartBars", new Map<string, number[]>());
        for (let i = 0; i < 1000; i++) {
            const id = `chart-${i}`;
            activateWidgetCache(id);
            bars.set(id, [i]);
            removeWidgetCaches(id);
        }
        expect(bars.size).toBe(0);
        expect(getWidgetCacheToken("chart-999")).toBeUndefined();
    });

    it("replaces a hot-reloaded cache without keeping its obsolete contents", () => {
        const previous = registerWidgetCache("chartBars", new Map<string, number[]>());
        previous.set("chart", [1]);
        const replacement = registerWidgetCache("chartBars", new Map<string, number[]>());
        expect(previous.size).toBe(0);
        expect(replacement.size).toBe(0);
    });
});
