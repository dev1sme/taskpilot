import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedAssignments } from "./types.js";
import { modeOf } from "./definition.js";
import { ACTIVE_RUN_PHASES, dispatching, taskAbsoluteDir, withoutSnapshot } from "./lane.js";
import type { LoadDef } from "./ports.js";
import { parseQuestions } from "./questions.js";
import type { Question } from "./types.js";
import type { RunState, WorkflowDef } from "./types.js";
import { resolveExecution } from "./execution.js";
import { summarizeMetrics } from "./history.js";
import type { RunView } from "./types.js";

/** The view of `run` (the repo's active run for the task, if any) with the workflow it follows, else the one a new run would get. */
export async function buildRunView(
  repo: string,
  run: RunState | undefined,
  loadDef: LoadDef,
  assignmentsFor: (run: RunState, def: WorkflowDef, index: number) => Promise<ParsedAssignments>,
): Promise<RunView> {
  const pinned = run && ACTIVE_RUN_PHASES.includes(run.phase) ? run.workflow : undefined;
  // A running run is compared with its own mode as it is now; the repo's mode when no run is active.
  const current = await loadDef(repo, pinned ? modeOf(pinned).id : undefined).catch((e: unknown) => {
    if (pinned) return null;
    throw e;
  });
  const def = pinned ?? current!;
  return {
    runMode: run?.workflow ? modeOf(run.workflow) : null,
    workflow: {
      source: def.source,
      origin: def.origin,
      mode: modeOf(def),
      historyFile: def.history.file,
      steps: def.steps.map((s) => ({
        id: s.id,
        title: s.title,
        ...(() => {
          const effective = resolveExecution({ workflow: def, scope: { kind: "step", stepId: s.id }, run: pinned ? run : undefined });
          return { agent: effective.agent, model: effective.model, effective };
        })(),
        gate: s.gate,
        doneFile: s.doneWhen?.file ?? null,
        outputs: s.outputs.map((o) => ({ id: o.id, file: o.file })),
        dispatch: s.dispatch
          ? { from: s.dispatch.from, report: s.dispatch.report, parallel: s.dispatch.parallel, ...(s.dispatch.maxSubtasks !== undefined ? { maxSubtasks: s.dispatch.maxSubtasks } : {}) }
          : null,
      })),
      outdated: !!pinned && JSON.stringify(pinned) !== JSON.stringify(current),
    },
    run: run ? withoutSnapshot(run) : null,
    questions: run ? await questionsOf(run, def) : [],
    assignments: run?.phase === "gate" && def.steps[run.stepIndex + 1]?.dispatch ? await assignmentsFor(run, def, run.stepIndex + 1) : null,
    subtaskQuestions: Object.fromEntries((run?.subtasks ?? []).filter((s) => s.phase === "waiting").map((s) => [s.n, parseQuestions(s.lastMessage ?? "")])),
    usage: run ? summarizeMetrics(run) : null,
    subtaskUsage: Object.fromEntries(
      (run?.subtasks ?? []).map((sub) => [
        sub.n,
        summarizeMetrics(run!, { kind: "subtask", stepId: def.steps.slice(0, run!.stepIndex + 1).findLast((s) => s.dispatch)?.id ?? "", n: sub.n }),
      ]),
    ),
  };
}

/** At a gate: the open questions of the step's done-when document, else of Claude's last message. */
async function questionsOf(run: RunState, def: WorkflowDef): Promise<Question[]> {
  if (dispatching(run, def)) return [];
  if (run.phase === "gate") {
    const file = def.steps[run.stepIndex]?.doneWhen?.file;
    const doc = file ? await readFile(path.join(taskAbsoluteDir(run), file), "utf8").catch(() => "") : "";
    const fromDoc = parseQuestions(doc);
    if (fromDoc.length > 0) return fromDoc;
  }
  return run.phase === "gate" || run.phase === "waiting" ? parseQuestions(run.lastMessage ?? "") : [];
}
