import { existsSync } from "node:fs";
import path from "node:path";
import { claudeHome } from "../../../core/claude/home.js";
import { codexConfigHome, codexSkillsHome } from "../../../core/codex/home.js";
import { copilotConfigHome } from "../../../core/copilot/home.js";
import { displayPath } from "./fs.js";
import { requireConfigScope, type ConfigScope } from "./provider-capabilities.js";
import { type ProviderId } from "../../../core/providers.js";
import { HttpError } from "../../../core/errors.js";
import { overrideDir, PROMPT_FILE, SETTINGS_FILE, WORKFLOW_FILE } from "../../workflow/index.js";
import type { LibraryKind, LibraryScope } from "../library/read.js";
import type { MemoryScope } from "../memory/read.js";
import type { SettingsScope } from "../settings/read.js";
import { t } from "../../../core/i18n.js";

/** A config file TaskPilot may write. */
export interface FileTarget {
  abs: string;
  display: string;
}

const LIBRARY_DIRS = ["agents", "commands", "skills"];

/**
 * The project CLAUDE.md: Claude Code reads both ./CLAUDE.md and ./.claude/CLAUDE.md. TaskPilot
 * shows and edits ./CLAUDE.md, or .claude/CLAUDE.md when that is the only one.
 */
export function projectMemoryFiles(repo: string): { main: string; other: string | null } {
  const root = path.join(repo, "CLAUDE.md");
  const dotClaude = path.join(repo, ".claude", "CLAUDE.md");
  if (existsSync(root)) return { main: root, other: existsSync(dotClaude) ? dotClaude : null };
  return { main: existsSync(dotClaude) ? dotClaude : root, other: null };
}

export function memoryTarget(repo: string, scope: MemoryScope, cli: ProviderId = "claude"): FileTarget {
  requireConfigScope(cli, "memory", scope);
  const abs =
    cli === "claude"
      ? {
          project: projectMemoryFiles(repo).main,
          local: path.join(repo, "CLAUDE.local.md"),
          user: path.join(claudeHome(), "CLAUDE.md"),
        }[scope]
      : cli === "codex"
        ? {
            project: path.join(repo, "AGENTS.md"),
            local: "",
            user: path.join(codexConfigHome(), "AGENTS.md"),
          }[scope]
        : {
            project: path.join(repo, ".github", "copilot-instructions.md"),
            local: "",
            user: path.join(copilotConfigHome(), "copilot-instructions.md"),
          }[scope];
  return { abs, display: displayPath(abs, repo) };
}

export function settingsTarget(repo: string, scope: SettingsScope, cli: ProviderId = "claude"): FileTarget {
  requireConfigScope(cli, "settings", scope);
  const abs =
    cli === "claude"
      ? {
          project: path.join(repo, ".claude", "settings.json"),
          local: path.join(repo, ".claude", "settings.local.json"),
          user: path.join(claudeHome(), "settings.json"),
        }[scope]
      : cli === "codex"
        ? {
            project: path.join(repo, ".codex", "config.toml"),
            local: "",
            user: path.join(codexConfigHome(), "config.toml"),
          }[scope]
        : {
            project: path.join(repo, ".github", "copilot", "settings.json"),
            local: path.join(repo, ".github", "copilot", "settings.local.json"),
            user: path.join(copilotConfigHome(), "settings.json"),
          }[scope];
  return { abs, display: displayPath(abs, repo) };
}

const SKILL_REL = /^[A-Za-z0-9][\w-]*\/SKILL\.md$/;

/** Agents and commands: any depth, any characters in a segment except the ones that escape the folder. */
function isMarkdownRel(rel: string): boolean {
  const segments = rel.split("/");
  const ok = segments.every((s) => s !== "" && s !== "." && s !== ".." && !/[\\\u0000-\u001f\u007f]/.test(s));
  const last = segments[segments.length - 1];
  return ok && last.endsWith(".md") && last.length > ".md".length;
}

