import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../services/api";
import {
    clearWidgetCaches,
    getWidgetCacheToken,
    getWidgetStateFromCache,
    registerWidgetCache,
} from "../../widgets/widgetCache";
import { useLayout, type BackendLayoutPayload } from "../useLayout";

const harness = vi.hoisted(() => ({
    index: 0,
    slots: [] as Array<{ value?: any; deps?: unknown[]; cleanup?: () => void }>,
    effects: [] as Array<() => void>,
}));
vi.mock("preact/hooks", () => {
    const slot = () => harness.slots[harness.index++] ?? (harness.slots[harness.index - 1] = {});
    const changed = (previous: unknown[] | undefined, next: unknown[]) => !previous || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
    return {
        useState: (initial: unknown) => {
            const current = slot();
            if (!("value" in current)) current.value = initial;
            return [current.value, (value: unknown) => { current.value = typeof value === "function" ? value(current.value) : value; }];
        },
        useRef: (initial: unknown) => {
            const current = slot();
            return current.value ?? (current.value = { current: initial });
        },
        useCallback: (callback: unknown, deps: unknown[]) => {
            const current = slot();
            if (changed(current.deps, deps)) { current.value = callback; current.deps = deps; }
            return current.value;
        },
        useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
            const current = slot();
            if (changed(current.deps, deps)) {
                current.deps = deps;
                harness.effects.push(() => { current.cleanup?.(); current.cleanup = effect(); });
            }
        },
    };
});
vi.mock("../../services/api", () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock("../../services/settings", () => ({ prefetchSettings: vi.fn(async () => {}) }));
vi.mock("../../hooks/useDebounce", () => ({ useDebounce: (callback: unknown) => callback }));

const payload: BackendLayoutPayload = {
    screens: [
        { id: "first", name: "First", order: 0, createdAt: 0 },
        { id: "second", name: "Second", order: 1, createdAt: 0 },
    ],
    activeScreenId: "first",
    widgets: [
        { id: "first-chart", screenId: "first", type: "basic-chart", x: 0, y: 0, w: 8, h: 9, minW: 6, minH: 6, createdAt: 0 },
        { id: "second-chart", screenId: "second", type: "basic-chart", x: 0, y: 0, w: 8, h: 9, minW: 6, minH: 6, createdAt: 0 },
    ],
};

function render(authenticated = true, userId = 1, flushEffects = true) {
    harness.index = 0;
    const layout = useLayout(authenticated, userId);
    if (flushEffects) for (const effect of harness.effects.splice(0)) effect();
    return layout;
}
async function settle() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}
async function loaded() {
    render();
    await settle();
    return render();
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

describe("layout-owned widget cache lifetime", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        clearWidgetCaches();
        harness.index = 0;
        harness.slots.length = 0;
        harness.effects.length = 0;
        vi.mocked(api.get).mockImplementation(async (path) => path === "/user/layout" ? payload : { symbol: "TEST" });
        vi.mocked(api.put).mockResolvedValue(undefined);
    });
    afterEach(() => {
        for (const slot of harness.slots) slot.cleanup?.();
    });

    it("evicts a removed widget from every registered cache", async () => {
        const layout = await loaded();
        const bars = registerWidgetCache("chartBars", new Map<string, number[]>());
        bars.set("first-chart", [1]);
        await layout.removeWidget("first-chart");
        expect(bars.size).toBe(0);
        expect(getWidgetCacheToken("first-chart")).toBeUndefined();
        expect(getWidgetStateFromCache("first-chart")).toBeUndefined();
        expect(render().widgets).toEqual([]);
    });

    it("evicts only widgets belonging to a permanently deleted screen", async () => {
        const layout = await loaded();
        const bars = registerWidgetCache("chartBars", new Map<string, number[]>());
        bars.set("first-chart", [1]);
        bars.set("second-chart", [2]);
        expect(await layout.deleteScreen("first")).toBe(true);
        expect([...bars.keys()]).toEqual(["second-chart"]);
        expect(getWidgetCacheToken("second-chart")).toBeDefined();
        expect(render().widgets.map(widget => widget.id)).toEqual(["second-chart"]);
    });

    it("preserves inactive screen caches when switching screens", async () => {
        const layout = await loaded();
        const bars = registerWidgetCache("chartBars", new Map<string, number[]>());
        bars.set("first-chart", [1]);
        await layout.setActiveScreen("second");
        expect(bars.get("first-chart")).toEqual([1]);
        expect(getWidgetCacheToken("first-chart")).toBeDefined();
    });

    it("clears caches and layout state on logout", async () => {
        await loaded();
        const bars = registerWidgetCache("chartBars", new Map<string, number[]>());
        bars.set("first-chart", [1]);
        render(false);
        expect(bars.size).toBe(0);
        expect(getWidgetCacheToken("first-chart")).toBeUndefined();
        expect(render(false).widgets).toEqual([]);
        expect(render(false).ready).toBe(false);
    });

    it("ignores an old layout response after logout", async () => {
        const request = deferred<BackendLayoutPayload>();
        vi.mocked(api.get).mockReturnValueOnce(request.promise);
        render();
        const signal = vi.mocked(api.get).mock.calls[0][1]!;
        render(false);
        expect(signal.aborted).toBe(true);
        request.resolve(payload);
        await settle();
        expect(render(false).widgets).toEqual([]);
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(getWidgetCacheToken("first-chart")).toBeUndefined();
    });

    it("invalidates ownership when the authenticated user changes without logout", async () => {
        await loaded();
        const previousToken = getWidgetCacheToken("first-chart");
        const oldSignal = vi.mocked(api.get).mock.calls[0][1]!;
        render(true, 2);
        expect(oldSignal.aborted).toBe(true);
        expect(getWidgetCacheToken("first-chart")).toBeUndefined();
        await settle();
        expect(getWidgetCacheToken("first-chart")).not.toBe(previousToken);
        expect(render(true, 2).ready).toBe(true);
    });

    it("hides the previous user's layout before passive effects run", async () => {
        await loaded();
        const changedUser = render(true, 2, false);
        expect(changedUser.widgets).toEqual([]);
        expect(changedUser.screens).toEqual([]);
        expect(changedUser.activeScreenId).toBe("");
        expect(changedUser.ready).toBe(false);
    });

    it("ignores a layout response immediately after auth invalidation, before effect cleanup", async () => {
        const request = deferred<BackendLayoutPayload>();
        vi.mocked(api.get).mockReturnValueOnce(request.promise);
        render();
        clearWidgetCaches();
        request.resolve(payload);
        await settle();
        expect(getWidgetCacheToken("first-chart")).toBeUndefined();
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(render(false, 1, false).widgets).toEqual([]);
    });

    it("does not let a late prefetch recreate a removed widget's state", async () => {
        const prefetch = deferred<unknown>();
        vi.mocked(api.get).mockImplementation((path) => Promise.resolve(path === "/user/layout" ? payload : path.includes("first-chart") ? prefetch.promise : undefined));
        const layout = await loaded();
        await layout.removeWidget("first-chart");
        prefetch.resolve({ symbol: "LATE" });
        await settle();
        expect(getWidgetStateFromCache("first-chart")).toBeUndefined();
        expect(getWidgetCacheToken("first-chart")).toBeUndefined();
    });
});
