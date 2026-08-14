/**
 * 轻量 typed fetch 客户端。
 *
 * 所有路径自动加 `/api` 前缀（Vite proxy 同源转发到后端，决策 6）。
 * 非 2xx → ApiError（携带 status）；网络错误原样抛出。
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  return (await res.json()) as T;
}
