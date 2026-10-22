import { call } from "../../../shared/api/http";
import type { McpConfig, McpEntryInput, McpEntryForm, McpPreview, McpCheck } from "./types";
import type { Scope, SaveResult } from "../shared/types";

export const mcpApi = {
  mcp: () => call<McpConfig>("GET", "/api/config/mcp"),
  mcpEntry: (scope: Scope, name: string) => call<McpEntryForm>("GET", `/api/config/mcp/${scope}/${encodeURIComponent(name)}`),
  mcpAddHash: (scope: Scope) => call<{ hash: string }>("GET", `/api/config/mcp/${scope}`),
  mcpPreview: (scope: Scope, entry: McpEntryInput, baseHash: string) => call<McpPreview>("POST", `/api/config/mcp/${scope}/preview`, { ...entry, baseHash }),
  mcpSave: (scope: Scope, entry: McpEntryInput, baseHash: string) => call<SaveResult>("PUT", `/api/config/mcp/${scope}`, { ...entry, baseHash }),
  mcpDelete: (scope: Scope, name: string, baseHash: string) => call<SaveResult>("DELETE", `/api/config/mcp/${scope}/${encodeURIComponent(name)}?baseHash=${baseHash}`),
  mcpCheck: (name: string) => call<McpCheck>("POST", `/api/config/mcp/check/${encodeURIComponent(name)}`, {}),
  envKeys: () => call<Array<{ key: string }>>("GET", "/api/env"),
  envSet: (key: string, value: string) => call<{ ok: true }>("PUT", `/api/env/${encodeURIComponent(key)}`, { value }),
};
