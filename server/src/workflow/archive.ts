import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { HISTORY_FILE } from "./history.js";

export const ARCHIVE_DIR = "archive";

const pad = (n: number) => String(n).padStart(2, "0");

/** "20261020-150000", local time: sorts by name and is safe in a path. */
export function archiveStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Copies the documents at the top of a task directory into archive/<stamp>/ before a run starts
 * over and rewrites them. The spec and the decision log are left out: neither is rewritten.
 * Returns the archive directory relative to the task directory and the copied file names.
 */
export async function archiveOutputs(taskDir: string, at: Date): Promise<{ dir: string; files: string[] }> {
  const entries = await readdir(taskDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md") && e.name !== HISTORY_FILE)
    .map((e) => e.name)
    .sort();
  const dir = `${ARCHIVE_DIR}/${archiveStamp(at)}`;
  if (files.length === 0) return { dir, files };
  await mkdir(path.join(taskDir, dir), { recursive: true });
  await Promise.all(files.map((f) => copyFile(path.join(taskDir, f), path.join(taskDir, dir, f))));
  return { dir, files };
}
