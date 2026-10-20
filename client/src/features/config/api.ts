import { call } from "../../shared/api/http";
import type { BackupEntry, CodegraphStatus, HookEntry, HookInput, HooksFile, LibraryItem, LibraryKind, McpCheck, McpConfig, McpEntryForm, McpEntryInput, McpPreview, MemoryFile, Permissions, PermissionsFile, Preview, RawFile, SaveResult, Scope, SettingsFile } from "./types";

export const configApi = {
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
};
