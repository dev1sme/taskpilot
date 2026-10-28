/** Fired when the server answers 401: the session ended, show the login again. */
export const UNAUTHORIZED = "taskpilot:unauthorized";

/** An error answer of the API, with its status (409 = changed meanwhile, 400 = invalid input…). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Takes ?token= from the URL (token mode) and removes it from the address bar. */
export function takeUrlToken(): string | null {
  const url = new URL(location.href);
  const token = url.searchParams.get("token");
  if (token === null) return null;
  url.searchParams.delete("token");
  history.replaceState(null, "", url);
  return token;
}

// The session cookie travels by itself (same origin), including on EventSource and WebSocket.
export async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && url !== "/api/login") window.dispatchEvent(new Event(UNAUTHORIZED));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** A query string from the defined values only. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}
