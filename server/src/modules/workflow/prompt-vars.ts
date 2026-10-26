import path from "node:path";
import { PROVIDER_LABELS } from "../../core/providers.js";
import type { ProviderPromptInventory } from "../sessions/index.js";
import { SPEC_DIR, TASKS_DIR } from "../tasks/index.js";
import { HISTORY_TEXT, summarizeMetrics } from "./history.js";
import { PROMPT_TEXT } from "./prompt-text.js";
import { ExecutionValidationError, executionOfRun, resolveExecution } from "./execution.js";
import type { Assignment, RunState, SubtaskMetrics, WorkflowDef } from "./types.js";

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
  "subagents",
  "executionPolicy",
  "leaderTools",
] as const;

/**
 * A Claude subagent of the repo or the user, as the config module reads it (`subagentsOf`). The
 * workflow module only gets it handed in (see WorkflowEngine), so it never imports config.
 */
export interface ClaudeSubagentInfo {
  name: string;
  scope: "project" | "user";
  description: string;
  /** Frontmatter fields worth showing; `model` and `tools` are the ones read here. */
  fields: Array<{ key: string; value: string }>;
  /** What TaskPilot can use it as; no roles: not usable (broken, or hidden by a project agent). */
  check?: { status: "ok" | "warn" | "error"; roles: Array<"leader" | "member">; problems: string[] };
}

/** The agent Claude Code runs for `name`: the project's when both scopes have one. */
export function subagentNamed(list: ClaudeSubagentInfo[], name: string): ClaudeSubagentInfo | undefined {
  const same = list.filter((a) => a.name === name);
  return same.find((a) => a.scope === "project") ?? same[0];
}

/** Replaces {{name}} and {{out.id}}; unknown names are left as they are so mistakes stay visible. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

/** A prompt as sent: variables filled, and the blank-line runs that empty ones (e.g. {{previousRun}}) leave collapsed. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  // Engine-owned prefix survives custom templates that omit the variable, exactly once.
  const policy = vars.executionPolicy;
  const body = render(template, { ...vars, executionPolicy: "" });
  return `${policy ? `${policy}\n\n` : ""}${body}`.replace(/\n{3,}/g, "\n\n");
}

/** The task directory as Claude sees it from the repo root, with forward slashes. */
export function taskRelativeDir(taskKey: string): string {
  return path.posix.join(TASKS_DIR.split(path.sep).join("/"), taskKey);
}

