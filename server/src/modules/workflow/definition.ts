import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { HttpError } from "../../core/errors.js";
import type { StepDef, WorkflowDef } from "./types.js";

/** <package>/workflows/default; four levels up from both server/src/modules/workflow and dist/server/modules/workflow. */
export const DEFAULT_WORKFLOW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../workflows/default");
export const REPO_WORKFLOW_FILE = path.join(".claude", "workflow.yml");

/** bypassPermissions is deliberately not accepted from a repo file. */
const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto"];
const STEP_ID = /^[a-z][a-z0-9-]*$/;

/** The repo's .claude/workflow.yml if present, else the built-in default. */
export async function loadWorkflow(repo: string): Promise<WorkflowDef> {
  const repoFile = path.join(repo, REPO_WORKFLOW_FILE);
  if (existsSync(repoFile)) return parseWorkflow(repoFile, [path.dirname(repoFile), DEFAULT_WORKFLOW_DIR]);
  return parseWorkflow(path.join(DEFAULT_WORKFLOW_DIR, "workflow.yml"), [DEFAULT_WORKFLOW_DIR]);
}

/** `promptDirs` are searched in order for prompt files, so a repo workflow can reuse default prompts. */
export async function parseWorkflow(file: string, promptDirs: string[]): Promise<WorkflowDef> {
  const fail = (msg: string): never => {
    throw new HttpError(400, `${file}: ${msg}`);
  };
  let doc: unknown;
  try {
    doc = parse(await readFile(file, "utf8"));
  } catch (e) {
    return fail(`cannot read workflow: ${(e as Error).message}`);
  }
  if (!isObject(doc) || !Array.isArray(doc.steps) || doc.steps.length === 0) return fail("needs a non-empty `steps` list");

  const permissionMode = doc["permission-mode"];
  if (permissionMode !== undefined && (typeof permissionMode !== "string" || !PERMISSION_MODES.includes(permissionMode))) {
    fail(`permission-mode must be one of ${PERMISSION_MODES.join(", ")}`);
  }

  const steps: StepDef[] = [];
  for (const [i, raw] of doc.steps.entries()) {
    const where = `steps[${i}]`;
    if (!isObject(raw)) return fail(`${where} must be a mapping`);
    const id = raw.id;
    if (typeof id !== "string" || !STEP_ID.test(id)) return fail(`${where}.id must match ${STEP_ID}`);
    if (steps.some((s) => s.id === id)) fail(`duplicate step id ${id}`);
    if (typeof raw.prompt !== "string") return fail(`${where}.prompt must be a file name`);
    const gate = raw.gate ?? "none";
    if (gate !== "approve" && gate !== "none") fail(`${where}.gate must be approve or none`);
    const doneWhen = raw["done-when"];
    if (doneWhen !== undefined && !(isObject(doneWhen) && typeof doneWhen.file === "string")) {
      fail(`${where}.done-when must be {file: <name>}`);
    }
    const onReject = raw["on-reject"];
    if (onReject !== undefined && typeof onReject !== "string") fail(`${where}.on-reject must be a file name`);

    steps.push({
      id,
      title: typeof raw.title === "string" ? raw.title : id,
      prompt: await loadPrompt(raw.prompt, promptDirs, fail),
      doneWhen: isObject(doneWhen) ? { file: String(doneWhen.file) } : undefined,
      gate: gate as StepDef["gate"],
      onReject: typeof onReject === "string" ? await loadPrompt(onReject, promptDirs, fail) : undefined,
    });
  }
  return { source: file, permissionMode: permissionMode as string | undefined, steps };
}

/** Replaces {{name}}; unknown names are left as they are so mistakes stay visible. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

async function loadPrompt(name: string, dirs: string[], fail: (msg: string) => never): Promise<string> {
  if (path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) fail(`prompt path must be relative: ${name}`);
  for (const dir of dirs) {
    const file = path.join(dir, name);
    if (existsSync(file)) return readFile(file, "utf8");
  }
  return fail(`prompt not found: ${name}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
