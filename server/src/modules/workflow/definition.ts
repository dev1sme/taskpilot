import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { HttpError } from "../../core/errors.js";
import type { OutputDef, StepDef, WorkflowDef } from "./types.js";
import { templateVars } from "./vars.js";

/** <package>/workflows/default; four levels up from both server/src/modules/workflow and dist/server/modules/workflow. */
export const DEFAULT_WORKFLOW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../workflows/default");
/** A repo's own workflow: workflow.yml plus its prompt files, all in this one directory. */
export const OVERRIDE_DIR = path.join(".claude", "taskpilot");
export const WORKFLOW_FILE = "workflow.yml";
/** Prompt files sit next to workflow.yml: no sub-directories, no lookup elsewhere. */
export const PROMPT_FILE = /^[a-z0-9][a-z0-9-]*\.md$/;

/** bypassPermissions is deliberately not accepted from a workflow file. */
const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto"];
const ID = /^[a-z][a-z0-9-]*$/;
/** A document at the top of the task directory (where restarts archive from and stages are read). */
const TASK_DOC = /^[A-Za-z0-9][\w.-]*\.md$/;
const DEFAULT_HISTORY = { file: "00-history.md", entry: "## <YYYY-MM-DD HH:MM> · {{step}} · Claude" };

export interface ParseResult {
  def: WorkflowDef | null;
  errors: string[];
  warnings: string[];
}

export function overrideDir(repo: string): string {
  return path.join(repo, OVERRIDE_DIR);
}

export function hasOverride(repo: string): boolean {
  return existsSync(path.join(overrideDir(repo), WORKFLOW_FILE));
}

/** The repo's .claude/taskpilot/ override if it has a workflow.yml, else TaskPilot's built-in workflow. */
export async function loadWorkflow(repo: string): Promise<WorkflowDef> {
  const origin = hasOverride(repo) ? "repo" : "default";
  const dir = origin === "repo" ? overrideDir(repo) : DEFAULT_WORKFLOW_DIR;
  const { def, errors } = parseWorkflowFiles(await readWorkflowDir(dir), { dir, origin });
  if (!def) throw new HttpError(400, `${path.join(dir, WORKFLOW_FILE)}: ${errors.join("; ")}`);
  return def;
}

/** workflow.yml and the prompt files of a workflow directory, by name. */
export async function readWorkflowDir(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return files;
  }
  for (const name of names.sort()) {
    if (name !== WORKFLOW_FILE && !PROMPT_FILE.test(name)) continue;
    try {
      files.set(name, await readFile(path.join(dir, name), "utf8"));
    } catch {
      // A directory or an unreadable file: not part of the workflow.
    }
  }
  return files;
}

/**
 * Parses and checks a whole workflow from its files (workflow.yml + prompts), so unsaved drafts can be
 * checked by passing them in `files`. Errors make the workflow unusable; warnings do not.
 */
