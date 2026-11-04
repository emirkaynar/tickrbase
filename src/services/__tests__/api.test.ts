import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("API response parsing", () => {
  it("accepts empty successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api.get("/empty")).resolves.toBeUndefined();
  });

  it("preserves HTTP status and headers for HTML failures without exposing their body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>secret</html>", {
      status: 401, headers: { "x-request-id": "request-123" },
    })));
    const error = await api.get("/failed").catch((e: unknown) => e) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.requestId).toBe("request-123");
    expect(error.message).not.toContain("secret");
  });

  it("retains structured error fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: true, code: "FORBIDDEN", message: "Forbidden", request_id: "r",
      fields: [{ field: "body.name", code: "missing" }],
    }), { status: 403 })));
    const error = await api.get("/failed").catch((e: unknown) => e) as ApiError;
    expect(error.code).toBe("FORBIDDEN");
    expect(error.fields).toEqual([{ field: "body.name", code: "missing" }]);
  });

  it("keeps the existing retry policy for server failures", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetch);
    const request = api.get("/retry");
    await vi.runAllTimersAsync();
    await expect(request).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
