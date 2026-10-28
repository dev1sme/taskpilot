import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkForParallel, checkSubtaskLimit, parseAssignments } from "./assignments.js";
import type { ParsedAssignments } from "./types.js";
import { taskAbsoluteDir } from "./lane.js";
import type { SessionPort, ClaudeSubagentsOf } from "./ports.js";
import type { Assignment, RunState, WorkflowDef } from "./types.js";
import { subagentNamed, type ClaudeSubagentInfo } from "./prompt-vars.js";
import { ExecutionValidationError, resolveExecution } from "./execution.js";

/** The subtasks a dispatch step would get from the plan's table, with the problems that keep them from running. */
export async function assignmentsFor(run: RunState, def: WorkflowDef, index: number, subagents?: ClaudeSubagentsOf, preflight?: SessionPort["preflight"]): Promise<ParsedAssignments> {
  const dispatch = def.steps[index].dispatch!;
  const file = def.steps.flatMap((s) => s.outputs).find((o) => o.id === dispatch.from)?.file ?? "";
  const doc = await readFile(path.join(taskAbsoluteDir(run), file), "utf8").catch(() => "");
  const parsed = parseAssignments(doc);
  const errors = [
    ...(parsed.errors.length ? parsed.errors : [...checkSubtaskLimit(parsed.items, dispatch.maxSubtasks), ...checkForParallel(parsed.items, dispatch.parallel)]),
    ...(await assignmentProblems(run, def, index, parsed.items, subagents, preflight)),
  ];
  return { items: errors.length ? [] : parsed.items, errors };
}

/** Also used on persisted pending/retried rows, without re-reading or rewriting the approved table. */
export async function assignmentProblems(
  run: RunState,
  def: WorkflowDef,
  index: number,
  items: Assignment[],
  subagents?: ClaudeSubagentsOf,
  preflight?: SessionPort["preflight"],
): Promise<string[]> {
  const errors = await subagentProblems(run.repo, items, subagents);
  const checked = new Map<string, Awaited<ReturnType<NonNullable<SessionPort["preflight"]>>>>();
  for (const row of items) {
    try {
      const effective = resolveExecution({ workflow: def, run, scope: { kind: "subtask", stepId: def.steps[index].id, n: row.n }, assignment: row });
      if (preflight) {
        const { agent, model, subagent, permissionMode } = effective;
        const configuration = { agent, model, subagent, permissionMode };
        const key = JSON.stringify(configuration);
        const result = checked.get(key) ?? (await preflight(run.repo, configuration));
        checked.set(key, result);
        errors.push(...result.errors.map((p) => `subtask ${row.n}: ${p.field}: ${p.message}`));
      }
    } catch (error) {
      if (!(error instanceof ExecutionValidationError)) throw error;
      errors.push(...error.problems.map((p) => `subtask ${row.n}: ${p.field}: ${p.message}`));
    }
  }
  return errors;
}

/**
 * Why a Claude row's subagent cannot run its subtask: it must exist and be able to write, since a
 * member writes its report. Codex and Copilot agents are checked by the session preflight (assignmentProblems): a missing Copilot agent file only warns there, since built-in and plugin agents are not files.
 */
export async function subagentProblems(repo: string, items: Assignment[], subagents?: ClaudeSubagentsOf): Promise<string[]> {
  const named = items.filter((a) => a.agent === "claude" && a.subagent);
  if (!subagents || named.length === 0) return [];
  let list: ClaudeSubagentInfo[];
  try {
    list = await subagents(repo);
  } catch (e) {
    return [`cannot read the subagents: ${(e as Error).message}`];
  }
  return [
    ...named.flatMap((a) => {
      const agent = subagentNamed(list, a.subagent!);
      if (!agent) return [`subtask ${a.n}: subagent "${a.subagent}" not found in .claude/agents/ or ~/.claude/agents/`];
      if (!agent.check || agent.check.roles.includes("member")) return [];
      const why = agent.check.problems.length ? `: ${agent.check.problems.join("; ")}` : "";
      return [`subtask ${a.n}: subagent "${a.subagent}" cannot run a subtask${why}`];
    }),
  ];
}
