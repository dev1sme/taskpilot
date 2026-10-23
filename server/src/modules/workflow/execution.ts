import { DEFAULT_AGENT, isAgent } from "../../core/agents.js";
import { launchModel, modelProblem } from "./models.js";
import type {
  AgentExecution,
  Assignment,
  EffectiveExecution,
  ExecutionProblem,
  ExecutionSelection,
  ExecutionSnapshot,
  LaneScope,
  RunState,
  SelectedExecution,
  WorkflowDef,
} from "./types.js";

export class ExecutionValidationError extends Error {
  constructor(readonly problems: ExecutionProblem[]) {
    super(problems.map((p) => `${p.n === undefined ? "" : `subtask ${p.n}: `}${p.field}: ${p.message}`).join("; "));
    this.name = "ExecutionValidationError";
  }
}

/** Structural/syntax validation only. Capability/preflight must check the account separately. */
export function parseExecution(value: unknown, field = "execution"): ExecutionSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(field, "must be an execution choice");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => key !== "agent" && key !== "model")) return invalid(field, "only agent and model are allowed");
  if (data.agent === "workflow") {
    if (data.model !== undefined) return invalid(`${field}.model`, "must be absent when agent is workflow");
    return { agent: "workflow" };
  }
  if (!isAgent(data.agent)) return invalid(`${field}.agent`, "must be workflow, claude, copilot or codex");
  if (data.model !== undefined) {
    const problem = modelProblem(data.agent, data.model);
    if (problem) return invalid(`${field}.model`, problem);
  }
  const model = launchModel(data.model as string | undefined);
  return { agent: data.agent, ...(model === undefined ? {} : { model }) };
}

/** New runs only: a supplied choice is complete, including an explicit workflow choice. */
export function selectExecution(request?: unknown, repoDefault?: unknown): SelectedExecution {
  if (request !== undefined) return { execution: parseExecution(request), source: "request" };
  if (repoDefault !== undefined) return { execution: parseExecution(repoDefault), source: "repo" };
  return { execution: { agent: "workflow" }, source: "workflow" };
}

/** Never consult repo defaults for an existing run, including a legacy run. */
export function executionOfRun(run: Pick<RunState, "execution">): ExecutionSelection {
  return run.execution === undefined ? { agent: "workflow" } : parseExecution(run.execution);
}

/** JSON tuple encoding avoids collisions for custom step ids containing punctuation. */
export function laneKey(scope: LaneScope): string {
  return JSON.stringify(scope.kind === "step" ? ["step", scope.stepId] : ["subtask", scope.stepId, scope.n]);
}

export interface ResolveExecutionOptions {
  workflow: WorkflowDef;
  scope: LaneScope;
  run?: Pick<RunState, "execution" | "laneOverrides">;
  assignment?: Assignment;
}

/** One resolver for preview and launch. Returns new objects and never rewrites a table or snapshot. */
export function resolveExecution({ workflow, scope, run = {}, assignment }: ResolveExecutionOptions): EffectiveExecution {
  const step = workflow.steps.find((s) => s.id === scope.stepId);
  if (!step) return invalid("scope.stepId", `unknown step ${scope.stepId}`);
  if (scope.kind === "subtask" && (!step.dispatch || !assignment || assignment.n !== scope.n)) {
    return invalid("scope", "a subtask needs its dispatch step and matching assignment");
  }
  const row = scope.kind === "subtask" ? assignment : undefined;
  const base = row ?? step;
  const policy = executionOfRun(run);
  const override = run.laneOverrides?.[laneKey(scope)];
  let choice: AgentExecution;
  let source: EffectiveExecution["source"];
  if (override) {
    if (laneKey(override.scope) !== laneKey(scope)) return invalid("laneOverrides", "scope does not match its key");
    const parsed = parseExecution(override.execution, "laneOverrides.execution");
    if (parsed.agent === "workflow") return invalid("laneOverrides.execution.agent", "must be a concrete agent");
    choice = parsed;
    source = "lane-override";
    // A resolver cannot prove equivalence of restrictions across CLIs. Never silently strip them.
    if (row?.subagent && choice.agent !== row.agent) return invalid("subagent", "cross-agent transfer of a subagent requires equivalent restrictions");
  } else if (policy.agent !== "workflow") {
    if (row) {
      const problems = assignmentExecutionProblems([row], policy);
      if (problems.length) throw new ExecutionValidationError(problems);
    }
    choice = policy;
    source = "execution";
  } else {
    choice = { agent: base.agent ?? DEFAULT_AGENT, model: base.model };
    source = row ? "assignment" : "workflow";
  }
  const model = launchModel(choice.model);
  const effective: EffectiveExecution = {
    agent: choice.agent,
    ...(model === undefined ? {} : { model }),
    ...(row?.subagent ? { subagent: row.subagent } : {}),
    ...(workflow.permissionMode === undefined ? {} : { permissionMode: workflow.permissionMode }),
    source,
    modelSource: model === undefined ? "default" : "explicit",
  };
  if (effective.agent === "codex" && effective.permissionMode === "plan") return invalid("permissionMode", "Codex does not support plan; choose a compatible configuration");
  if (effective.agent === "codex" && effective.subagent) return invalid("subagent", "Codex does not support subagents");
  return effective;
}

/** Validate, never normalize, rows under a concrete run policy. Existing subagent checks still apply. */
export function assignmentExecutionProblems(items: readonly Assignment[], execution?: ExecutionSelection): ExecutionProblem[] {
  const policy = execution === undefined ? { agent: "workflow" as const } : parseExecution(execution);
  if (policy.agent === "workflow") return [];
  return items.flatMap((row) => {
    const problems: ExecutionProblem[] = [];
    if (row.agent !== policy.agent) problems.push({ n: row.n, field: "agent", message: `must be ${policy.agent}` });
    if (launchModel(row.model) !== policy.model) problems.push({ n: row.n, field: "model", message: `must be ${policy.model ?? "- (default or inherit)"}` });
    if (row.subagent && (row.agent !== policy.agent || policy.agent === "codex"))
      problems.push({ n: row.n, field: "subagent", message: `must be absent for ${policy.agent}; use a compatible assignment` });
    return problems;
  });
}

export function snapshotExecution(workflow: WorkflowDef, selected: SelectedExecution): ExecutionSnapshot {
  const execution = parseExecution(selected.execution);
  return {
    version: 1,
    execution,
    source: selected.source,
    steps: Object.fromEntries(workflow.steps.map((step) => [step.id, resolveExecution({ workflow, scope: { kind: "step", stepId: step.id }, run: { execution } })])),
  };
}

function invalid(field: string, message: string): never {
  throw new ExecutionValidationError([{ field, message }]);
}