export function parseWorkflowFiles(files: Map<string, string>, where: { dir: string; origin: WorkflowDef["origin"] }): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const result = (def: WorkflowDef | null): ParseResult => ({ def: errors.length ? null : def, errors, warnings });

  const text = files.get(WORKFLOW_FILE);
  if (text === undefined) return (errors.push(`missing ${WORKFLOW_FILE}`), result(null));
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return (errors.push(`invalid YAML: ${(e as Error).message}`), result(null));
  }
  if (!isObject(doc)) return (errors.push("must be a mapping"), result(null));
  if (doc.version !== 2) errors.push("version must be 2");
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) return (errors.push("needs a non-empty `steps` list"), result(null));

  const permissionMode = doc["permission-mode"];
  if (permissionMode !== undefined && (typeof permissionMode !== "string" || !PERMISSION_MODES.includes(permissionMode))) {
    errors.push(`permission-mode must be one of ${PERMISSION_MODES.join(", ")}`);
  }

  const used = new Set<string>();
  /** A prompt or format file next to workflow.yml; it then counts as used. */
  const loadFile = (where: string, name: unknown, example: string): { text: string; file: string } | null => {
    if (typeof name !== "string" || !PROMPT_FILE.test(name)) {
      errors.push(`${where} must be a file name like ${example} (lowercase, next to ${WORKFLOW_FILE})`);
      return null;
    }
    used.add(name);
    const text = files.get(name);
    if (text === undefined) {
      errors.push(`${where}: file not found: ${name}`);
      return null;
    }
    return { text, file: name };
  };
  const loadPrompt = (where: string, name: unknown) => loadFile(where, name, "investigate.md");
  const loadFormat = (where: string, name: unknown) => (name === undefined ? null : loadFile(where, name, "format-plan.md"));

  const history: WorkflowDef["history"] = { ...DEFAULT_HISTORY };
  if (doc.history !== undefined) {
    if (!isObject(doc.history)) errors.push("history must be {file, entry, format}");
    else {
      if (doc.history.file !== undefined) history.file = String(doc.history.file);
      if (doc.history.entry !== undefined) history.entry = String(doc.history.entry);
      const format = loadFormat("history.format", doc.history.format);
      if (format) Object.assign(history, { format: format.file, formatText: format.text });
    }
  }
  if (!TASK_DOC.test(history.file)) errors.push(`history.file must be a .md file name at the top of the task directory: ${history.file}`);

  const language = doc.language === undefined ? "" : String(doc.language);
  let rules: string[] = [];
  if (doc.rules !== undefined) {
    if (!Array.isArray(doc.rules) || doc.rules.some((r) => typeof r !== "string")) errors.push("rules must be a list of strings");
    else rules = doc.rules as string[];
  }

  const steps: StepDef[] = [];
  const outputIds = new Set<string>();
  const outputFiles = new Set<string>([history.file]);
  for (const [i, raw] of doc.steps.entries()) {
    const at = `steps[${i}]`;
    if (!isObject(raw)) {
      errors.push(`${at} must be a mapping`);
      continue;
    }
    const id = raw.id;
    if (typeof id !== "string" || !ID.test(id)) errors.push(`${at}.id must match ${ID}`);
    else if (steps.some((s) => s.id === id)) errors.push(`duplicate step id ${id}`);
    const gate = raw.gate ?? "none";
    if (gate !== "approve" && gate !== "none") errors.push(`${at}.gate must be approve or none`);

    const outputs: OutputDef[] = [];
    if (raw.outputs !== undefined && !Array.isArray(raw.outputs)) errors.push(`${at}.outputs must be a list`);
    for (const [j, o] of (Array.isArray(raw.outputs) ? raw.outputs : []).entries()) {
      const oat = `${at}.outputs[${j}]`;
      if (!isObject(o)) {
        errors.push(`${oat} must be {id, file, content, format}`);
        continue;
      }
      const oid = o.id;
      const file = o.file;
      if (typeof oid !== "string" || !ID.test(oid)) errors.push(`${oat}.id must match ${ID}`);
      else if (outputIds.has(oid)) errors.push(`duplicate output id ${oid}`);
      if (typeof file !== "string" || !TASK_DOC.test(file)) errors.push(`${oat}.file must be a .md file name at the top of the task directory`);
      else if (outputFiles.has(file)) errors.push(`${oat}.file ${file} is already used`);
      if (typeof oid === "string") outputIds.add(oid);
      if (typeof file === "string") outputFiles.add(file);
      const format = loadFormat(`${oat}.format`, o.format);
      outputs.push({
        id: String(oid),
        file: String(file),
        content: o.content === undefined ? "" : String(o.content),
        ...(format ? { format: format.file, formatText: format.text } : {}),
      });
    }

    const doneWhen = raw["done-when"];
    let done: StepDef["doneWhen"];
    if (doneWhen !== undefined) {
      const out = outputs.find((o) => o.id === doneWhen);
      if (!out) errors.push(`${at}.done-when must be the id of one of this step's outputs`);
      else done = { output: out.id, file: out.file };
    }

    const prompt = loadPrompt(`${at}.prompt`, raw.prompt);
    const onReject = raw["on-reject"] === undefined ? null : loadPrompt(`${at}.on-reject`, raw["on-reject"]);
    steps.push({
      id: String(id),
      title: typeof raw.title === "string" ? raw.title : String(id),
      prompt: prompt?.text ?? "",
      promptFile: prompt?.file ?? "",
      outputs,
      doneWhen: done,
      gate: gate as StepDef["gate"],
      onReject: onReject?.text,
      onRejectFile: onReject?.file,
    });
  }

  let restart: WorkflowDef["restart"];
  if (doc.restart !== undefined) {
    const read = isObject(doc.restart) ? doc.restart.read : undefined;
    if (!Array.isArray(read) || read.some((r) => typeof r !== "string" || !outputIds.has(r))) {
      errors.push("restart.read must be a list of output ids");
    } else restart = { read: read as string[] };
  }

  checkTemplates(steps, rules, history, outputIds, errors, warnings);
  for (const name of files.keys()) {
    if (name !== WORKFLOW_FILE && !used.has(name)) warnings.push(`${name} is not used by any step`);
  }

  return result({
    source: path.join(where.dir, WORKFLOW_FILE),
    origin: where.origin,
    dir: where.dir,
    permissionMode: permissionMode as string | undefined,
    history,
    language,
    rules,
    restart,
    steps,
  });
}

const VAR = /\{\{([\w.]+)\}\}/g;

function checkTemplates(
  steps: StepDef[],
  rules: string[],
  history: WorkflowDef["history"],
  outputIds: Set<string>,
  errors: string[],
  warnings: string[],
) {
  const known = new Set<string>(templateVars);
  const check = (where: string, text: string, allowFeedback: boolean) => {
    for (const [, name] of text.matchAll(VAR)) {
      if (name.startsWith("out.")) {
        if (!outputIds.has(name.slice(4))) errors.push(`${where}: {{${name}}} names no output`);
      } else if (name === "feedback" && !allowFeedback) {
        errors.push(`${where}: {{feedback}} is only available in on-reject prompts`);
      } else if (!known.has(name)) {
        warnings.push(`${where}: unknown variable {{${name}}} is sent as it is`);
      }
    }
  };
  rules.forEach((r, i) => check(`rules[${i}]`, r, false));
  check("history.entry", history.entry, false);
  if (history.format && history.formatText !== undefined) check(history.format, history.formatText, false);
  const formats = new Set<string>();
  for (const o of steps.flatMap((s) => s.outputs)) {
    if (o.format && o.formatText !== undefined && !formats.has(o.format)) check(o.format, o.formatText, false);
    if (o.format) formats.add(o.format);
  }
  for (const s of steps) {
    if (s.promptFile) check(s.promptFile, s.prompt, false);
    if (s.onRejectFile && s.onReject !== undefined) check(s.onRejectFile, s.onReject, true);
    if (s.outputs.length > 0 && s.prompt && !/\{\{outputs\}\}/.test(s.prompt) && !s.outputs.some((o) => s.prompt.includes(`{{out.${o.id}}}`))) {
      warnings.push(`${s.promptFile}: step ${s.id} has outputs but its prompt names none of them ({{outputs}} or {{out.<id>}})`);
    }
  }
  const first = steps[0];
  if (first?.promptFile && !first.prompt.includes("{{previousRun}}")) {
    warnings.push(`${first.promptFile}: without {{previousRun}}, a restarted run is not told to read the archived documents`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
