import { existsSync } from "node:fs";
import path from "node:path";
import { claudeHome, displayPath } from "./fs.js";
import { HttpError } from "../core/errors.js";
import type { LibraryKind, LibraryScope } from "./library.js";
import type { MemoryScope } from "./memory.js";
import type { SettingsScope } from "./settings.js";
import { t } from "../core/i18n.js";

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

export function memoryTarget(repo: string, scope: MemoryScope): FileTarget {
  const abs = {
    project: projectMemoryFiles(repo).main,
    local: path.join(repo, "CLAUDE.local.md"),
    user: path.join(claudeHome(), "CLAUDE.md"),
  }[scope];
  return { abs, display: displayPath(abs, repo) };
}

export function settingsTarget(repo: string, scope: SettingsScope): FileTarget {
  const abs = {
    project: path.join(repo, ".claude", "settings.json"),
    local: path.join(repo, ".claude", "settings.local.json"),
    user: path.join(claudeHome(), "settings.json"),
  }[scope];
  return { abs, display: displayPath(abs, repo) };
}

const LIBRARY_REL: Record<LibraryKind, RegExp> = {
  agents: /^(?:[A-Za-z0-9][\w-]*\/){0,2}[A-Za-z0-9][\w-]*\.md$/,
  commands: /^(?:[A-Za-z0-9][\w-]*\/){0,2}[A-Za-z0-9][\w-]*\.md$/,
  skills: /^[A-Za-z0-9][\w-]*\/SKILL\.md$/,
};

/** An agent, command or skill file; `rel` must match the kind's naming (no "..", no other files). */
export function libraryTarget(repo: string, kind: LibraryKind, scope: LibraryScope, rel: string): FileTarget {
  if (!LIBRARY_REL[kind].test(rel)) throw new HttpError(400, t("errors.invalidName", { name: rel }));
  const root = scope === "project" ? path.join(repo, ".claude", kind) : path.join(claudeHome(), kind);
  const abs = path.join(root, ...rel.split("/"));
  return { abs, display: displayPath(abs, repo) };
}

/**
 * The only files TaskPilot ever writes: Claude Code config of this repo and of the user.
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
    // ~/.claude.json is never written directly: Claude Code rewrites it constantly; MCP entries
    // there are changed through `claude mcp add-json/remove`.
  ].map((x) => path.resolve(x));
  if (exact.includes(p)) return true;
  // Anything inside the agents/commands/skills folders (skills also hold scripts and templates).
  const roots = LIBRARY_DIRS.flatMap((d) => [path.join(repo, ".claude", d), path.join(claudeHome(), d)]);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), p);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}
