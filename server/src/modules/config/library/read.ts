import { readdir, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { displayPath, fileInfo, frontmatter, readText, strings } from "../shared/fs.js";
import { type ProviderId } from "../../../core/providers.js";
import { checkAgent, checkCodexAgent, checkNames, type AgentCheck } from "./check.js";
import { readTemplates } from "./templates.js";
import { tomlMeta } from "./templates.js";
import { configAdapter, type LibraryAdapter } from "../adapters/index.js";
import { PLAIN_TOML } from "../adapters/names.js";

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
  /** A Copilot agent in .claude/agents is visible to the CLI but cannot be edited as Copilot config. */
  editable?: boolean;
}

const SHOWN_FIELDS = ["tools", "allowed-tools", "model", "argument-hint", "color", "disable-model-invocation"];

/** Native library files of the selected CLI, as its adapter lays them out; absent cli is Claude. */
export async function readLibrary(repo: string, kind: LibraryKind, cli: ProviderId = "claude"): Promise<LibraryItem[]> {
  const library = configAdapter(cli).library[kind];
  if (!library) return [];
  // Agents are compared with TaskPilot's templates by name.
  const templates = library.templates ? new Map((await readTemplates(library.templates)).map((tpl) => [tpl.name, tpl.content])) : undefined;
  const out: LibraryItem[] = [];
  for (const { scope, dir, editable } of library.roots(repo)) {
    switch (library.format) {
      case "skill":
        out.push(...(await readSkills(dir, scope, repo, library.strictNames === true)));
        break;
      case "codex-agent":
        out.push(...(await readCodexAgents(dir, scope, repo, templates)));
        break;
      case "copilot-agent":
        out.push(...(await readCopilotAgents(dir, scope, repo, editable, library)));
        break;
      case "markdown":
        out.push(...(await readMarkdownItems(dir, dir, kind, scope, repo, templates)));
    }
  }
  if (library.checkNames) checkNames(out);
  return out.sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "project" ? -1 : 1));
}

async function readCodexAgents(root: string, scope: LibraryScope, repo: string, templates?: Map<string, string>): Promise<LibraryItem[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LibraryItem[] = [];
  for (const entry of entries) {
    if ((await entryType(root, entry)) !== "file" || !PLAIN_TOML.test(entry.name)) continue;
    const file = path.join(root, entry.name);
    const [content, info] = await Promise.all([readText(file), fileInfo(file)]);
    if (content === null) continue;
    const meta = tomlMeta(content);
    const name = entry.name.slice(0, -".toml".length);
    const check = checkCodexAgent(content);
    const template = templates?.get(name);
    if (template !== undefined) check.template = template === content ? "same" : "modified";
    out.push({
      kind: "agents",
      scope,
      name,
      path: displayPath(file, repo),
      rel: entry.name,
      description: typeof meta.description === "string" ? meta.description : "",
      fields: ["model", "sandbox_mode"].flatMap((key) => (typeof meta[key] === "string" ? [{ key, value: meta[key] as string }] : [])),
      body: typeof meta.developer_instructions === "string" ? meta.developer_instructions : "",
      mtime: info?.mtime ?? null,
      check,
    });
  }
  return out;
}

async function readCopilotAgents(root: string, scope: LibraryScope, repo: string, editable: boolean, library: LibraryAdapter): Promise<LibraryItem[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LibraryItem[] = [];
  for (const entry of entries) {
    const rel = entry.name;
    if (!library.relOk(scope, rel) || (await entryType(root, entry)) !== "file") continue;
    const file = path.join(root, rel);
    const name = rel.replace(/(?:\.agent)?\.md$/, "");
    const item = await toItem(file, "agents", scope, repo, name, rel);
    item.name = name; // Copilot resolves --agent by filename, regardless of YAML name.
    item.editable = editable;
    delete item.check; // Claude's model/tool validator does not apply to Copilot agents.
    out.push(item);
  }
  return out;
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

async function readSkills(root: string, scope: LibraryScope, repo: string, strictNames: boolean): Promise<LibraryItem[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LibraryItem[] = [];
  for (const e of entries) {
    if (strictNames && !/^[A-Za-z0-9][\w-]*$/.test(e.name)) continue;
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
