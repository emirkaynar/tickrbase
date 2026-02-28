const DEFAULT_API_BASE = "http://localhost:8000";

export const API_BASE =
    import.meta.env.VITE_API_BASE?.toString() ?? DEFAULT_API_BASE;

type ErrorPayload = { error?: boolean; message?: string };

export async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`);
    const data = (await res.json()) as T & ErrorPayload;
    if (!res.ok || data.error) {
        throw new Error(data.message || `Request failed: ${res.status}`);
    }
    return data as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & ErrorPayload;
    if (!res.ok || data.error) {
        throw new Error(data.message || `Request failed: ${res.status}`);
    }
    return data as T;
}
