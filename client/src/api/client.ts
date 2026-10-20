import type {
  ActivityItem,
  AuthStatus,
  BackupEntry,
  CodegraphStatus,
  HooksFile,
  HookInput,
  McpCheck,
  McpEntryForm,
  McpEntryInput,
  McpPreview,
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
  UsageView,
  SettingsFile,
  TaskSummary,
} from "./types";

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
async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
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

const task = (key: string) => `/api/tasks/${encodeURIComponent(key)}`;

export const api = {
  auth: () => call<AuthStatus>("GET", "/api/auth"),
  login: (body: { user: string; password: string } | { token: string }) => call<{ ok: true }>("POST", "/api/login", body),
  logout: () => call<{ ok: true }>("POST", "/api/logout"),

  info: () => call<Info>("GET", "/api/info"),
  inventory: () => call<Inventory>("GET", "/api/inventory"),
  memory: () => call<MemoryFile[]>("GET", "/api/config/memory"),
  settings: () => call<SettingsFile[]>("GET", "/api/config/settings"),
  hooks: () => call<HookEntry[]>("GET", "/api/config/hooks"),
  library: (kind: LibraryKind) => call<LibraryItem[]>("GET", `/api/config/${kind}`),
  mcp: () => call<McpConfig>("GET", "/api/config/mcp"),
  codegraph: () => call<CodegraphStatus>("GET", "/api/config/codegraph"),
  codegraphIndex: () => call<{ ok: true; output: string }>("POST", "/api/config/codegraph/index", {}),

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
  hooksFile: (scope: Scope) => call<HooksFile>("GET", `/api/config/settings/${scope}/hooks`),
  hooksPreview: (scope: Scope, hooks: HookInput[], baseHash: string) =>
    call<Preview>("POST", `/api/config/settings/${scope}/hooks/preview`, { hooks, baseHash }),
  hooksSave: (scope: Scope, hooks: HookInput[], baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/settings/${scope}/hooks`, { hooks, baseHash }),

  libraryRaw: (kind: LibraryKind, scope: Scope, rel: string) =>
    call<RawFile>("GET", `/api/config/library/${kind}/${scope}/raw?rel=${encodeURIComponent(rel)}`),
  libraryPreview: (kind: LibraryKind, scope: Scope, rel: string, content: string, baseHash: string) =>
    call<Preview>("POST", `/api/config/library/${kind}/${scope}/preview`, { rel, content, baseHash }),
  librarySave: (kind: LibraryKind, scope: Scope, rel: string, content: string, baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/library/${kind}/${scope}`, { rel, content, baseHash }),
  libraryDelete: (kind: LibraryKind, scope: Scope, rel: string, baseHash: string) =>
    call<SaveResult>("DELETE", `/api/config/library/${kind}/${scope}?rel=${encodeURIComponent(rel)}&baseHash=${baseHash}`),

  mcpEntry: (scope: Scope, name: string) => call<McpEntryForm>("GET", `/api/config/mcp/${scope}/${encodeURIComponent(name)}`),
  mcpAddHash: (scope: Scope) => call<{ hash: string }>("GET", `/api/config/mcp/${scope}`),
  mcpPreview: (scope: Scope, entry: McpEntryInput, baseHash: string) =>
    call<McpPreview>("POST", `/api/config/mcp/${scope}/preview`, { ...entry, baseHash }),
  mcpSave: (scope: Scope, entry: McpEntryInput, baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/mcp/${scope}`, { ...entry, baseHash }),
  mcpDelete: (scope: Scope, name: string, baseHash: string) =>
    call<SaveResult>("DELETE", `/api/config/mcp/${scope}/${encodeURIComponent(name)}?baseHash=${baseHash}`),
  mcpCheck: (name: string) => call<McpCheck>("POST", `/api/config/mcp/check/${encodeURIComponent(name)}`, {}),
  envKeys: () => call<Array<{ key: string }>>("GET", "/api/env"),
  envSet: (key: string, value: string) => call<{ ok: true }>("PUT", `/api/env/${encodeURIComponent(key)}`, { value }),

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
  repoSessions: () => call<SessionView[]>("GET", "/api/repo/sessions"),
  createRepoSession: () => call<SessionView>("POST", "/api/repo/sessions"),
  usage: () => call<UsageView | null>("GET", "/api/usage"),

  run: (key: string) => call<RunView>("GET", `${task(key)}/run`),
  startRun: (key: string) => call<RunState>("POST", `${task(key)}/run`),
  cancelRun: (key: string) => call<RunState>("DELETE", `${task(key)}/run`),
  approve: (key: string) => call<RunState>("POST", `${task(key)}/run/approve`),
  feedback: (key: string, text: string) => call<RunState>("POST", `${task(key)}/run/feedback`, { text }),
  retry: (key: string) => call<RunState>("POST", `${task(key)}/run/retry`),
  restartRun: (key: string) => call<RunState>("POST", `${task(key)}/run/restart`),

  ptyUrl: (id: string) => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/sessions/${id}/pty`;
  },
};
