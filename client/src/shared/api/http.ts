/** Fired when the server answers 401: the session ended, show the login again. */
export const UNAUTHORIZED = "taskpilot:unauthorized";

/** Takes ?token= from the URL (token mode) and removes it from the address bar. */
export function takeUrlToken(): string | null {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl === null) return null;
  url.searchParams.delete("token");
  history.replaceState(null, "", url);
  return fromUrl;
}

// The session cookie travels by itself (same origin), including on EventSource and WebSocket.
export async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== "/api/login") window.dispatchEvent(new Event(UNAUTHORIZED));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}