const LIBRARY_REL: Record<LibraryKind, (rel: string) => boolean> = {
  agents: isMarkdownRel,
  commands: isMarkdownRel,
  skills: (rel) => SKILL_REL.test(rel),
};

/** An agent, command or skill file; `rel` must match the kind's naming (no "..", no other files). */
export function libraryTarget(repo: string, kind: LibraryKind, scope: LibraryScope, rel: string, cli: ProviderId = "claude"): FileTarget {
  requireConfigScope(cli, kind, scope);
  if (cli === "codex" && kind === "agents") {
    if (scope !== "project") throw new HttpError(400, t("configMessages.shared_targets_01", { value0: scope }));
    return codexAgentTarget(repo, rel);
  }
  if (cli === "copilot" && kind === "agents") {
    const pattern = scope === "project" ? /^[A-Za-z0-9][\w.-]*\.(?:agent\.)?md$/ : /^[A-Za-z0-9][\w.-]*\.agent\.md$/;
    if (!pattern.test(rel)) throw new HttpError(400, t("errors.invalidName", { name: rel }));
    const root = scope === "project" ? path.join(repo, ".github", "agents") : path.join(copilotConfigHome(), "agents");
    const abs = path.join(root, rel);
    return { abs, display: displayPath(abs, repo) };
  }
  if (cli !== "claude" && kind === "skills") {
    if (!SKILL_REL.test(rel)) throw new HttpError(400, t("errors.invalidName", { name: rel }));
    const root =
      cli === "codex"
        ? scope === "project"
          ? path.join(repo, ".agents", "skills")
          : codexSkillsHome()
        : scope === "project"
          ? path.join(repo, ".github", "skills")
          : path.join(copilotConfigHome(), "skills");
    const abs = path.join(root, ...rel.split("/"));
    return { abs, display: displayPath(abs, repo) };
  }
  if (!LIBRARY_REL[kind](rel)) throw new HttpError(400, t("errors.invalidName", { name: rel }));
  const root = scope === "project" ? path.join(repo, ".claude", kind) : path.join(claudeHome(), kind);
  const abs = path.join(root, ...rel.split("/"));
  return { abs, display: displayPath(abs, repo) };
}

/** A Codex custom agent: <repo>/.codex/agents/<name>.toml, directly in the folder. */
export function codexAgentTarget(repo: string, rel: string): FileTarget {
  if (!/^[A-Za-z0-9][\w.-]*\.toml$/.test(rel)) throw new HttpError(400, t("errors.invalidName", { name: rel }));
  const abs = path.join(repo, ".codex", "agents", rel);
  return { abs, display: displayPath(abs, repo) };
}

/** Native hook JSON files; Claude hooks live inside settings.json and use settingsTarget. */
export function hookTarget(repo: string, scope: ConfigScope, rel: string, cli: ProviderId): FileTarget {
  requireConfigScope(cli, "hooks", scope);
  if (cli !== "copilot" || !/^[A-Za-z0-9][\w.-]*\.json$/.test(rel)) throw new HttpError(400, t("errors.invalidName", { name: rel }));
  const root = scope === "project" ? path.join(repo, ".github", "hooks") : path.join(copilotConfigHome(), "hooks");
  const abs = path.join(root, rel);
  return { abs, display: displayPath(abs, repo) };
}

/** Native MCP container. Codex stores its MCP table in config.toml. */
export function mcpTarget(repo: string, scope: ConfigScope, cli: ProviderId = "claude"): FileTarget {
  requireConfigScope(cli, "mcp", scope);
  if (cli === "codex") return settingsTarget(repo, scope as SettingsScope, cli);
  if (cli === "claude" && scope !== "project") throw new HttpError(400, t("configMessages.shared_targets_02"));
  const abs = cli === "claude" ? path.join(repo, ".mcp.json") : scope === "project" ? path.join(repo, ".github", "mcp.json") : path.join(copilotConfigHome(), "mcp-config.json");
  return { abs, display: displayPath(abs, repo) };
}

