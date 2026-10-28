import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/** <package>/workflows; four levels up from both server/src/modules/workflow and dist/server/modules/workflow. */
export const WORKFLOWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../workflows");
/** The mode that runs when a repo chose nothing and has no override. */
export const WORKFLOW_FILE = "workflow.yml";
export const DEFAULT_MODE = "default";
/** The mode of a legacy override (one without `extends`): the repo's own complete workflow. */
export const CUSTOM_MODE = "custom";
const MODE_ID = /^[a-z][a-z0-9-]*$/;

export interface ModeInfo {
  id: string;
  name: string;
  description: string;
}

export function modeDir(id: string): string {
  return path.join(WORKFLOWS_DIR, id);
}

/** Whether `id` names a built-in mode: a directory of workflows/ with a workflow.yml. */
export function isMode(id: unknown): id is string {
  return typeof id === "string" && MODE_ID.test(id) && existsSync(path.join(modeDir(id), WORKFLOW_FILE));
}

/** Every directory of workflows/ with a workflow.yml, `default` first, the others by id. */
export async function listModes(): Promise<ModeInfo[]> {
  const names = await readdir(WORKFLOWS_DIR).catch(() => [] as string[]);
  const modes: ModeInfo[] = [];
  for (const id of names.sort()) {
    if (!isMode(id)) continue;
    let doc: unknown;
    try {
      doc = parse(await readFile(path.join(modeDir(id), WORKFLOW_FILE), "utf8"));
    } catch {
      doc = null;
    }
    const meta = typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>) : {};
    modes.push({
      id,
      name: typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : id,
      description: typeof meta.description === "string" ? meta.description.trim() : "",
    });
  }
  return modes.sort((a, b) => Number(b.id === DEFAULT_MODE) - Number(a.id === DEFAULT_MODE));
}
