import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkForParallel, parseAssignments, type ParsedAssignments } from "./assignments.js";
import { taskDirOf } from "./lane.js";
import type { SubagentsOf } from "./ports.js";
import type { Assignment, RunState, WorkflowDef } from "./types.js";
import { subagentNamed, type SubagentInfo } from "./vars.js";
import { codexModelProblem } from "../../core/codex/models.js";
import { t } from "../../core/i18n.js";
import { launchModel } from "./models.js";

/** The subtasks a dispatch step would get from the plan's table, with the problems that keep them from running. */
export async function assignmentsFor(run: RunState, def: WorkflowDef, index: number, subagents?: SubagentsOf): Promise<ParsedAssignments> {
  const dispatch = def.steps[index].dispatch!;
  const file = def.steps.flatMap((s) => s.outputs).find((o) => o.id === dispatch.from)?.file ?? "";
  const doc = await readFile(path.join(taskDirOf(run), file), "utf8").catch(() => "");
  const parsed = parseAssignments(doc);
  const errors = [...(parsed.errors.length ? parsed.errors : checkForParallel(parsed.items, dispatch.parallel)), ...(await subagentProblems(run.repo, parsed.items, subagents))];
  for (const a of parsed.items.filter((a) => a.agent === "codex")) {
    if (def.permissionMode === "plan") errors.push(t("codex.modeUnsupported"));
    const model = launchModel(a.model);
    if (model) {
      const problem = await codexModelProblem(model);
      if (problem) errors.push(t("codex.modelUnknown", { detail: problem.message }));
    }
  }
  return { items: errors.length ? [] : parsed.items, errors };
}

/**
 * Why a Claude row's subagent cannot run its subtask: it must exist and be able to write, since a
 * member writes its report. Copilot's custom agents are not checked (TPL-019, question 2).
 */
export async function subagentProblems(repo: string, items: Assignment[], subagents?: SubagentsOf): Promise<string[]> {
  const unsupported = items.filter((a) => a.agent === "codex" && a.subagent).map((a) => `subtask ${a.n}: ${t("codex.subagentUnsupported")}`);
  const named = items.filter((a) => a.agent === "claude" && a.subagent);
  if (!subagents || named.length === 0) return unsupported;
  let list: SubagentInfo[];
  try {
    list = await subagents(repo);
  } catch (e) {
    return [`cannot read the subagents: ${(e as Error).message}`];
  }
  return [
    ...unsupported,
    ...named.flatMap((a) => {
      const agent = subagentNamed(list, a.subagent!);
      if (!agent) return [`subtask ${a.n}: subagent "${a.subagent}" not found in .claude/agents/ or ~/.claude/agents/`];
      if (!agent.check || agent.check.roles.includes("member")) return [];
      const why = agent.check.problems.length ? `: ${agent.check.problems.join("; ")}` : "";
      return [`subtask ${a.n}: subagent "${a.subagent}" cannot run a subtask${why}`];
    }),
  ];
}
