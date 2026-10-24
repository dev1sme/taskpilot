import { call } from "../../../shared/api/http";
import type { McpConfig, McpEntryInput, McpEntryForm, McpPreview, McpCheck } from "./types";
import type { Scope, SaveResult } from "../shared/types";
import type { ConfigCli } from "../../../shared/router";

const query = (cli: ConfigCli) => `cli=${encodeURIComponent(cli)}`;

export const mcpApi = {
  mcp: (cli: ConfigCli) => call<McpConfig>("GET", `/api/config/mcp?${query(cli)}`),
  mcpEntry: (cli: ConfigCli, scope: Scope, name: string) => call<McpEntryForm>("GET", `/api/config/mcp/${scope}/${encodeURIComponent(name)}?${query(cli)}`),
  mcpAddHash: (scope: Scope, cli: ConfigCli = "claude") => call<{ hash: string }>("GET", `/api/config/mcp/${scope}?${query(cli)}`),
  mcpPreview: (cli: ConfigCli, scope: Scope, entry: McpEntryInput, baseHash: string) => call<McpPreview>("POST", `/api/config/mcp/${scope}/preview?${query(cli)}`, { ...entry, baseHash }),
  mcpSave: (cli: ConfigCli, scope: Scope, entry: McpEntryInput, baseHash: string) => call<SaveResult>("PUT", `/api/config/mcp/${scope}?${query(cli)}`, { ...entry, baseHash }),
  mcpDelete: (cli: ConfigCli, scope: Scope, name: string, baseHash: string) =>
    call<SaveResult>("DELETE", `/api/config/mcp/${scope}/${encodeURIComponent(name)}?${query(cli)}&baseHash=${encodeURIComponent(baseHash)}`),
  mcpCheck: (cli: ConfigCli, name: string) => call<McpCheck>("POST", `/api/config/mcp/check/${encodeURIComponent(name)}?${query(cli)}`, {}),
  envKeys: () => call<Array<{ key: string }>>("GET", "/api/env"),
  envSet: (key: string, value: string) => call<{ ok: true }>("PUT", `/api/env/${encodeURIComponent(key)}`, { value }),
};
