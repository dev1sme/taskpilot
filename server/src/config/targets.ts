import path from "node:path";
import { claudeHome, claudeJson, displayPath } from "./fs.js";
import type { MemoryScope } from "./memory.js";
import type { SettingsScope } from "./settings.js";

/** A config file TaskPilot may write. */
export interface FileTarget {
  abs: string;
  display: string;
}

const LIBRARY_DIRS = ["agents", "commands", "skills"];

export function memoryTarget(repo: string, scope: MemoryScope): FileTarget {
  const abs = {
    project: path.join(repo, "CLAUDE.md"),
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

/**
 * The only files TaskPilot ever writes: Claude Code config of this repo and of the user.
 * Checked again on every write and restore, so a crafted request or backup cannot reach elsewhere.
 */
export function isAllowedPath(abs: string, repo: string): boolean {
  const p = path.resolve(abs);
  const exact = [
    path.join(repo, "CLAUDE.md"),
    path.join(repo, "CLAUDE.local.md"),
    path.join(repo, ".claude", "settings.json"),
    path.join(repo, ".claude", "settings.local.json"),
    path.join(repo, ".mcp.json"),
    path.join(claudeHome(), "CLAUDE.md"),
    path.join(claudeHome(), "settings.json"),
    claudeJson(),
  ].map((x) => path.resolve(x));
  if (exact.includes(p)) return true;
  // Anything inside the agents/commands/skills folders (skills also hold scripts and templates).
  const roots = LIBRARY_DIRS.flatMap((d) => [path.join(repo, ".claude", d), path.join(claudeHome(), d)]);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), p);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}
