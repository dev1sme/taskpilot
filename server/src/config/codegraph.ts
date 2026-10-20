import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { HttpError } from "../errors.js";
import { t } from "../i18n.js";

export interface CodegraphStatus {
  supported: boolean;
  indexed: boolean;
  detail: string | null;
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
  if (!r) return { supported: false, indexed: false, detail: null, error: null };
  const indexed = existsSync(join(r.root, r.rel, ".codegraph"));
  if (!indexed) return { supported: true, indexed: false, detail: null, error: null };
  try {
    const { stdout } = await run("make", ["-C", r.envDir, "cg-status", `p=${r.rel}`], 15_000);
    return { supported: true, indexed: true, detail: stdout.trim(), error: null };
  } catch (e) {
    return { supported: true, indexed: true, detail: null, error: (e as Error).message };
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
