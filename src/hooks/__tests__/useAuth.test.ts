import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../services/api";
import { activateWidgetCache, clearWidgetCaches, getWidgetCacheToken } from "../../widgets/widgetCache";
import { useAuth } from "../useAuth";

vi.mock("preact/hooks", () => ({
    useState: (initial: unknown) => [initial, vi.fn()],
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (callback: unknown) => callback,
    useEffect: vi.fn(),
}));
vi.mock("../../services/api", () => ({
    api: { get: vi.fn(), post: vi.fn() },
    ApiError: class extends Error {},
}));
const firstUser = { id: 1, email: "first@example.test", tier: "free", created_at: "2026-01-01" };
const secondUser = { ...firstUser, id: 2, email: "second@example.test" };

beforeEach(() => {
    vi.resetAllMocks();
    clearWidgetCaches();
});

describe("authentication-owned cache invalidation", () => {
    it("invalidates caches immediately when login changes the user", async () => {
        const auth = useAuth();
        vi.mocked(api.post).mockResolvedValueOnce(firstUser);
        await auth.login("first@example.test", "test");
        activateWidgetCache("chart");
        vi.mocked(api.post).mockResolvedValueOnce(secondUser);
        await auth.login("second@example.test", "test");
        expect(getWidgetCacheToken("chart")).toBeUndefined();
    });

    it("invalidates caches immediately after logout, even when its request fails", async () => {
        const auth = useAuth();
        vi.mocked(api.post).mockResolvedValueOnce(firstUser);
        await auth.login("first@example.test", "test");
        activateWidgetCache("chart");
        vi.mocked(api.post).mockRejectedValueOnce(new Error("offline"));
        await auth.logout();
        expect(getWidgetCacheToken("chart")).toBeUndefined();
    });

    it("preserves caches when authentication refresh returns the same user", async () => {
        const auth = useAuth();
        vi.mocked(api.post).mockResolvedValueOnce(firstUser);
        await auth.login("first@example.test", "test");
        activateWidgetCache("chart");
        const token = getWidgetCacheToken("chart");
        vi.mocked(api.get).mockResolvedValueOnce(firstUser);
        await auth.checkAuth();
        expect(getWidgetCacheToken("chart")).toBe(token);
    });

    it("invalidates the old user's caches when authentication expires", async () => {
        const auth = useAuth();
        vi.mocked(api.post).mockResolvedValueOnce(firstUser);
        await auth.login("first@example.test", "test");
        activateWidgetCache("chart");
        vi.mocked(api.get).mockRejectedValueOnce(new Error("expired"));
        await auth.checkAuth();
        expect(getWidgetCacheToken("chart")).toBeUndefined();
    });

    it("invalidates caches when registration establishes a different account", async () => {
        const auth = useAuth();
        vi.mocked(api.post).mockResolvedValueOnce(firstUser);
        await auth.login("first@example.test", "test");
        activateWidgetCache("chart");
        vi.mocked(api.post).mockResolvedValueOnce(secondUser);
        await auth.register("second@example.test", "test");
        expect(getWidgetCacheToken("chart")).toBeUndefined();
    });
});
