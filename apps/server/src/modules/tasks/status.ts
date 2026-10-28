import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { TaskStatus } from "./types.js";

/**
 * Whether a task is finished, kept in the task directory. Not a `.md` file, so it is no task
 * document: it is not listed in the docs panel, not archived on a restart and not in prompts.
 */
export const TASK_STATUS_FILE = "task.yml";

/** The task's `task.yml`; null when it is missing or not a valid status, so callers fall back to the run. */
export async function readTaskStatus(taskDir: string): Promise<TaskStatus | null> {
  let doc: unknown;
  try {
    doc = parse(await readFile(path.join(taskDir, TASK_STATUS_FILE), "utf8"));
  } catch {
    return null;
  }
  const status = (doc as { status?: unknown } | null)?.status;
  if (status !== "open" && status !== "done") return null;
  const raw = (doc as { doneAt?: unknown }).doneAt;
  const at = raw instanceof Date ? raw.getTime() : typeof raw === "string" ? Date.parse(raw) : NaN;
  return { status, doneAt: status === "done" && Number.isFinite(at) ? at : null };
}

/** Writes `task.yml` atomically, so a reader never sees half a file. */
export async function writeTaskStatus(taskDir: string, status: TaskStatus["status"], at = new Date()): Promise<TaskStatus> {
  const lines = ["# Written by TaskPilot: status is open or done.", `status: ${status}`];
  if (status === "done") lines.push(`doneAt: ${at.toISOString()}`);
  const file = path.join(taskDir, TASK_STATUS_FILE);
  const tmp = `${file}.tmp`;
  try {
    await writeFile(tmp, `${lines.join("\n")}\n`);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return { status, doneAt: status === "done" ? at.getTime() : null };
}

/**
 * Whether the task is finished: `task.yml` decides when it is there; without it, a run that
 * reached its end (older tasks never had the file).
 */
export function doneOf(status: TaskStatus | null, runPhase: string | undefined): { at: number | null } | null {
  if (status) return status.status === "done" ? { at: status.doneAt } : null;
  return runPhase === "done" ? { at: null } : null;
}
