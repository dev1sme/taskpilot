import path from "node:path";
import { type ProviderId } from "@taskpilot/shared";
import type { ConfigScope, ConfigSection } from "../shared/sections.js";
import type { LibraryKind } from "../library/read.js";
import { claudeConfig } from "./claude.js";
import { codexConfig } from "./codex.js";
import { copilotConfig } from "./copilot.js";
import { PLAIN_JSON } from "./file-names.js";
import type { ConfigAdapter } from "./types.js";

export type * from "./types.js";
export { projectMemoryFiles } from "./claude.js";

export const CONFIG_ADAPTERS: Record<ProviderId, ConfigAdapter> = { claude: claudeConfig, codex: codexConfig, copilot: copilotConfig };

export function configAdapter(cli: ProviderId): ConfigAdapter {
  return CONFIG_ADAPTERS[cli];
}

/** The scopes a CLI has for a section; null when it has no such section. */
export function sectionScopes(adapter: ConfigAdapter, section: ConfigSection): ConfigScope[] | null {
  switch (section) {
    case "memory":
      return adapter.memory.scopes;
    case "settings":
      return adapter.settings.scopes;
    case "hooks":
      return !adapter.hooks ? null : adapter.hooks.kind === "settings" ? adapter.settings.scopes : adapter.hooks.scopes;
    case "mcp":
      return adapter.mcp.scopes;
    default:
      return adapter.library[section as LibraryKind]?.scopes ?? null;
  }
}

/** Whether a resolved path lies strictly inside `root`. */
function inside(root: string, p: string): boolean {
  const rel = path.relative(path.resolve(root), p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * The native config files a CLI's adapter may write: its memory, settings and MCP files, hook sets
 * and library items. Library roots that are only shown (another CLI's folder) are not included.
 */
export function ownsPath(adapter: ConfigAdapter, repo: string, abs: string): boolean {
  const p = path.resolve(abs);
  const mcp = adapter.mcp;
  const files = [
    ...adapter.memory.scopes.map((scope) => adapter.memory.file(repo, scope)),
    ...(adapter.memory.projectFiles?.(repo) ?? []),
    ...adapter.settings.scopes.map((scope) => adapter.settings.file(repo, scope)),
    ...(mcp.kind === "claude" ? [mcp.projectFile(repo)] : mcp.scopes.map((scope) => mcp.file(repo, scope))),
  ];
  if (files.some((file) => path.resolve(file) === p)) return true;
  const hooks = adapter.hooks;
  if (hooks?.kind === "files" && hooks.scopes.some((scope) => path.dirname(p) === path.resolve(hooks.dir(repo, scope))) && PLAIN_JSON.test(path.basename(p))) return true;
  for (const library of Object.values(adapter.library)) {
    for (const root of library.roots(repo)) {
      if (!root.editable || !inside(root.dir, p)) continue;
      if (library.ownsTree || library.relOk(root.scope, path.relative(path.resolve(root.dir), p).split(path.sep).join("/"))) return true;
    }
  }
  return false;
}
