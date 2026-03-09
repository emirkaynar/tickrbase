const DEFAULT_API_BASE = "http://localhost:8000";

export const API_BASE =
    (import.meta.env["VITE_API_BASE"] as string | undefined)?.toString() ??
    DEFAULT_API_BASE;

export class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

type ErrorPayload = { error?: boolean; message?: string };

async function parseResponse<T>(res: Response): Promise<T> {
    const data = (await res.json()) as T & ErrorPayload;
    if (!res.ok || data.error) {
        throw new ApiError(
            res.status,
            data.message ?? `Request failed: ${res.status}`,
        );
    }
    return data as T;
}

async function withRetry<T>(
    fn: () => Promise<T>,
    retries = 2,
    delayMs = 300,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError")
                throw err;
            lastError = err;
            if (attempt < retries) {
                await new Promise((r) =>
                    setTimeout(r, delayMs * Math.pow(2, attempt)),
                );
            }
        }
    }
    throw lastError;
}

export const api = {
    get<T>(path: string, signal?: AbortSignal): Promise<T> {
        return withRetry(() =>
            fetch(`${API_BASE}${path}`, { signal }).then((r) =>
                parseResponse<T>(r),
            ),
        );
    },

    post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
        return withRetry(() =>
            fetch(`${API_BASE}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal,
            }).then((r) => parseResponse<T>(r)),
        );
    },

    delete<T>(path: string, signal?: AbortSignal): Promise<T> {
        return withRetry(() =>
            fetch(`${API_BASE}${path}`, { method: "DELETE", signal }).then(
                (r) => parseResponse<T>(r),
            ),
        );
    },
};
