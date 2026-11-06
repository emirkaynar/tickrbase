import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../services/api";
import {
  activateWidgetCache,
  clearWidgetCaches,
  getWidgetCacheToken,
} from "../../widgets/widgetCache";
import { useAuth } from "../useAuth";

const stateSetters = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);
vi.mock("preact/hooks", () => ({
  useState: (initial: unknown) => {
    const setter = vi.fn();
    stateSetters.push(setter);
    return [initial, setter];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
}));
vi.mock("../../services/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class extends Error {},
}));
const firstUser = {
  id: "4a15c70e-8c4a-4052-83e4-19d3fa01e9cb",
  email: "first@example.test",
  tier: "free",
  created_at: "2026-01-01",
};
const secondUser = {
  ...firstUser,
  id: "08a9175e-8d74-4325-a5dc-55110948e23a",
  email: "second@example.test",
};

beforeEach(() => {
  vi.resetAllMocks();
  stateSetters.length = 0;
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
    expect(await auth.logout()).toBe(false);
    expect(getWidgetCacheToken("chart")).toBeUndefined();
    expect(stateSetters[0]).toHaveBeenCalledTimes(1);
    expect(stateSetters[0]).toHaveBeenLastCalledWith(firstUser);
    expect(stateSetters[2]).toHaveBeenLastCalledWith("Sign out failed. Your session may still be active. Please try again.");
  });

  it("clears the authenticated principal only after confirmed logout", async () => {
    const auth = useAuth();
    vi.mocked(api.post).mockResolvedValueOnce(firstUser);
    await auth.login("first@example.test", "test");
    vi.mocked(api.post).mockResolvedValueOnce({ ok: true });
    expect(await auth.logout()).toBe(true);
    expect(stateSetters[0]).toHaveBeenLastCalledWith(null);
    expect(stateSetters[2]).toHaveBeenLastCalledWith(null);
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
