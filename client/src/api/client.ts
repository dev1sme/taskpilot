import type { ActivityItem, Info, Inventory, RepoInfo, RunState, RunView, SessionView, TaskSummary } from "./types";

const TOKEN_KEY = "taskpilot-token";

/** Takes ?token= from the URL once, keeps it for this tab, and removes it from the address bar. */
function initToken(): string {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      // Storage blocked: the token still works until the page reloads.
    }
    url.searchParams.delete("token");
    history.replaceState(null, "", url);
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export const token = initToken();

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "x-taskpilot-token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const task = (key: string) => `/api/tasks/${encodeURIComponent(key)}`;

export const api = {
  info: () => call<Info>("GET", "/api/info"),
  inventory: () => call<Inventory>("GET", "/api/inventory"),
  repo: () => call<RepoInfo>("GET", "/api/repo"),
  setRepo: (path: string) => call<RepoInfo>("PUT", "/api/repo", { path }),
  tasks: () => call<TaskSummary[]>("GET", "/api/tasks"),
  file: (key: string, path: string) =>
    call<{ path: string; content: string }>("GET", `${task(key)}/file?path=${encodeURIComponent(path)}`),
  activity: (key: string) => call<ActivityItem[]>("GET", `${task(key)}/activity?limit=300`),

  sessions: (key: string) => call<SessionView[]>("GET", `${task(key)}/sessions`),
  createSession: (key: string) => call<SessionView>("POST", `${task(key)}/sessions`),
  resumeSession: (id: string) => call<SessionView>("POST", `/api/sessions/${id}/resume`),
  stopSession: (id: string) => call<{ ok: true }>("POST", `/api/sessions/${id}/stop`),
  forgetSession: (id: string) => call<{ ok: true }>("DELETE", `/api/sessions/${id}`),

  run: (key: string) => call<RunView>("GET", `${task(key)}/run`),
  startRun: (key: string) => call<RunState>("POST", `${task(key)}/run`),
  cancelRun: (key: string) => call<RunState>("DELETE", `${task(key)}/run`),
  approve: (key: string) => call<RunState>("POST", `${task(key)}/run/approve`),
  feedback: (key: string, text: string) => call<RunState>("POST", `${task(key)}/run/feedback`, { text }),
  retry: (key: string) => call<RunState>("POST", `${task(key)}/run/retry`),

  ptyUrl: (id: string) => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/sessions/${id}/pty?token=${encodeURIComponent(token)}`;
  },
};
