import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { projectMemoryFiles } from "../../config/targets.js";
import { markdownHeadings } from "../../core/markdown.js";
import { t } from "../../core/i18n.js";

/** Read-only summary of the repo's Claude Code configuration, for the overview page. */
export interface Inventory {
  claudeMd: { exists: boolean; lines: number; bytes: number; mtime: number | null; headings: string[] };
  claudeLocalMd: boolean;
  mcp: { exists: boolean; servers: Array<{ name: string; type: string }>; error?: string };
  claudeDir: { agents: number; commands: number; skills: number; hooks: number; allow: number; deny: number };
}

export async function readInventory(repo: string): Promise<Inventory> {
  const claude = path.join(repo, ".claude");
  const [claudeMd, claudeLocalMd, mcp, agents, commands, skills, settings] = await Promise.all([
    readClaudeMd(projectMemoryFiles(repo).main),
    exists(path.join(repo, "CLAUDE.local.md")),
    readMcp(path.join(repo, ".mcp.json")),
    // Claude Code scans agents/ recursively, like commands/.
    countFiles(path.join(claude, "agents"), (f) => f.endsWith(".md"), true),
    countFiles(path.join(claude, "commands"), (f) => f.endsWith(".md"), true),
    countSkills(path.join(claude, "skills")),
    Promise.all(["settings.json", "settings.local.json"].map((f) => readJson(path.join(claude, f)))),
  ]);

  let hooks = 0;
  let allow = 0;
  let deny = 0;
  for (const s of settings) {
    if (!isObject(s)) continue;
    if (isObject(s.hooks)) {
      for (const matchers of Object.values(s.hooks)) {
        if (!Array.isArray(matchers)) continue;
        for (const m of matchers) if (isObject(m) && Array.isArray(m.hooks)) hooks += m.hooks.length;
      }
    }
    if (isObject(s.permissions)) {
      if (Array.isArray(s.permissions.allow)) allow += s.permissions.allow.length;
      if (Array.isArray(s.permissions.deny)) deny += s.permissions.deny.length;
    }
  }

  return { claudeMd, claudeLocalMd, mcp, claudeDir: { agents, commands, skills, hooks, allow, deny } };
}

async function readClaudeMd(file: string): Promise<Inventory["claudeMd"]> {
  try {
    const [text, s] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const headings = markdownHeadings(text)
      .filter((h) => h.level === 2)
      .map((h) => h.text.replace(/^\d+\.\s*/, ""));
    return { exists: true, lines: text.split("\n").length, bytes: s.size, mtime: s.mtimeMs, headings };
  } catch {
    return { exists: false, lines: 0, bytes: 0, mtime: null, headings: [] };
  }
}

async function readMcp(file: string): Promise<Inventory["mcp"]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { exists: false, servers: [] };
  }
  try {
    const doc = JSON.parse(raw) as unknown;
    const servers = isObject(doc) && isObject(doc.mcpServers) ? doc.mcpServers : {};
    return {
      exists: true,
      servers: Object.entries(servers).map(([name, cfg]) => ({
        name,
        type: isObject(cfg)
          ? typeof cfg.type === "string"
            ? cfg.type
            : typeof cfg.command === "string"
              ? "stdio"
              : // A `url` without `type` is read as stdio and fails; see config/mcp.ts.
                "?"
          : "?",
      })),
    };
  } catch (e) {
    return { exists: true, servers: [], error: t("errors.invalidJson", { error: (e as Error).message }) };
  }
}

async function countFiles(dir: string, match: (name: string) => boolean, recursive: boolean): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (e.isFile() && match(e.name)) n++;
    else if (recursive && e.isDirectory()) n += await countFiles(path.join(dir, e.name), match, true);
  }
  return n;
}

/** A skill is a directory holding SKILL.md. */
async function countSkills(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  // A skill folder may be a symlink; exists() follows it.
  const found = await Promise.all(
    entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => exists(path.join(dir, e.name, "SKILL.md"))),
  );
  return found.filter(Boolean).length;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
