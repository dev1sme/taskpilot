import path from "node:path";
import { AGENT_LABELS, DEFAULT_AGENT } from "../../core/agents.js";
import { SPEC_DIR, TASKS_DIR } from "../tasks/index.js";
import { PROMPT_TEXT } from "./prompt-text.js";
import type { RunState, WorkflowDef } from "./types.js";

/** Variables every template may use, besides {{out.<id>}}. Shown as chips on the Workflow page. */
export const templateVars = [
  "key",
  "title",
  "step",
  "agent",
  "stepNumber",
  "stepCount",
  "taskDir",
  "specDir",
  "historyFile",
  "historyEntry",
  "historyFormat",
  "outputs",
  "inputs",
  "rules",
  "language",
  "archiveDir",
  "previousRun",
  "feedback",
  "subtask",
  "subtaskReport",
  "subtasks",
] as const;

/** Replaces {{name}} and {{out.id}}; unknown names are left as they are so mistakes stay visible. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

/** A prompt as sent: variables filled, and the blank-line runs that empty ones (e.g. {{previousRun}}) leave collapsed. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return render(template, vars).replace(/\n{3,}/g, "\n\n");
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
  /** Each document of the step, with its skeleton when the workflow gives one; the skeleton rule is said once. */
  const documents = (outs: WorkflowDef["steps"][number]["outputs"]) => {
    const items = outs.map((o) => {
      const line = `- \`${taskDir}/${o.file}\`${o.content ? `: ${o.content}` : ""}`;
      return o.formatText === undefined ? line : `${line}\n\n${fence(render(o.formatText, base).trim())}`;
    });
    return [...(outs.some((o) => o.formatText !== undefined) ? [PROMPT_TEXT.skeleton] : []), ...items].join("\n\n");
  };

  const base: Record<string, string> = {
    key: task.key,
    title: task.title,
    step: step?.title ?? "",
    agent: AGENT_LABELS[step?.agent ?? DEFAULT_AGENT],
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
    historyFormat: fence(render(def.history.formatText ?? def.history.entry, base).trim()),
    rules: def.rules.map((r) => `- ${render(r, base)}`).join("\n"),
    outputs: documents(step?.outputs ?? []),
    inputs: list(def.steps.slice(0, Math.max(stepIndex, 0)).flatMap((s) => s.outputs)),
    previousRun: previousRun(def, opts.previous, taskDir, historyFile),
  };
}

/** A markdown code block; the fence grows past any backticks inside. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}markdown\n${text}\n${ticks}`;
}

/** Tells a restarted run where the previous run's documents went and which ones to read first. */
function previousRun(def: WorkflowDef, previous: RunState["previous"], taskDir: string, historyFile: string): string {
  if (!previous) return "";
  const dir = `${taskDir}/${previous.dir}`;
  const log = PROMPT_TEXT.restartLog(historyFile);
  if (previous.files.length === 0) return [PROMPT_TEXT.restartedEmpty, PROMPT_TEXT.readFirst, log].join("\n");
  const wanted = def.restart
    ? def.restart.read.flatMap((id) => def.steps.flatMap((s) => s.outputs).filter((o) => o.id === id).map((o) => o.file))
    : previous.files;
  const read = wanted.filter((f) => previous.files.includes(f));
  return [PROMPT_TEXT.restarted(dir, previous.files), PROMPT_TEXT.readFirst, ...read.map((f) => `- ${dir}/${f}`), log].join("\n");
}
