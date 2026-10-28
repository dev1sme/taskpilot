import path from "node:path";
import { displayPath } from "./fs.js";
import { requireConfigScope, type ConfigScope } from "./provider-capabilities.js";
import { type ProviderId } from "../../../core/providers.js";
import { HttpError } from "../../../core/errors.js";
import { overrideDir, PROMPT_FILE, SETTINGS_FILE, WORKFLOW_FILE } from "../../workflow/index.js";
import { CONFIG_ADAPTERS, configAdapter, ownsPath } from "../adapters/index.js";
import { PLAIN_JSON } from "../adapters/names.js";
import type { LibraryKind, LibraryScope } from "../library/read.js";
import { t } from "../../../core/i18n.js";

export { projectMemoryFiles } from "../adapters/index.js";

/** A config file TaskPilot may write. */
export interface FileTarget {
  abs: string;
  display: string;
}

const target = (abs: string, repo: string): FileTarget => ({ abs, display: displayPath(abs, repo) });

export function memoryTarget(repo: string, scope: ConfigScope, cli: ProviderId = "claude"): FileTarget {
  requireConfigScope(cli, "memory", scope);
  return target(configAdapter(cli).memory.file(repo, scope), repo);
}

export function settingsTarget(repo: string, scope: ConfigScope, cli: ProviderId = "claude"): FileTarget {
  requireConfigScope(cli, "settings", scope);
  return target(configAdapter(cli).settings.file(repo, scope), repo);
}

/** An agent, command or skill file; `rel` must match the kind's naming (no "..", no other files). */
export function libraryTarget(repo: string, kind: LibraryKind, scope: LibraryScope, rel: string, cli: ProviderId = "claude"): FileTarget {
  requireConfigScope(cli, kind, scope);
  const library = configAdapter(cli).library[kind]!;
  const root = library.roots(repo).find((r) => r.scope === scope && r.editable)!;
  if (!library.relOk(scope, rel)) throw new HttpError(400, t("errors.invalidName", { name: rel }));
  return target(path.join(root.dir, ...rel.split("/")), repo);
}

/** A hook set of a CLI that keeps hooks in their own JSON files. */
export function hookTarget(repo: string, scope: ConfigScope, rel: string, cli: ProviderId): FileTarget {
  requireConfigScope(cli, "hooks", scope);
  const hooks = configAdapter(cli).hooks;
  if (hooks?.kind !== "files" || !PLAIN_JSON.test(rel)) throw new HttpError(400, t("errors.invalidName", { name: rel }));
  return target(path.join(hooks.dir(repo, scope), rel), repo);
}

/** The file that holds a scope's MCP servers; Claude's are in .mcp.json (project) or changed through `claude mcp`. */
export function mcpTarget(repo: string, scope: ConfigScope, cli: ProviderId = "claude"): FileTarget {
  requireConfigScope(cli, "mcp", scope);
  const mcp = configAdapter(cli).mcp;
  if (mcp.kind === "claude") {
    if (scope !== "project") throw new HttpError(400, t("configMessages.shared_targets_02"));
    return target(mcp.projectFile(repo), repo);
  }
  return target(mcp.file(repo, scope), repo);
}

/** A file of the repo's workflow override: workflow.yml or a prompt next to it. */
export function workflowTarget(repo: string, name: string): FileTarget {
  if (!isWorkflowFileName(name)) throw new HttpError(400, t("errors.invalidName", { name }));
  return target(path.join(overrideDir(repo), name), repo);
}

/** The repo's settings.yml (its chosen workflow mode), next to the override. */
export function repoSettingsTarget(repo: string): FileTarget {
  return target(path.join(overrideDir(repo), SETTINGS_FILE), repo);
}

const isWorkflowFileName = (name: string) => name === WORKFLOW_FILE || PROMPT_FILE.test(name);

/**
 * The only files TaskPilot ever writes: native CLI config of this repo and of the user, as the
 * adapters lay it out, and the workflow override. Checked again on every write and restore, so a
 * crafted request or backup cannot reach elsewhere. ~/.claude.json is never written directly:
 * Claude Code rewrites it constantly; MCP entries there change through `claude mcp`.
 */
export function isAllowedPath(abs: string, repo: string): boolean {
  const p = path.resolve(abs);
  // The workflow override and settings.yml: files directly in .taskpilot/, never TaskPilot's own workflows/default/.
  if (path.dirname(p) === path.resolve(overrideDir(repo)) && (isWorkflowFileName(path.basename(p)) || path.basename(p) === SETTINGS_FILE)) return true;
  return Object.values(CONFIG_ADAPTERS).some((adapter) => ownsPath(adapter, repo, p));
}
