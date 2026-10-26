import { call } from "../../../shared/api/http";
import type { McpConfig, McpEntryInput, McpEntryForm, McpPreview, McpCheck } from "./types";
import type { Scope, SaveResult } from "../shared/types";
import type { ProviderId } from "../../../shared/providers";

const query = (cli: ProviderId) => `cli=${encodeURIComponent(cli)}`;

export const mcpApi = {
  mcp: (cli: ProviderId) => call<McpConfig>("GET", `/api/config/mcp?${query(cli)}`),
  mcpEntry: (cli: ProviderId, scope: Scope, name: string) => call<McpEntryForm>("GET", `/api/config/mcp/${scope}/${encodeURIComponent(name)}?${query(cli)}`),
  mcpAddHash: (scope: Scope, cli: ProviderId = "claude") => call<{ hash: string }>("GET", `/api/config/mcp/${scope}?${query(cli)}`),
  mcpPreview: (cli: ProviderId, scope: Scope, entry: McpEntryInput, baseHash: string) => call<McpPreview>("POST", `/api/config/mcp/${scope}/preview?${query(cli)}`, { ...entry, baseHash }),
  mcpSave: (cli: ProviderId, scope: Scope, entry: McpEntryInput, baseHash: string) => call<SaveResult>("PUT", `/api/config/mcp/${scope}?${query(cli)}`, { ...entry, baseHash }),
  mcpDelete: (cli: ProviderId, scope: Scope, name: string, baseHash: string) =>
    call<SaveResult>("DELETE", `/api/config/mcp/${scope}/${encodeURIComponent(name)}?${query(cli)}&baseHash=${encodeURIComponent(baseHash)}`),
  mcpCheck: (cli: ProviderId, name: string) => call<McpCheck>("POST", `/api/config/mcp/check/${encodeURIComponent(name)}?${query(cli)}`, {}),
  envKeys: () => call<Array<{ key: string }>>("GET", "/api/env"),
  envSet: (key: string, value: string) => call<{ ok: true }>("PUT", `/api/env/${encodeURIComponent(key)}`, { value }),
};
