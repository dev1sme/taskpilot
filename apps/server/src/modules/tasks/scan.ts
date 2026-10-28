import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../core/errors.js";
import { readTaskStatus } from "./status.js";
import type { TaskFile, TaskSummary } from "./types.js";

export const TASKS_DIR = path.join(".claude", "tasks");
export const SPEC_DIR = "spec";

const TASK_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Session key of the repo terminal (sessions without a task). Never matches TASK_KEY, so no task can clash. */
export const REPO_SESSION_KEY = "@repo";

export async function resolveRepo(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) throw new HttpError(400, "Repo path is empty");
  let resolved: string;
  try {
    resolved = await realpath(path.resolve(trimmed));
  } catch {
    throw new HttpError(400, `Repo path not found: ${trimmed}`);
  }
  if (!(await stat(resolved)).isDirectory()) throw new HttpError(400, `Not a directory: ${resolved}`);
  return resolved;
}

export function tasksRoot(repo: string): string {
  return path.join(repo, TASKS_DIR);
}

export async function listTasks(repo: string): Promise<TaskSummary[]> {
  let entries;
  try {
    entries = await readdir(tasksRoot(repo), { withFileTypes: true });
  } catch {
    return [];
  }
  const tasks: TaskSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !TASK_KEY.test(entry.name)) continue;
    const task = await loadTask(repo, entry.name);
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getTask(repo: string, key: string): Promise<TaskSummary> {
  const task = await loadTask(repo, checkKey(key));
  if (!task) throw new HttpError(404, `Task not found: ${key}`);
  return task;
}

/** Reads a markdown file of a task. `rel` must stay inside the task directory, symlinks included. */
export async function readTaskFile(repo: string, key: string, rel: string): Promise<string> {
  const dir = taskDir(repo, checkKey(key));
  if (!rel || path.isAbsolute(rel) || !rel.toLowerCase().endsWith(".md")) {
    throw new HttpError(400, "Invalid file path");
  }
  const target = path.resolve(dir, rel);
  if (!isInside(dir, target)) throw new HttpError(400, "Invalid file path");
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    throw new HttpError(404, `File not found: ${rel}`);
  }
  if (!isInside(await realpath(dir), real)) throw new HttpError(400, "Invalid file path");
  return readFile(real, "utf8");
}

async function loadTask(repo: string, key: string): Promise<TaskSummary | null> {
  const dir = taskDir(repo, key);
  const specFiles = await listMarkdown(dir, SPEC_DIR, true);
  if (specFiles.length === 0) return null;
  const outputFiles = await listMarkdown(dir, "", false);
  const all = [...specFiles, ...outputFiles];
  return {
    key,
    title: (await firstHeading(dir, specFiles)) ?? key,
    specFiles,
    outputFiles,
    updatedAt: Math.max(...all.map((f) => f.mtime)),
    status: await readTaskStatus(dir),
  };
}

async function listMarkdown(dir: string, sub: string, recursive: boolean): Promise<TaskFile[]> {
  const out: TaskFile[] = [];
  let entries;
  try {
    entries = await readdir(path.join(dir, sub), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.isDirectory() && recursive) {
      out.push(...(await listMarkdown(dir, rel, true)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      const s = await stat(path.join(dir, rel));
      out.push({ path: rel, size: s.size, mtime: s.mtimeMs });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function firstHeading(dir: string, files: TaskFile[]): Promise<string | null> {
  const text = await readFile(path.join(dir, files[0].path), "utf8");
  const match = /^#\s+(.+)$/m.exec(text);
  return match ? match[1].trim() : null;
}

function taskDir(repo: string, key: string): string {
  return path.join(tasksRoot(repo), key);
}

function checkKey(key: string): string {
  if (!TASK_KEY.test(key)) throw new HttpError(400, `Invalid task key: ${key}`);
  return key;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
