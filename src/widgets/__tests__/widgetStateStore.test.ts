import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../services/api";
import { activateWidgetCache, clearWidgetCaches, removeWidgetCaches } from "../widgetCache";
import { getWidgetStateStore } from "../settings/widgetStateStore.ts";
import { deferred, settle } from "../../ui/Combobox/testHarness";

vi.mock("../../services/api", () => ({ api: { get: vi.fn(), put: vi.fn() } }));

beforeEach(() => {
    clearWidgetCaches();
    vi.resetAllMocks();
    vi.useFakeTimers();
    activateWidgetCache("chart");
    vi.mocked(api.get).mockResolvedValue({ symbol: "ASELS.IS", interval: "1d", state: { chartType: "line", unrelated: { enabled: true } } });
    vi.mocked(api.put).mockResolvedValue(undefined);
});
afterEach(() => { clearWidgetCaches(); vi.useRealTimers(); });

async function loaded(id = "chart") {
    const store = getWidgetStateStore(id);
    await store.load();
    return store;
}

describe("per-instance widget state", () => {
    it("does not write defaults during hydration and preserves unrelated state", async () => {
        const store = await loaded();
        expect(api.put).not.toHaveBeenCalled();
        store.update(document => ({ ...document, state: { ...document.state, settings: { verticalGrid: false } } }));
        expect(store.getSnapshot().document.state.settings).toEqual({ verticalGrid: false });
        await vi.advanceTimersByTimeAsync(250);
        expect(api.put).toHaveBeenCalledWith("/user/widgets/chart/state", {
            symbol: "ASELS.IS", interval: "1d",
            state: { chartType: "line", unrelated: { enabled: true }, settings: { verticalGrid: false } },
        }, expect.any(AbortSignal));
    });

    it("blocks writes after failed hydration until a successful retry", async () => {
        vi.mocked(api.get).mockRejectedValueOnce(new Error("Load failed"));
        const store = await loaded();
        expect(store.getSnapshot().ready).toBe(false);
        expect(store.getSnapshot().error).toContain("Load failed");
        store.update(document => ({ ...document, symbol: "AAPL" }));
        await vi.advanceTimersByTimeAsync(1000);
        expect(api.put).not.toHaveBeenCalled();
        await store.retry();
        expect(store.getSnapshot().document.symbol).toBe("ASELS.IS");
        expect(store.getSnapshot().ready).toBe(true);
    });

    it("coalesces changes and serializes the latest document behind an in-flight save", async () => {
        const store = await loaded();
        const first = deferred<unknown>();
        vi.mocked(api.put).mockReturnValueOnce(first.promise);
        store.update(document => ({ ...document, symbol: "AAPL" }));
        await vi.advanceTimersByTimeAsync(250);
        store.update(document => ({ ...document, interval: "5m" }));
        store.update(document => ({ ...document, interval: "1m" }));
        await vi.advanceTimersByTimeAsync(250);
        expect(api.put).toHaveBeenCalledTimes(1);
        first.resolve(undefined);
        await settle();
        expect(api.put).toHaveBeenCalledTimes(2);
        expect(vi.mocked(api.put).mock.calls[1][1]).toMatchObject({ symbol: "AAPL", interval: "1m" });
        expect(store.getSnapshot().status).toBe("ready");
    });

    it("keeps unsaved local changes on save failure and retries the newest values", async () => {
        const store = await loaded();
        vi.mocked(api.put).mockRejectedValueOnce(new Error("Save failed"));
        store.update(document => ({ ...document, symbol: "AAPL" }));
        await vi.advanceTimersByTimeAsync(250);
        expect(store.getSnapshot().document.symbol).toBe("AAPL");
        expect(store.getSnapshot().status).toBe("error");
        await store.retry();
        expect(store.getSnapshot().status).toBe("ready");
    });

    it("retains pending changes across consumer remounts and isolates widgets", async () => {
        activateWidgetCache("other");
        const store = await loaded();
        const other = await loaded("other");
        store.update(document => ({ ...document, symbol: "AAPL" }));
        expect(getWidgetStateStore("chart")).toBe(store);
        expect(other.getSnapshot().document.symbol).toBe("ASELS.IS");
        await vi.advanceTimersByTimeAsync(250);
        expect(api.put).toHaveBeenCalledTimes(1);
    });

    it("cancels pending saves and invalidates stores on widget removal or logout", async () => {
        const store = await loaded();
        store.update(document => ({ ...document, symbol: "AAPL" }));
        removeWidgetCaches("chart");
        await vi.advanceTimersByTimeAsync(250);
        expect(api.put).not.toHaveBeenCalled();
        activateWidgetCache("chart");
        const replacement = await loaded();
        expect(replacement).not.toBe(store);
        store.update(document => ({ ...document, symbol: "OLD" }));
        expect(replacement.getSnapshot().document.symbol).toBe("ASELS.IS");
    });
});
