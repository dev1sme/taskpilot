import type {
  ActivityItem,
  BackupEntry,
  Permissions,
  PermissionsFile,
  Preview,
  RawFile,
  SaveResult,
  HookEntry,
  Info,
  Inventory,
  LibraryItem,
  LibraryKind,
  McpConfig,
  MemoryFile,
  RepoInfo,
  RunState,
  RunView,
  Scope,
  SessionView,
  SettingsFile,
  TaskSummary,
} from "./types";

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
  memory: () => call<MemoryFile[]>("GET", "/api/config/memory"),
  settings: () => call<SettingsFile[]>("GET", "/api/config/settings"),
  hooks: () => call<HookEntry[]>("GET", "/api/config/hooks"),
  library: (kind: LibraryKind) => call<LibraryItem[]>("GET", `/api/config/${kind}`),
  mcp: () => call<McpConfig>("GET", "/api/config/mcp"),

  memoryRaw: (scope: Scope) => call<RawFile>("GET", `/api/config/memory/${scope}/raw`),
  memoryPreview: (scope: Scope, content: string, baseHash: string) =>
    call<Preview>("POST", `/api/config/memory/${scope}/preview`, { content, baseHash }),
  memorySave: (scope: Scope, content: string, baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/memory/${scope}`, { content, baseHash }),
  permissions: (scope: Scope) => call<PermissionsFile>("GET", `/api/config/settings/${scope}/permissions`),
  permissionsPreview: (scope: Scope, p: Permissions, baseHash: string) =>
    call<Preview>("POST", `/api/config/settings/${scope}/permissions/preview`, { ...p, baseHash }),
  permissionsSave: (scope: Scope, p: Permissions, baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/settings/${scope}/permissions`, { ...p, baseHash }),
  backups: () => call<BackupEntry[]>("GET", "/api/backups"),
  backupDiff: (id: string) => call<{ diff: string; entry: BackupEntry }>("GET", `/api/backups/${id}/diff`),
  restoreBackup: (id: string) => call<SaveResult>("POST", `/api/backups/${id}/restore`, {}),
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
