import os from "node:os";
import path from "node:path";
import { markdownHeadings } from "../../../core/markdown.js";
import { displayPath, fileInfo, readJsonFile, readText } from "../shared/fs.js";
import { type ProviderId } from "@taskpilot/shared";
import { memoryTarget } from "../shared/targets.js";
import { configAdapter } from "../adapters/index.js";
import { t } from "../../../core/i18n.js";
import { isObject } from "../../../core/values.js";

export type MemoryScope = "project" | "local" | "user";

export interface MemoryImport {
  ref: string;
  path: string;
  exists: boolean;
  bytes: number;
  depth: number;
  line: number;
}

export interface MemoryCheck {
  level: "ok" | "warn";
  message: string;
  line?: number;
}

export interface MemoryFile {
  scope: MemoryScope;
  path: string;
  exists: boolean;
  content: string;
  lines: number;
  bytes: number;
  mtime: number | null;
  headings: Array<{ level: number; text: string; line: number }>;
  imports: MemoryImport[];
  checks: MemoryCheck[];
}

const MAX_IMPORT_DEPTH = 4;

/** Secret shapes, named by their `memory.secretKind` key. */
const SECRET_PATTERNS: Array<[RegExp, "sk" | "github" | "aws" | "slack" | "privateKey"]> = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, "sk"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "github"],
  [/\bAKIA[0-9A-Z]{16}\b/, "aws"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, "slack"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "privateKey"],
];

/** Native instruction files for the selected CLI, with imports and sanity checks. */
export async function readMemory(repo: string, cli: ProviderId = "claude"): Promise<MemoryFile[]> {
  const scripts = await npmScripts(repo);
  const memory = configAdapter(cli).memory;
  const targets = memory.scopes.map((scope) => [scope, memoryTarget(repo, scope, cli).abs] as const);
  const files = await Promise.all(targets.map(([scope, file]) => readOne(scope, file, repo, scripts)));
  const other = memory.alsoLoaded?.(repo);
  if (other) {
    files[0].checks.unshift({
      level: "warn",
      message: t("memory.alsoLoads", { other: displayPath(other, repo), main: displayPath(memory.file(repo, "project"), repo) }),
    });
  }
  return files;
}

async function readOne(scope: MemoryScope, file: string, repo: string, scripts: Set<string> | null): Promise<MemoryFile> {
  const [content, info] = await Promise.all([readText(file), fileInfo(file)]);
  const base = { scope, path: displayPath(file, repo) };
  if (content === null) {
    return { ...base, exists: false, content: "", lines: 0, bytes: 0, mtime: null, headings: [], imports: [], checks: [] };
  }

  const lines = content.split("\n");
  const headings = markdownHeadings(content, 4);

  const imports: MemoryImport[] = [];
  await collectImports(content, path.dirname(file), 1, imports, new Set([path.resolve(file)]), repo);

  const checks: MemoryCheck[] = [];
  const missing = imports.filter((i) => !i.exists);
  checks.push(
    missing.length === 0
      ? { level: "ok", message: imports.length ? t("memory.importsOk", { count: imports.length }) : t("memory.noImports") }
      : { level: "warn", message: t("memory.importsMissing", { refs: missing.map((m) => m.ref).join(", ") }), line: missing[0].line },
  );
  if (scripts) {
    lines.forEach((l, i) => {
      for (const m of l.matchAll(/\bnpm run ([\w:.-]+)/g)) {
        const script = m[1].replace(/[.:]+$/, ""); // "…npm run e2e." ends a sentence
        if (!scripts.has(script)) {
          checks.push({ level: "warn", message: t("memory.unknownScript", { script }), line: i + 1 });
        }
      }
    });
  }
  const secrets = lines.flatMap((l, i) => SECRET_PATTERNS.filter(([re]) => re.test(l)).map(([, what]) => ({ what, line: i + 1 })));
  checks.push(
    secrets.length === 0
      ? { level: "ok", message: t("memory.noSecrets") }
      : { level: "warn", message: t("memory.secret", { what: t(`memory.secretKind.${secrets[0].what}`) }), line: secrets[0].line },
  );

  return {
    ...base,
    exists: true,
    content,
    lines: lines.length,
    bytes: info?.bytes ?? Buffer.byteLength(content),
    mtime: info?.mtime ?? null,
    headings,
    imports,
    checks,
  };
}

/** `@path` references outside code, resolved relative to the importing file, recursively. */
async function collectImports(text: string, dir: string, depth: number, out: MemoryImport[], seen: Set<string>, repo: string): Promise<void> {
  if (depth > MAX_IMPORT_DEPTH) return;
  let inFence = false;
  const lines = text.split("\n");
  for (const [i, raw] of lines.entries()) {
    if (/^\s*```/.test(raw)) inFence = !inFence;
    if (inFence) continue;
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w.-]+(?:\/[\w.-]+)*)/g)) {
      // Trailing punctuation belongs to the sentence ("ping @alice."); a path needs an extension or a "/".
      const ref = m[1].replace(/[.,;:]+$/, "");
      if (!/\.\w+$/.test(ref) && !ref.includes("/")) continue;
      const target = ref.startsWith("~/") ? path.join(os.homedir(), ref.slice(2)) : path.resolve(dir, ref);
      if (seen.has(target)) continue;
      seen.add(target);
      const info = await fileInfo(target);
      out.push({ ref, path: displayPath(target, repo), exists: info !== null, bytes: info?.bytes ?? 0, depth, line: i + 1 });
      if (info) {
        const nested = await readText(target);
        if (nested) await collectImports(nested, path.dirname(target), depth + 1, out, seen, repo);
      }
    }
  }
}

async function npmScripts(repo: string): Promise<Set<string> | null> {
  const pkg = await readJsonFile(path.join(repo, "package.json"));
  if (!("data" in pkg) || !isObject(pkg.data)) return null;
  return new Set(isObject(pkg.data.scripts) ? Object.keys(pkg.data.scripts) : []);
}
