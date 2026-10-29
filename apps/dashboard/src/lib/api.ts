import type { ErrorBody } from "@hshelby/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** JSON call to the API (same origin, proxied). Throws ApiError with the server's error code. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & Partial<ErrorBody>) | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "internal_error", body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

/** Multipart upload to the API (the browser sets the content type and boundary). */
export async function apiForm<T>(path: string, form: FormData, method: "POST" | "PUT" = "POST"): Promise<T> {
  const res = await fetch(`/api${path}`, { method, body: form, credentials: "same-origin" });
  const body = (await res.json().catch(() => null)) as (T & Partial<ErrorBody>) | null;
  if (!res.ok) {
    const fallback = res.status === 413 ? "Photos can be up to 1 MB" : `Upload failed (${res.status})`;
    throw new ApiError(res.status, body?.error?.code ?? "internal_error", body?.error?.message ?? fallback);
  }
  return body as T;
}
