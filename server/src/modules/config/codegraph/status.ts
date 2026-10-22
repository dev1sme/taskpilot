import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";

export interface CodegraphSummary {
  files: number;
  nodes: number;
  edges: number;
  dbSize: string;
  upToDate: boolean;
}

export interface CodegraphStatus {
  supported: boolean;
  indexed: boolean;
  detail: string | null;
  /** Key numbers parsed from `detail`; null when the output has no recognisable shape (raw `detail` still returned). */
  summary: CodegraphSummary | null;
  error: string | null;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(firstLine(stderr || err.message)));
      else resolve({ stdout, stderr });
    });
  });
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 200);
}

const MAKE_NOISE = /^make(\[\d+\])?: (Entering|Leaving) directory\b/;

/** Drops the `make: Entering/Leaving directory` lines and trims the surrounding blank lines. */
export function stripMakeNoise(stdout: string): string {
  return stdout
    .split("\n")
    .filter((l) => !MAKE_NOISE.test(l.trim()))
    .join("\n")
    .trim();
}

function field(stdout: string, label: string): string | null {
  const m = new RegExp(`^\\s*${label}:[ \\t]*(.+?)\\s*$`, "im").exec(stdout);
  return m ? m[1] : null;
}

function count(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pulls Files / Nodes / Edges / DB Size / up-to-date out of `codegraph status` output.
 * Pure. Returns null when any of the four values is missing, so callers fall back to the raw text.
 */
export function parseCodegraphStatus(stdout: string): CodegraphSummary | null {
  const files = count(field(stdout, "Files"));
  const nodes = count(field(stdout, "Nodes"));
  const edges = count(field(stdout, "Edges"));
  const dbSize = field(stdout, "DB Size");
  if (files === null || nodes === null || edges === null || dbSize === null) return null;
  return { files, nodes, edges, dbSize, upToDate: /index is up to date/i.test(stdout) };
}

/** Dir of the `environments` checkout that runs the codegraph container. */
function resolveEnvironments(): string {
  const dir = process.env.TASKPILOT_ENVIRONMENTS_DIR ?? join(homedir(), "dev", "environments");
  if (!existsSync(join(dir, "Makefile"))) {
    throw new HttpError(404, t("codegraph.noEnvironments", { dir }));
  }
  return dir;
}

/** `PROJECTS_ROOT` as declared in environments/.env — the single source of truth, not duplicated here. */
async function readProjectsRoot(envDir: string): Promise<string> {
  const text = await readFile(join(envDir, ".env"), "utf8").catch(() => {
    throw new HttpError(404, t("codegraph.noEnv", { dir: envDir }));
  });
  const line = text.split("\n").find((l) => l.startsWith("PROJECTS_ROOT="));
  if (!line) throw new HttpError(404, t("codegraph.noRoot", { dir: envDir }));
  return line.slice("PROJECTS_ROOT=".length).trim();
}

/** repo path relative to PROJECTS_ROOT, or null if the repo lives outside it (codegraph can't see it then). */
function relativeToRoot(root: string, repoPath: string): string | null {
  const rel = relative(root, repoPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}

async function resolve(repoPath: string): Promise<{ envDir: string; root: string; rel: string } | null> {
  const envDir = resolveEnvironments();
  const root = await readProjectsRoot(envDir);
  const rel = relativeToRoot(root, repoPath);
  return rel === null ? null : { envDir, root, rel };
}

export async function getCodegraphStatus(repoPath: string): Promise<CodegraphStatus> {
  const r = await resolve(repoPath);
  if (!r) return { supported: false, indexed: false, detail: null, summary: null, error: null };
  const indexed = existsSync(join(r.root, r.rel, ".codegraph"));
  if (!indexed) return { supported: true, indexed: false, detail: null, summary: null, error: null };
  try {
    const { stdout } = await run("make", ["-C", r.envDir, "cg-status", `p=${r.rel}`], 15_000);
    const detail = stripMakeNoise(stdout);
    return { supported: true, indexed: true, detail, summary: parseCodegraphStatus(detail), error: null };
  } catch (e) {
    return { supported: true, indexed: true, detail: null, summary: null, error: (e as Error).message };
  }
}

export async function runCodegraphIndex(repoPath: string): Promise<{ ok: true; output: string }> {
  const r = await resolve(repoPath);
  if (!r) throw new HttpError(409, t("codegraph.outside"));
  try {
    const { stdout, stderr } = await run("make", ["-C", r.envDir, "cg-index", `p=${r.rel}`], 120_000);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    throw new HttpError(502, t("codegraph.indexFailed", { error: (e as Error).message }));
  }
}
