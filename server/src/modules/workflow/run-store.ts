import { HttpError } from "../../core/errors.js";
import { writeTaskStatus, type TaskStatus } from "../tasks/index.js";
import type { StateStore } from "../../core/state.js";
import { appendHandoffHistory, appendHistory } from "./history.js";
import type { SafeText } from "../../core/safe-text.js";
import { ACTIVE, laneOf, taskDirOf } from "./lane.js";
import type { LoadDef } from "./ports.js";
import type { HandoffJournal, RunState, WorkflowDef } from "./types.js";

/** The runs kept in the state file and the task's decision log; what the engine reads and writes of them. */
export class RunStore {
  constructor(
    private readonly state: StateStore,
    private readonly loadDef: LoadDef,
    private readonly onChange: (run: RunState) => void,
    private readonly onWarning: (error: unknown) => void,
  ) {}

  /** The workflow the run started with; runs saved before snapshots existed follow the current one. */
  defOf(run: RunState): Promise<WorkflowDef> {
    return run.workflow ? Promise.resolve(run.workflow) : this.loadDef(run.repo);
  }

  /** Appends to the task's decision log; a failed write is reported but never blocks the run. */
  async log(run: RunState, source: string, extra: { body?: string; quote?: string } = {}): Promise<void> {
    try {
      const def = await this.defOf(run);
      const step = def.steps[run.stepIndex];
      await appendHistory(taskDirOf(run), def.history.file, run.taskKey, { at: Date.now(), step: step?.title ?? "", source, ...extra });
    } catch (e) {
      this.onWarning(e);
    }
  }

  /** Records in `task.yml` that the run finished or started; a failed write is reported but never blocks the run. */
  async markTask(run: RunState, status: TaskStatus["status"]): Promise<void> {
    try {
      await writeTaskStatus(taskDirOf(run), status);
    } catch (e) {
      this.onWarning(e);
    }
  }

  async save(run: RunState, patch: Partial<RunState>): Promise<RunState> {
    const next = structuredClone({ ...run, ...patch, updatedAt: Date.now() });
    await this.state.update((s) => {
      s.runs = s.runs.filter((r) => !(r.repo === next.repo && r.taskKey === next.taskKey));
      s.runs.push(next);
    });
    Object.assign(run, patch, { updatedAt: next.updatedAt });
    this.onChange(structuredClone(next));
    return run;
  }

  /** Transaction callers hold detached state: publish only after the durable write succeeds. */
  async checkpoint(run: RunState): Promise<void> {
    const next = structuredClone({ ...run, updatedAt: Date.now() });
    await this.state.update((s) => {
      s.runs = s.runs.filter((r) => !(r.repo === next.repo && r.taskKey === next.taskKey));
      s.runs.push(next);
    });
    run.updatedAt = next.updatedAt;
    this.onChange(structuredClone(next));
  }

  async logHandoff(run: RunState, operation: HandoffJournal, sanitize: SafeText): Promise<void> {
    try {
      const def = await this.defOf(run);
      await appendHandoffHistory(taskDirOf(run), def.history.file, run.taskKey, sanitize(def.steps[run.stepIndex]?.title ?? "", 500), operation, sanitize);
    } catch (error) {
      this.onWarning(new Error(sanitize(error instanceof Error ? error.message : "Handoff history write failed")));
    }
  }

  async find(repo: string, taskKey: string): Promise<RunState | undefined> {
    const run = (await this.state.load()).runs.find((r) => r.repo === repo && r.taskKey === taskKey);
    return run ? structuredClone(run) : undefined;
  }

  async bySession(sessionId: string): Promise<RunState | undefined> {
    const run = (await this.state.load()).runs.find((r) => laneOf(r, sessionId) && ACTIVE.includes(r.phase));
    return run ? structuredClone(run) : undefined;
  }

  async require(repo: string, taskKey: string, phases: ReadonlyArray<RunState["phase"]>): Promise<RunState> {
    const run = await this.find(repo, taskKey);
    if (!run) throw new HttpError(404, "No workflow run for this task");
    if (!phases.includes(run.phase)) throw new HttpError(409, `Not allowed while the run is ${run.phase}`);
    return run;
  }
}
