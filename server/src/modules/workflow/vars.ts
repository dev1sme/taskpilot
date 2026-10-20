import path from "node:path";
import { SPEC_DIR, TASKS_DIR } from "../tasks/index.js";
import { HISTORY_TEXT } from "./history.js";
import type { RunState, WorkflowDef } from "./types.js";

/** Variables every template may use, besides {{out.<id>}}. Shown as chips on the Workflow page. */
export const templateVars = [
  "key",
  "title",
  "step",
  "stepNumber",
  "stepCount",
  "taskDir",
  "specDir",
  "historyFile",
  "historyEntry",
  "outputs",
  "inputs",
  "rules",
  "language",
  "archiveDir",
  "previousRun",
  "feedback",
] as const;

/** Replaces {{name}} and {{out.id}}; unknown names are left as they are so mistakes stay visible. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

/** The task directory as Claude sees it from the repo root, with forward slashes. */
export function taskDirOf(taskKey: string): string {
  return path.posix.join(TASKS_DIR.split(path.sep).join("/"), taskKey);
}

/** Values of every template variable for step `stepIndex` of `def`, built from the workflow's own settings. */
export function promptVars(
  def: WorkflowDef,
  stepIndex: number,
  task: { key: string; title: string },
  opts: { previous?: RunState["previous"]; feedback?: string } = {},
): Record<string, string> {
  const taskDir = taskDirOf(task.key);
  const step = def.steps[stepIndex];
  const historyFile = `${taskDir}/${def.history.file}`;
  const list = (outs: WorkflowDef["steps"][number]["outputs"]) =>
    outs.map((o) => `- \`${taskDir}/${o.file}\`${o.content ? `: ${o.content}` : ""}`).join("\n");

  const base: Record<string, string> = {
    key: task.key,
    title: task.title,
    step: step?.title ?? "",
    stepNumber: String(stepIndex + 1),
    stepCount: String(def.steps.length),
    taskDir,
    specDir: `${taskDir}/${SPEC_DIR}`,
    historyFile,
    language: def.language,
    archiveDir: opts.previous ? `${taskDir}/${opts.previous.dir}` : "",
    ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
  };
  for (const s of def.steps) for (const o of s.outputs) base[`out.${o.id}`] = `${taskDir}/${o.file}`;

  return {
    ...base,
    historyEntry: render(def.history.entry, base),
    rules: def.rules.map((r) => `- ${render(r, base)}`).join("\n"),
    outputs: list(step?.outputs ?? []),
    inputs: list(def.steps.slice(0, Math.max(stepIndex, 0)).flatMap((s) => s.outputs)),
    previousRun: previousRun(def, opts.previous, taskDir, historyFile),
  };
}

/** Tells a restarted run where the previous run's documents went and which ones to read first. */
function previousRun(def: WorkflowDef, previous: RunState["previous"], taskDir: string, historyFile: string): string {
  if (!previous) return "";
  const dir = `${taskDir}/${previous.dir}`;
  const log = `- ${historyFile} (the latest "${HISTORY_TEXT.restart}" entry and the feedback before it)`;
  if (previous.files.length === 0) {
    return [
      "This task was restarted from the first step; the previous run had no documents to archive.",
      "Before anything else, read this to learn what was done before and why it was restarted:",
      log,
    ].join("\n");
  }
  const wanted = def.restart
    ? def.restart.read.flatMap((id) => def.steps.flatMap((s) => s.outputs).filter((o) => o.id === id).map((o) => o.file))
    : previous.files;
  const read = wanted.filter((f) => previous.files.includes(f));
  return [
    "This task was restarted from the first step. The previous run's documents were archived to",
    `${dir}/ (${previous.files.join(", ")}).`,
    "Before anything else, read these to learn what was done before and why it was restarted:",
    ...read.map((f) => `- ${dir}/${f}`),
    log,
  ].join("\n");
}
