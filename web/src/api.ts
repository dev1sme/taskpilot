export type Stage = "new" | "investigated" | "planned" | "implementing" | "summarized";

export interface TaskFile {
  path: string;
  size: number;
  mtime: number;
}

export interface TaskSummary {
  key: string;
  title: string;
  stage: Stage;
  specFiles: TaskFile[];
  outputFiles: TaskFile[];
  updatedAt: number;
  run: { phase: RunPhase; stepIndex: number } | null;
  waitingPermission: boolean;
}

export type RunPhase = "starting" | "running" | "waiting" | "gate" | "interrupted" | "done" | "cancelled";

export interface RunState {
  taskKey: string;
  sessionId: string;
  stepIndex: number;
  phase: RunPhase;
  message: string;
  startedAt: number;
  updatedAt: number;
}

export interface RunView {
  workflow: {
    source: string;
    steps: Array<{ id: string; title: string; gate: "approve" | "none"; doneFile: string | null }>;
  };
  run: RunState | null;
}

export interface SessionView {
  id: string;
  taskKey: string;
  title: string;
  createdAt: number;
  status: "running" | "exited";
  exitCode: number | null;
  activity: "starting" | "idle" | "busy" | "permission" | null;
}

export interface RepoInfo {
  path: string | null;
  tasksDir: string | null;
  tasksDirExists: boolean;
}

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

export const api = {
  repo: () => call<RepoInfo>("GET", "/api/repo"),
  setRepo: (path: string) => call<RepoInfo>("PUT", "/api/repo", { path }),
  tasks: () => call<TaskSummary[]>("GET", "/api/tasks"),
  file: (key: string, path: string) =>
    call<{ path: string; content: string }>(
      "GET",
      `/api/tasks/${encodeURIComponent(key)}/file?path=${encodeURIComponent(path)}`,
    ),
  sessions: (key: string) => call<SessionView[]>("GET", `/api/tasks/${encodeURIComponent(key)}/sessions`),
  createSession: (key: string) => call<SessionView>("POST", `/api/tasks/${encodeURIComponent(key)}/sessions`),
  resumeSession: (id: string) => call<SessionView>("POST", `/api/sessions/${id}/resume`),
  stopSession: (id: string) => call<{ ok: true }>("POST", `/api/sessions/${id}/stop`),
  forgetSession: (id: string) => call<{ ok: true }>("DELETE", `/api/sessions/${id}`),
  run: (key: string) => call<RunView>("GET", `/api/tasks/${encodeURIComponent(key)}/run`),
  startRun: (key: string) => call<RunState>("POST", `/api/tasks/${encodeURIComponent(key)}/run`),
  cancelRun: (key: string) => call<RunState>("DELETE", `/api/tasks/${encodeURIComponent(key)}/run`),
  approve: (key: string) => call<RunState>("POST", `/api/tasks/${encodeURIComponent(key)}/run/approve`),
  feedback: (key: string, text: string) =>
    call<RunState>("POST", `/api/tasks/${encodeURIComponent(key)}/run/feedback`, { text }),
  retry: (key: string) => call<RunState>("POST", `/api/tasks/${encodeURIComponent(key)}/run/retry`),
  ptyUrl: (id: string) => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/sessions/${id}/pty?token=${encodeURIComponent(token)}`;
  },
};

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;

/** One shared EventSource for the page; returns an unsubscribe function. */
export function onServerEvent(event: string, fn: Listener): () => void {
  if (!source) source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
    source.addEventListener(event, (e) => {
      const data: unknown = JSON.parse((e as MessageEvent<string>).data);
      for (const l of listeners.get(event) ?? []) l(data);
    });
  }
  set.add(fn);
  return () => set.delete(fn);
}