/** A file of the repo's workflow override: workflow.yml or a prompt next to it. */
export function workflowTarget(repo: string, name: string): FileTarget {
  if (!isWorkflowFileName(name)) throw new HttpError(400, t("errors.invalidName", { name }));
  const abs = path.join(overrideDir(repo), name);
  return { abs, display: displayPath(abs, repo) };
}

/** The repo's settings.yml (its chosen workflow mode), next to the override. */
export function repoSettingsTarget(repo: string): FileTarget {
  const abs = path.join(overrideDir(repo), SETTINGS_FILE);
  return { abs, display: displayPath(abs, repo) };
}

const isWorkflowFileName = (name: string) => name === WORKFLOW_FILE || PROMPT_FILE.test(name);

/**
 * The only files TaskPilot ever writes: native CLI config of this repo and of the user.
 * Checked again on every write and restore, so a crafted request or backup cannot reach elsewhere.
 */
export function isAllowedPath(abs: string, repo: string): boolean {
  const p = path.resolve(abs);
  const exact = [
    path.join(repo, "CLAUDE.md"),
    path.join(repo, ".claude", "CLAUDE.md"),
    path.join(repo, "CLAUDE.local.md"),
    path.join(repo, ".claude", "settings.json"),
    path.join(repo, ".claude", "settings.local.json"),
    path.join(repo, ".mcp.json"),
    path.join(claudeHome(), "CLAUDE.md"),
    path.join(claudeHome(), "settings.json"),
    path.join(repo, "AGENTS.md"),
    path.join(codexConfigHome(), "AGENTS.md"),
    path.join(repo, ".codex", "config.toml"),
    path.join(codexConfigHome(), "config.toml"),
    path.join(repo, ".github", "copilot-instructions.md"),
    path.join(copilotConfigHome(), "copilot-instructions.md"),
    path.join(repo, ".github", "copilot", "settings.json"),
    path.join(repo, ".github", "copilot", "settings.local.json"),
    path.join(copilotConfigHome(), "settings.json"),
    path.join(repo, ".github", "mcp.json"),
    path.join(copilotConfigHome(), "mcp-config.json"),
    // ~/.claude.json is never written directly: Claude Code rewrites it constantly; MCP entries
    // there are changed through `claude mcp add-json/remove`.
  ].map((x) => path.resolve(x));
  if (exact.includes(p)) return true;
  // The workflow override and settings.yml: files directly in .taskpilot/, never TaskPilot's own workflows/default/.
  if (path.dirname(p) === path.resolve(overrideDir(repo)) && (isWorkflowFileName(path.basename(p)) || path.basename(p) === SETTINGS_FILE)) return true;
  if (path.dirname(p) === path.resolve(repo, ".codex", "agents") && /^[A-Za-z0-9][\w.-]*\.toml$/.test(path.basename(p))) return true;
  if (
    [path.join(repo, ".github", "hooks"), path.join(copilotConfigHome(), "hooks")].some((root) => path.dirname(p) === path.resolve(root)) &&
    /^[A-Za-z0-9][\w.-]*\.json$/.test(path.basename(p))
  )
    return true;
  if (path.dirname(p) === path.resolve(repo, ".github", "agents") && /^[A-Za-z0-9][\w.-]*\.(?:agent\.)?md$/.test(path.basename(p))) return true;
  if (path.dirname(p) === path.resolve(copilotConfigHome(), "agents") && /^[A-Za-z0-9][\w.-]*\.agent\.md$/.test(path.basename(p))) return true;
  for (const root of [path.join(repo, ".agents", "skills"), codexSkillsHome(), path.join(repo, ".github", "skills"), path.join(copilotConfigHome(), "skills")]) {
    const rel = path.relative(path.resolve(root), p).split(path.sep).join("/");
    if (SKILL_REL.test(rel)) return true;
  }
  // Anything inside the agents/commands/skills folders (skills also hold scripts and templates).
  const roots = LIBRARY_DIRS.flatMap((d) => [path.join(repo, ".claude", d), path.join(claudeHome(), d)]);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), p);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}