/** Values of every template variable for step `stepIndex` of `def`, built from the workflow's own settings. */
export function promptVars(
  def: WorkflowDef,
  stepIndex: number,
  task: { key: string; title: string },
  opts: {
    /** Existing run policy only; repo defaults must never enter a running prompt. */
    run?: Pick<RunState, "execution" | "laneOverrides" | "attempts" | "sessionMetrics" | "handoffs">;
    previous?: RunState["previous"];
    feedback?: string;
    /** The subtask a dispatch step's prompt is for. */
    subtask?: Assignment & { report?: string };
    /** Every subtask of the run, for the step that reviews them; with the numbers of those done. */
    subtasks?: Array<Assignment & { report?: string; metrics?: SubtaskMetrics; sessionId?: string }>;
    /** The subagents a leader may assign, for {{subagents}}. */
    subagents?: ClaudeSubagentInfo[];
    /** For a leader whose provider lists its own agents and models (Copilot): them, for {{subagents}}. */
    inventory?: ProviderPromptInventory;
  } = {},
): Record<string, string> {
  const taskDir = taskRelativeDir(task.key);
  const step = def.steps[stepIndex];
  const effective = resolveExecution({
    workflow: def,
    run: opts.run,
    scope: opts.subtask ? { kind: "subtask", stepId: step.id, n: opts.subtask.n } : { kind: "step", stepId: step.id },
    assignment: opts.subtask,
  });
  const historyFile = `${taskDir}/${def.history.file}`;
  const list = (outs: WorkflowDef["steps"][number]["outputs"]) => outs.map((o) => `- \`${taskDir}/${o.file}\`${o.content ? `: ${o.content}` : ""}`).join("\n");
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
    agent: PROVIDER_LABELS[effective.agent],
    executionPolicy: [
      opts.run && (executionOfRun(opts.run).agent !== "workflow" || effective.source === "lane-override") ? PROMPT_TEXT.executionPolicy(executionOfRun(opts.run), effective) : "",
      opts.run?.handoffs?.some(
        (h) => h.stage === "committed" && h.scope.stepId === step.id && (opts.subtask ? h.scope.kind === "subtask" && h.scope.n === opts.subtask.n : h.scope.kind === "step"),
      )
        ? PROMPT_TEXT.afterHandoff
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    leaderTools: effective.agent === "claude" ? PROMPT_TEXT.leaderClaudeTools : PROMPT_TEXT.leaderOtherTools(PROVIDER_LABELS[effective.agent]),
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

  const dispatch = step?.dispatch;
  const reportOf = (a: { n: number; report?: string }) => `${taskDir}/${a.report ?? dispatch?.report.replaceAll("{{n}}", String(a.n)) ?? ""}`;
  const sub = opts.subtask && { ...opts.subtask, agent: effective.agent, model: effective.model, subagent: effective.subagent };
  const subtaskVars: Record<string, string> = {};
  if (sub && dispatch) {
    Object.assign(subtaskVars, {
      subtask: subtaskBlock(sub, opts.subtasks ?? [], dispatch.parallel, reportOf),
      subtaskReport: reportOf(sub),
      outputs: documents([{ id: "report", file: reportOf(sub).slice(taskDir.length + 1), content: PROMPT_TEXT.subtask.report, format: dispatch.format, formatText: dispatch.formatText }]),
    });
  }
  const all = opts.subtasks ?? [];
  const dispatchStep = def.steps.slice(0, stepIndex + 1).findLast((s) => s.dispatch);
  const lastDispatch = dispatchStep?.dispatch;
  const listed = all.map((a) => {
    const scope = { kind: "subtask" as const, stepId: dispatchStep?.id ?? step.id, n: a.n };
    let worker: Pick<Assignment, "agent" | "subagent" | "model"> = a;
    let problem = "";
    try {
      worker = resolveExecution({ workflow: def, run: opts.run, scope, assignment: a });
    } catch (error) {
      // A malformed pending sibling must not prevent a valid member from continuing. Its
      // assignment stays visible and launch validation still blocks that sibling itself.
      if (!(error instanceof ExecutionValidationError)) throw error;
      problem = PROMPT_TEXT.pendingAssignmentProblem(error.message);
    }
    const summary = opts.run ? summarizeMetrics({ ...opts.run, subtasks: [a] }, scope) : undefined;
    const attempts = opts.run?.attempts?.filter((attempt) => attempt.scope.kind === "subtask" && attempt.scope.stepId === scope.stepId && attempt.scope.n === a.n);
    const provenance = summary?.sessions.length ? HISTORY_TEXT.usage(summary, attempts) : "";
    const displayMetrics = a.metrics && opts.run ? { ...a.metrics, model: attempts?.findLast((attempt) => attempt.sessionId === a.sessionId)?.actualModel } : a.metrics;
    return (
      PROMPT_TEXT.subtaskLine(
        a.n,
        HISTORY_TEXT.worker(PROVIDER_LABELS[worker.agent], worker.subagent, worker.model),
        a.title,
        `${taskDir}/${a.report ?? lastDispatch?.report.replaceAll("{{n}}", String(a.n)) ?? ""}`,
      ) +
      (displayMetrics ? ` · ${summary && summary.sessions.length > 1 ? PROMPT_TEXT.currentSessionMetrics : ""}${HISTORY_TEXT.metrics(displayMetrics)}` : "") +
      problem +
      (provenance ? `\n${provenance}` : "")
    );
  });

  return {
    ...base,
    historyEntry: render(def.history.entry, base),
    historyFormat: fence(render(def.history.formatText ?? def.history.entry, base).trim()),
    rules: rulesFor(def.rules, base, !!opts.subtask),
    outputs: documents(step?.outputs ?? []),
    inputs: list(def.steps.slice(0, Math.max(stepIndex, 0)).flatMap((s) => s.outputs)),
    previousRun: previousRun(def, opts.previous, taskDir, historyFile),
    subtasks: listed.join("\n"),
    subagents: opts.inventory ? inventoryList(opts.inventory) : subagentList(opts.subagents ?? []),
    ...subtaskVars,
  };
}

/**
 * The workflow rules as a list. A subtask's prompt drops the rules that mention {{historyFile}}
 * (e.g. "append to the log"): TaskPilot writes the subtask's history entry itself, and a member that
 * obeys such a rule writes a second one. Only rules written with the variable are caught; a path
 * typed out in a user's override stays.
 */
function rulesFor(rules: string[], vars: Record<string, string>, forSubtask: boolean): string {
  const kept = forSubtask ? rules.filter((r) => !r.includes("{{historyFile}}")) : rules;
  return kept.map((r) => `- ${render(r, vars)}`).join("\n");
}

/** The description of one subtask: what to do, where, and which earlier reports to read. */
function subtaskBlock(sub: Assignment, all: Array<Assignment & { report?: string }>, parallel: number, reportOf: (a: { n: number; report?: string }) => string): string {
  const T = PROMPT_TEXT.subtask;
  const lines = [T.heading(sub.n, sub.title)];
  if (sub.output) lines.push(T.output(sub.output));
  if (sub.subagent || sub.model) lines.push(T.runsAs(sub.subagent, sub.model));
  lines.push(sub.files.length ? T.files(sub.files) : T.noFiles);
  const deps = sub.deps.map((d) => all.find((a) => a.n === d)).filter((a): a is Assignment & { report?: string } => !!a);
  if (deps.length) lines.push("", T.dependsOn, ...deps.map((d) => T.dependency(reportOf(d), d.n, d.title)));
  if (parallel > 1) lines.push("", T.noCommit);
  return lines.join("\n");
}

/** The usable subagents, one line each; a project agent hides the user's agent of the same name. */
function subagentList(list: ClaudeSubagentInfo[]): string {
  const T = PROMPT_TEXT.subagents;
  const usable = list.filter((a) => a.check?.roles.length && subagentNamed(list, a.name) === a);
  if (usable.length === 0) return T.none;
  const field = (a: ClaudeSubagentInfo, key: string) => a.fields.find((f) => f.key === key)?.value;
  return usable.map((a) => T.line(a.name, a.scope, oneLine(a.description), field(a, "model"), field(a, "tools"), a.check!.roles)).join("\n");
}

/** A provider's custom agents and the models it accepts; the leader fills the table's Subagent and Model columns from it. */
function inventoryList({ agents, models }: ProviderPromptInventory): string {
  const T = PROMPT_TEXT.subagents.copilot;
  return [
    agents.length ? agents.map((a) => T.agentLine(a.name, a.scope, a.description && oneLine(a.description), a.model)).join("\n") : T.noAgents,
    models?.length ? T.models(models) : T.noModels,
  ].join("\n\n");
}

/** A description on one line and short enough for a list; agent descriptions often carry examples. */
function oneLine(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
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
    ? def.restart.read.flatMap((id) =>
        def.steps
          .flatMap((s) => s.outputs)
          .filter((o) => o.id === id)
          .map((o) => o.file),
      )
    : previous.files;
  const read = wanted.filter((f) => previous.files.includes(f));
  return [PROMPT_TEXT.restarted(dir, previous.files), PROMPT_TEXT.readFirst, ...read.map((f) => `- ${dir}/${f}`), log].join("\n");
}
