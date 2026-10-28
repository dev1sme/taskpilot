import { existsSync } from "node:fs";
import path from "node:path";
import { claudeHome } from "../../../providers/claude/home.js";
import { isMarkdownRel, SKILL_REL } from "./names.js";
import type { ConfigAdapter, LibraryAdapter } from "./types.js";
import type { LibraryKind } from "../library/read.js";

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

const library = (kind: LibraryKind, extra: Partial<LibraryAdapter> = {}): LibraryAdapter => ({
  scopes: ["project", "user"],
  roots: (repo) => [
    { scope: "project", dir: path.join(repo, ".claude", kind), editable: true },
    { scope: "user", dir: path.join(claudeHome(), kind), editable: true },
  ],
  format: kind === "skills" ? "skill" : "markdown",
  relOk: (_scope, rel) => (kind === "skills" ? SKILL_REL.test(rel) : isMarkdownRel(rel)),
  ownsTree: true,
  ...extra,
});

export const claudeConfig: ConfigAdapter = {
  id: "claude",
  memory: {
    scopes: ["project", "local", "user"],
    file: (repo, scope) => ({ project: projectMemoryFiles(repo).main, local: path.join(repo, "CLAUDE.local.md"), user: path.join(claudeHome(), "CLAUDE.md") })[scope],
    alsoLoaded: (repo) => projectMemoryFiles(repo).other,
    projectFiles: (repo) => [path.join(repo, "CLAUDE.md"), path.join(repo, ".claude", "CLAUDE.md")],
  },
  settings: {
    kind: "claude",
    scopes: ["project", "local", "user"],
    file: (repo, scope) =>
      ({ project: path.join(repo, ".claude", "settings.json"), local: path.join(repo, ".claude", "settings.local.json"), user: path.join(claudeHome(), "settings.json") })[scope],
  },
  hooks: { kind: "settings" },
  library: {
    agents: library("agents", { templates: "claude", checkNames: true }),
    commands: library("commands"),
    skills: library("skills"),
  },
  mcp: { kind: "claude", scopes: ["project", "local", "user"], projectFile: (repo) => path.join(repo, ".mcp.json") },
  homes: () => [{ dir: claudeHome(), rootMayBeSymlink: true }],
  unsupported: {},
};
