import { readdir, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { claudeHome, displayPath, fileInfo, frontmatter, readText, strings } from "../shared/fs.js";
import { checkAgent, checkNames, type AgentCheck } from "./check.js";
import { readTemplates } from "./templates.js";

export type LibraryKind = "agents" | "commands" | "skills";
export type LibraryScope = "project" | "user";

export interface LibraryItem {
  kind: LibraryKind;
  scope: LibraryScope;
  /** agents: frontmatter name or file stem; commands: path-based (git:pr); skills: directory or name. */
  name: string;
  path: string;
  /** Path inside the kind's folder (reviewer.md, git/pr.md, deploy/SKILL.md); identifies the item for edits. */
  rel: string;
  description: string;
  /** Selected frontmatter fields worth showing (tools, model, argument-hint…). */
  fields: Array<{ key: string; value: string }>;
  body: string;
  mtime: number | null;
  error?: string;
  /** skills: other files in the skill directory. */
  files?: string[];
  /** agents: whether TaskPilot can use it, and as what. */
  check?: AgentCheck;
}

const SHOWN_FIELDS = ["tools", "allowed-tools", "model", "argument-hint", "color", "disable-model-invocation"];

/** Agents, slash commands or skills of the repo (.claude/) and of the user (~/.claude/). */
export async function readLibrary(repo: string, kind: LibraryKind): Promise<LibraryItem[]> {
  const roots: Array<[LibraryScope, string]> = [
    ["project", path.join(repo, ".claude", kind)],
    ["user", path.join(claudeHome(), kind)],
  ];
  // Agents are compared with TaskPilot's templates by name.
  const templates = kind === "agents" ? new Map((await readTemplates()).map((tpl) => [tpl.name, tpl.content])) : undefined;
  const out: LibraryItem[] = [];
  for (const [scope, root] of roots) {
    if (kind === "skills") out.push(...(await readSkills(root, scope, repo)));
    else out.push(...(await readMarkdownItems(root, root, kind, scope, repo, templates)));
  }
  if (kind === "agents") checkNames(out);
  return out.sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "project" ? -1 : 1));
}

/** The repo's and the user's Claude subagents, each with its TaskPilot check; for the workflow engine. */
export function subagentsOf(repo: string): Promise<LibraryItem[]> {
  return readLibrary(repo, "agents");
}

async function readMarkdownItems(
  root: string,
  dir: string,
  kind: LibraryKind,
  scope: LibraryScope,
  repo: string,
  templates?: Map<string, string>,
  seen = new Set<string>(),
): Promise<LibraryItem[]> {
  let entries;
  try {
    // A symlink may point back at an ancestor; walk each real directory once.
    const real = await realpath(dir);
    if (seen.has(real)) return [];
    seen.add(real);
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LibraryItem[] = [];
  for (const e of entries) {
    const file = path.join(dir, e.name);
    const type = await entryType(dir, e);
    // Both are scanned recursively. Commands are namespaced by folder (git/pr.md → git:pr); an
    // agent is identified by its frontmatter name, the folder does not count.
    if (type === "dir") out.push(...(await readMarkdownItems(root, file, kind, scope, repo, templates, seen)));
    if (type !== "file" || !e.name.endsWith(".md")) continue;
    const rel = path.relative(root, file);
    const fallback = kind === "commands" ? rel.replace(/\.md$/, "").split(path.sep).join(":") : path.basename(file, ".md");
    out.push(await toItem(file, kind, scope, repo, fallback, rel.split(path.sep).join("/"), templates));
  }
  return out;
}

async function readSkills(root: string, scope: LibraryScope, repo: string): Promise<LibraryItem[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LibraryItem[] = [];
  for (const e of entries) {
    // A skill folder may be a symlink to a directory elsewhere.
    if ((await entryType(root, e)) !== "dir") continue;
    const dir = path.join(root, e.name);
    const skillFile = path.join(dir, "SKILL.md");
    if (!(await fileInfo(skillFile))) continue;
    const item = await toItem(skillFile, "skills", scope, repo, e.name, `${e.name}/SKILL.md`);
    item.files = (await listFiles(dir, dir)).filter((f) => f !== "SKILL.md").slice(0, 50);
    out.push(item);
  }
  return out;
}

async function toItem(file: string, kind: LibraryKind, scope: LibraryScope, repo: string, fallback: string, rel: string, templates?: Map<string, string>): Promise<LibraryItem> {
  const [text, info] = await Promise.all([readText(file), fileInfo(file)]);
  const { meta, body, error } = frontmatter(text ?? "");
  const name = kind === "commands" ? fallback : typeof meta.name === "string" && meta.name ? meta.name : fallback;
  const fields = SHOWN_FIELDS.flatMap((key) => {
    const v = meta[key];
    if (v === undefined || v === null || v === "") return [];
    const value = Array.isArray(v) ? strings(v).join(", ") : String(v);
    return [{ key, value }];
  });
  return {
    kind,
    scope,
    name,
    path: displayPath(file, repo),
    rel,
    description: typeof meta.description === "string" ? meta.description : firstLine(body),
    fields,
    body,
    mtime: info?.mtime ?? null,
    ...(error ? { error } : {}),
    ...(kind === "agents" ? { check: agentCheck(meta, error, name, text ?? "", templates) } : {}),
  };
}

function agentCheck(meta: Record<string, unknown>, error: string | undefined, name: string, text: string, templates?: Map<string, string>): AgentCheck {
  const check = checkAgent(meta, error);
  const template = templates?.get(name);
  return template === undefined ? check : { ...check, template: template === text ? "same" : "modified" };
}

async function listFiles(root: string, dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(root, p, depth + 1)));
    else if (e.isFile()) out.push(path.relative(root, p).split(path.sep).join("/"));
  }
  return out.sort();
}

/** File or directory, following a symlink to see what it points at. */
async function entryType(dir: string, e: Dirent): Promise<"file" | "dir" | null> {
  if (e.isFile()) return "file";
  if (e.isDirectory()) return "dir";
  if (!e.isSymbolicLink()) return null;
  try {
    const s = await stat(path.join(dir, e.name));
    return s.isFile() ? "file" : s.isDirectory() ? "dir" : null;
  } catch {
    return null; // dangling link
  }
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("#"))
      ?.trim()
      .slice(0, 200) ?? ""
  );
}
