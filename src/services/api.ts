const DEFAULT_API_BASE = "http://localhost:8001";

export const API_BASE =
  (import.meta.env["VITE_API_BASE"] as string | undefined)?.toString() ??
  DEFAULT_API_BASE;

export class ApiError extends Error {
  readonly status: number;
  readonly headers: Headers;
  readonly code?: string;
  readonly requestId?: string;
  readonly fields?: { field: string; code: string }[];
  constructor(status: number, message: string, headers = new Headers(), payload?: ErrorPayload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.headers = headers;
    this.code = payload?.code;
    this.requestId = payload?.request_id ?? headers.get("x-request-id") ?? undefined;
    this.fields = payload?.fields;
  }
}

type ErrorPayload = { error?: boolean; message?: string; code?: string; request_id?: string; fields?: { field: string; code: string }[] };

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: (T & ErrorPayload) | undefined;
  if (text) {
    try {
      data = JSON.parse(text) as T & ErrorPayload;
    } catch {
      throw new ApiError(res.status, res.ok ? "Invalid server response" : `Request failed: ${res.status}`, res.headers);
    }
  }
  if (!res.ok || data?.error) {
    throw new ApiError(
      res.status,
      typeof data?.message === "string" ? data.message : `Request failed: ${res.status}`,
      res.headers,
      data,
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
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403))
        throw err; // Do not retry on auth failures
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

export type UserMe = {
  id: string;
  email: string;
  tier: string;
  created_at: string;
};

export const api = {
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return withRetry(() =>
      fetch(`${API_BASE}${path}`, { signal, credentials: "include" }).then(
        (r) => parseResponse<T>(r),
      ),
    );
  },

  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return withRetry(() =>
      fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "include",
        signal,
      }).then((r) => parseResponse<T>(r)),
    );
  },

  put<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return withRetry(() =>
      fetch(`${API_BASE}${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "include",
        signal,
      }).then((r) => parseResponse<T>(r)),
    );
  },

  delete<T>(path: string, signal?: AbortSignal): Promise<T> {
    return withRetry(() =>
      fetch(`${API_BASE}${path}`, {
        method: "DELETE",
        credentials: "include",
        signal,
      }).then((r) => parseResponse<T>(r)),
    );
  },
};
