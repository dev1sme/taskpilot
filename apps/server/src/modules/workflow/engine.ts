import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PROVIDER_LABELS, DEFAULT_PROVIDER } from "@taskpilot/shared";
import { HttpError } from "../../core/errors.js";
import { getTask, TASKS_DIR, writeTaskStatus } from "../tasks/index.js";
import { providerTraits, requirePreflight, type SessionEvent, type SessionMetrics, type PreflightResult } from "../sessions/index.js";
import type { SessionMeta, StateStore } from "../../core/state.js";
import { overlaps } from "./assignments.js";
import { loadWorkflow, modeOf, OVERRIDE_DIR, reportOf } from "./definition.js";
import { CUSTOM_MODE } from "./modes.js";
import { launchModel } from "./models.js";
import { archiveOutputs } from "./archive.js";
import { HISTORY_TEXT, measuredMetrics, mergeCumulative, summarizeMetrics } from "./history.js";
import { updateCodexMeasurement } from "./metrics-observation.js";
import { PROMPT_TEXT } from "./prompt-text.js";
import { ACTIVE_RUN_PHASES, agentLabel, dispatching, laneBlocked, laneOf, outputBaseline, sessionLabel, syncDispatch, taskAbsoluteDir, writtenSince, type Lane } from "./lane.js";
import type { LoadDef, SessionPort, ClaudeSubagentsOf, WorkspacePort } from "./ports.js";
import type { RunWorkspace, WorkspaceDiff, WorkspaceView, WorktreeCheck } from "../workspace/types.js";
import { WorktreeConflict } from "../workspace/manager.js";
import { assignmentsFor, assignmentProblems } from "./run-checks.js";
import { ExecutionValidationError, resolveExecution, selectExecution, snapshotExecution } from "./execution.js";
import { readRepoSettings } from "./repo-settings.js";
import { RunStore } from "./run-store.js";
import { buildRunView } from "./run-view.js";
import type { RunView } from "./types.js";
import type { Assignment, EffectiveExecution, ExecutionSelection, LaneScope, MetricsSource, RunState, SubtaskMetrics, SubtaskPhase, SubtaskRun, WorkflowDef } from "./types.js";
import { promptVars, renderPrompt } from "./prompt-vars.js";
import { t } from "../../core/i18n.js";
import { createSafeText } from "../../core/safe-text.js";
import { HandoffCoordinator, type HandoffSanitizer } from "./handoff.js";
import type { HandoffCommitRequest, HandoffRequest } from "./types.js";
import { SerialQueue } from "../../core/serial.js";

export type { LoadDef, ClaudeSubagentsOf, SessionPort } from "./ports.js";
export type { RunView } from "./types.js";

/** How long a Copilot session may stay without any hook after its prompt before the run says so. */
const NO_HOOK_WARN_MS = 60_000;

export interface RunOptions {
  mode?: string;
  execution?: ExecutionSelection;
  /** "worktree": the run executes in a new Git worktree of its own; absent/"repo": in the repo, as before. */
  isolation?: "repo" | "worktree";
  /** The user saw the repo's uncommitted files and accepts that the worktree starts from HEAD without them. */
  acceptDirtyBase?: boolean;
}

/**
 * Drives one workflow run per task: sends each step's prompt into the run's Claude session,
 * advances on the Stop hook when the step's done-when file was written, and stops at gates.
 */
export class WorkflowEngine extends EventEmitter<{ change: [run: RunState]; warning: [error: unknown] }> {
  private readonly queue = new SerialQueue();

  private readonly store: RunStore;
  private readonly handoff: HandoffCoordinator;

  constructor(
    private readonly state: StateStore,
    private readonly sessions: SessionPort,
    private readonly loadDef: LoadDef = (repo, mode) => loadWorkflow(repo, mode),
    /** Without it the table's subagents are not checked and {{subagents}} lists none. */
    private readonly subagents?: ClaudeSubagentsOf,
    private readonly noHookWarnMs: number = NO_HOOK_WARN_MS,
    sanitizer: HandoffSanitizer = async () => createSafeText([]),
    /** Without it runs cannot use a worktree (isolation "worktree" is refused). */
    private readonly worktrees?: WorkspacePort,
  ) {
    super();
    this.store = new RunStore(
      state,
      loadDef,
      (run) => this.emit("change", run),
      (e) => this.emit("warning", e),
    );
    this.handoff = new HandoffCoordinator(this.store, sessions, sanitizer);
  }

  previewHandoff(repo: string, taskKey: string, request: HandoffRequest) {
    return this.serial(async () => {
      const result = await this.handoff.preview(repo, taskKey, request);
      // Capture an old flat object after successful validation, before a later durable swap
      // clears it. This does not change the lane fingerprint or claim backend provenance.
      const run = (await this.store.find(repo, taskKey))!;
      const legacy = run.subtasks?.find((s) => s.sessionId === result.preview.sourceSessionId);
      if (legacy?.metrics && !run.sessionMetrics?.some((m) => m.sessionId === legacy.sessionId)) {
        (run.sessionMetrics ??= []).push({ sessionId: legacy.sessionId!, agent: legacy.agent, source: "legacy", basis: "unknown", metrics: measuredMetrics(legacy.metrics) });
        await this.store.checkpoint(run);
      }
      return result;
    });
  }

  commitHandoff(repo: string, taskKey: string, request: HandoffCommitRequest) {
    return this.serial(async () => {
      const duplicate = (await this.store.find(repo, taskKey))?.handoffs?.some((entry) => entry.operationId === request.operationId);
      const result = await this.handoff.commit(repo, taskKey, request);
      const committed = await this.store.find(repo, taskKey);
      if (committed) {
        const source = committed.attempts?.findLast((a) => a.sessionId === result.operation.sourceSessionId);
        if (source && source.finishedAt === undefined) {
          source.finishedAt = result.operation.updatedAt;
          await this.store.checkpoint(committed);
        }
      }
      if (!duplicate && result.operation.promptState === "sent") {
        const run = (await this.store.find(repo, taskKey))!;
        const lane = laneOf(run, result.operation.targetSessionId!);
        if (lane?.sentPrompt) this.watchForHooks(run, lane, lane.sentPrompt.at, await this.store.defOf(run));
      }
      return result;
    });
  }

  /** The active run's workflow snapshot, else the workflow a new run would get. */
  async view(repo: string, taskKey: string): Promise<RunView> {
    return buildRunView(repo, await this.store.find(repo, taskKey), this.loadDef, (run, def, index) =>
      assignmentsFor(run, def, index, this.subagents, this.sessions.preflight?.bind(this.sessions)),
    );
  }

  /** Read-only; the same selection, renderer and preflight used by start/restart. */
  async preview(repo: string, taskKey: string, options?: string | RunOptions) {
    const prepared = await this.prepare(repo, options);
    const { def, selected, snapshot, checks } = prepared;
    const task = await getTask(repo, taskKey);
    const subagents = def.steps.some((s) => s.prompt.includes("{{subagents}}") || s.prompt.includes("{{leaderTools}}")) && this.subagents ? await this.subagents(repo) : undefined;
    const inventories = await Promise.all(def.steps.map((step, index) => this.promptInventory(repo, def, index, step.prompt, { execution: selected.execution })));
    return {
      workflow: { source: def.source, mode: modeOf(def) },
      execution: selected.execution,
      source: selected.source,
      steps: def.steps.map((step, index) => {
        const inventory = inventories[index];
        const configured = resolveExecution({ workflow: def, scope: { kind: "step", stepId: step.id } });
        const effective = snapshot.steps[step.id];
        const vars = promptVars(def, index, task, { run: { execution: selected.execution }, subagents, inventory, feedback: PROMPT_TEXT.sampleFeedback });
        return {
          id: step.id,
          configured,
          effective,
          changes: (["agent", "model", "permissionMode", "subagent"] as const).filter((field) => configured[field] !== effective[field]),
          preflight: checks[index],
          // Dispatch prompts need a real assignment; the table is checked at its gate.
          prompt: step.dispatch ? null : renderPrompt(step.prompt, vars),
          onReject: step.onReject === undefined ? null : renderPrompt(step.onReject, vars),
        };
      }),
      errors: checks.flatMap((check, index) => check.errors.map((error) => ({ stepId: def.steps[index].id, ...error }))),
      warnings: checks.flatMap((check, index) =>
        (["login", "models"] as const)
          .filter((field) => check.capability[field].status === "unknown")
          .map((field) => ({ stepId: def.steps[index].id, field, status: "unknown" as const, source: check.capability[field].source })),
      ),
    };
  }

  private async prepare(repo: string, options?: string | RunOptions) {
    const opts = typeof options === "string" ? { mode: options } : (options ?? {});
    const settings = await readRepoSettings(repo, { diagnostics: true });
    if (settings.errors?.length) throw new ExecutionValidationError(settings.errors);
    const selected = selectExecution(opts.execution, settings.execution);
    const def = await this.loadDef(repo, opts.mode);
    const snapshot = snapshotExecution(def, selected);
    const checks: PreflightResult[] = [];
    const seen = new Map<string, PreflightResult>();
    for (const step of def.steps) {
      const effective = snapshot.steps[step.id];
      const key = JSON.stringify(this.launchConfig(effective));
      const check = seen.get(key) ?? (await this.preflight(repo, effective));
      seen.set(key, check);
      checks.push(check);
    }
    return { def, selected, snapshot, checks, isolation: opts.isolation ?? "repo", acceptDirtyBase: opts.acceptDirtyBase === true };
  }

  /** Starts a run in `mode` (a workflows/ directory, or "custom"); the repo's own mode when absent. */
  start(repo: string, taskKey: string, options?: string | RunOptions): Promise<RunState> {
    return this.serial(async () => {
      const existing = await this.store.find(repo, taskKey);
      if (existing) this.assertRecovered(existing);
      if (existing && ACTIVE_RUN_PHASES.includes(existing.phase)) throw new HttpError(409, "A workflow run is already active");
      const prepared = await this.prepare(repo, options);
      prepared.checks.forEach(requirePreflight);
      const placed = await this.place(repo, taskKey, prepared);
      return this.begin(repo, taskKey, prepared, placed);
    });
  }

  /**
   * Starts over from the first step in a new session, whatever the current phase. The old session
   * is stopped (it stays listed) and the task's documents are copied to archive/ first: Claude then
   * rewrites them in place, so the step names and done-when files do not change.
   */
  restart(repo: string, taskKey: string, options?: string | RunOptions): Promise<RunState> {
    return this.serial(async () => {
      const existing = await this.store.find(repo, taskKey);
      if (!existing) throw new HttpError(409, "No workflow run to restart; start one first");
      this.assertRecovered(existing);
      // Loaded before anything is stopped or archived: a bad mode or a broken workflow changes nothing.
      const next = await this.prepare(repo, options);
      next.checks.forEach(requirePreflight);
      // Also before anything changes: a dirty repo or a failed worktree leaves the old run as it was.
      const placed = await this.place(repo, taskKey, next);
      const old = await this.sessions.get(existing.sessionId).catch(() => null);
      if (old?.status === "running") await this.sessions.stop(existing.sessionId);
      for (const sub of existing.subtasks ?? []) {
        if (sub.sessionId && (await this.sessions.get(sub.sessionId).catch(() => null))?.status === "running") await this.sessions.stop(sub.sessionId);
      }
      const before = await this.store.defOf(existing);
      const previous = await archiveOutputs(taskAbsoluteDir(existing), before.history.file, new Date());
      await this.store.log(existing, HISTORY_TEXT.restart, {
        body: previous.files.length ? HISTORY_TEXT.archived(previous.dir, previous.files) : HISTORY_TEXT.nothingArchived,
      });
      return this.begin(repo, taskKey, next, placed, previous);
    });
  }

  /**
   * The run id and, for isolation "worktree", the worktree the new run will execute in, made
   * before any session. Every step's agent is checked again there: subagent files are read from
   * the worktree, which has no Git-ignored files of the repo.
   */
  private async place(repo: string, taskKey: string, prepared: Awaited<ReturnType<WorkflowEngine["prepare"]>>): Promise<{ runId: string; workspace?: RunWorkspace }> {
    const runId = randomUUID();
    if (prepared.isolation !== "worktree") return { runId };
    if (!this.worktrees) throw new HttpError(503, t("worktree.notGit"));
    for (const step of prepared.def.steps) {
      const { agent } = prepared.snapshot.steps[step.id];
      if (!providerTraits(agent).supportsExtraDirs) throw new HttpError(400, t("worktree.unsupported", { agent: PROVIDER_LABELS[agent] }));
    }
    const workspace = await this.worktrees.create(repo, taskKey, runId, { acceptDirty: prepared.acceptDirtyBase });
    try {
      const seen = new Set<string>();
      for (const step of prepared.def.steps) {
        const effective = prepared.snapshot.steps[step.id];
        const key = JSON.stringify(this.launchConfig(effective));
        if (seen.has(key)) continue;
        seen.add(key);
        requirePreflight(await this.preflight(repo, effective, workspace.cwd));
      }
    } catch (error) {
      await this.worktrees.discardUnused(workspace).catch((e: unknown) => this.emit("warning", e));
      throw error;
    }
    return { runId, workspace };
  }

  /**
   * A new run on a new session at step 1, pinned to the workflow as it is now; callers hold the
   * queue. `previous` is what a restart archived, for {{previousRun}}.
   */
  private async begin(
    repo: string,
    taskKey: string,
    prepared: Awaited<ReturnType<WorkflowEngine["prepare"]>>,
    placed: { runId: string; workspace?: RunWorkspace },
    previous?: RunState["previous"],
  ): Promise<RunState> {
    const { def, selected, snapshot } = prepared;
    const { runId, workspace } = placed;
    const placement = { repo, taskKey, runId, ...(workspace ? { workspace: { path: workspace.path, cwd: workspace.cwd, branch: workspace.branch } } : {}) };
    let session: Awaited<ReturnType<SessionPort["create"]>>;
    try {
      session = await this.sessions.create(repo, taskKey, { ...this.launchConfig(snapshot.steps[def.steps[0].id]), ...this.placement(placement) });
    } catch (error) {
      // No run refers to the worktree yet and no agent ran in it.
      if (workspace) await this.worktrees?.discardUnused(workspace).catch((e: unknown) => this.emit("warning", e));
      throw error;
    }
    const now = Date.now();
    const run: RunState = {
      ...placement,
      sessionId: session.id,
      stepIndex: 0,
      phase: "starting",
      stepStartedAt: now,
      message: "",
      workflow: def,
      execution: selected.execution,
      executionSnapshot: snapshot,
      ...(previous ? { previous } : {}),
      startedAt: now,
      updatedAt: now,
    };
    this.recordExecution(run, session, { kind: "step", stepId: def.steps[0].id }, snapshot.steps[def.steps[0].id]);
    const mode = modeOf(def);
    // A "custom" workflow is the override itself; for the others the override is added to the built-in one.
    const override = mode.override && mode.id !== CUSTOM_MODE ? `${OVERRIDE_DIR.split(path.sep).join("/")}/` : null;
    const name = mode.id === CUSTOM_MODE ? `${OVERRIDE_DIR.split(path.sep).join("/")}/` : mode.name;
    await this.store.markTask(run, "open");
    await this.store.log(run, HISTORY_TEXT.start, {
      body: [
        HISTORY_TEXT.startBody(name, override, def.steps.length),
        workspace ? HISTORY_TEXT.worktreeBody(workspace.path, workspace.branch, workspace.baseRev, workspace.dirtyBaseAccepted) : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    await this.deliver(run, await this.prompt(run, def.steps[0].prompt));
    return run;
  }

  /**
   * Approves the gate. `note` (e.g. answers to Claude's open questions) is quoted in the decision
   * log, which the next step's prompt has Claude read first.
   */
  approve(repo: string, taskKey: string, note = ""): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.store.require(repo, taskKey, ["gate"]);
      this.assertRecovered(run);
      const def = await this.store.defOf(run);
      const last = run.stepIndex + 1 >= def.steps.length;
      const table = !last && def.steps[run.stepIndex + 1].dispatch ? await assignmentsFor(run, def, run.stepIndex + 1, this.subagents, this.sessions.preflight?.bind(this.sessions)) : null;
      if (table && table.errors.length > 0) throw new HttpError(400, t("run.assignmentsInvalid", { errors: table.errors.join("; ") }));
      await this.store.log(run, HISTORY_TEXT.approve, { ...(note.trim() ? { quote: note.trim() } : {}), ...(last ? { body: HISTORY_TEXT.done } : {}) });
      if (last) return this.finishRun(run);
      await this.enterStep(run, def, run.stepIndex + 1, table?.items);
      return run;
    });
  }

  feedback(repo: string, taskKey: string, text: string): Promise<RunState> {
    return this.serial(async () => {
      if (!text.trim()) throw new HttpError(400, "Feedback is empty");
      const run = await this.store.require(repo, taskKey, ["gate"]);
      this.assertRecovered(run);
      const step = (await this.store.defOf(run)).steps[run.stepIndex];
      const template = step.onReject ?? "{{feedback}}";
      await this.store.log(run, HISTORY_TEXT.feedback, { quote: text.trim() });
      await this.deliver(run, await this.prompt(run, template, { feedback: text.trim() }));
      return run;
    });
  }

  /** Answers Claude while it waits (it ended its turn without the step's document): logged, then pasted as it is. */
  reply(repo: string, taskKey: string, text: string): Promise<RunState> {
    return this.serial(async () => {
      if (!text.trim()) throw new HttpError(400, "Reply is empty");
      const run = await this.store.require(repo, taskKey, ["waiting"]);
      await this.notWhileDispatching(run);
      const session = await this.sessions.get(run.sessionId);
      if (session.status === "running" && session.activity === "busy") {
        throw new HttpError(409, "The agent is still working; wait for it or stop it in the terminal");
      }
      await this.store.log(run, HISTORY_TEXT.reply, { quote: text.trim() });
      await this.deliver(run, text.trim());
      return run;
    });
  }

  /** Sends the current step again, resuming the session first if it has exited. */
  retry(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.store.require(repo, taskKey, ["starting", "running", "waiting", "interrupted"]);
      this.assertRecovered(run);
      const def = await this.store.defOf(run);
      // A pending launch may have failed after earlier members completed. Retry only launches
      // pending work (or review); it must never replay a completed member's prompt.
      if (dispatching(run, def) && (run.subtasks ?? []).every((sub) => sub.phase === "done" || sub.phase === "pending")) {
        if (run.subtasks!.every((sub) => sub.phase === "done")) await this.enterStep(run, def, run.stepIndex + 1);
        else await this.launchReady(run, def);
        return run;
      }
      await this.notWhileDispatching(run);
      const session = await this.sessions.get(run.sessionId);
      if (session.status === "running" && session.activity === "busy") {
        throw new HttpError(409, "The agent is still working; wait for it or stop it in the terminal");
      }
      const step = (await this.store.defOf(run)).steps[run.stepIndex];
      await this.deliver(run, run.pendingPrompt ?? (await this.prompt(run, step.prompt)), { force: true });
      return run;
    });
  }

  /**
   * Marks the task done or open again in its `task.yml`, logged when the task has a run. Not while a
   * run is active: cancel it first, or approve the last gate, which marks the task done itself.
   */
  setDone(repo: string, taskKey: string, done: boolean): Promise<{ done: { at: number | null } | null }> {
    return this.serial(async () => {
      const run = await this.store.find(repo, taskKey);
      if (run && ACTIVE_RUN_PHASES.includes(run.phase)) throw new HttpError(409, t("run.activeForDone"));
      const status = await writeTaskStatus(path.join(repo, TASKS_DIR, taskKey), done ? "done" : "open");
      if (run) await this.store.log(run, done ? HISTORY_TEXT.taskDone : HISTORY_TEXT.taskReopened);
      return { done: status.status === "done" ? { at: status.doneAt } : null };
    });
  }

  cancel(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.store.require(repo, taskKey, ACTIVE_RUN_PHASES);
      this.assertRecovered(run);
      await this.store.log(run, HISTORY_TEXT.cancel);
      return this.store.save(run, { phase: "cancelled", message: t("run.cancelled"), pendingPrompt: undefined });
    });
  }

  /** Whether the repo can give a run its own worktree, and the uncommitted files the worktree would leave out. */
  worktreeCheck(repo: string): Promise<WorktreeCheck> {
    return this.requireWorktrees().check(repo);
  }

  /** The task's worktrees (removed ones too), newest first, with what Git says about each now. */
  async workspaces(repo: string, taskKey: string): Promise<WorkspaceView[]> {
    const worktrees = this.requireWorktrees();
    const run = await this.store.find(repo, taskKey);
    return Promise.all((await worktrees.list(repo, taskKey)).map((w) => worktrees.view(w, this.writing(run, w))));
  }

  async workspaceDiff(repo: string, taskKey: string, runId: string): Promise<WorkspaceDiff> {
    const worktrees = this.requireWorktrees();
    return worktrees.diff(await worktrees.require(repo, taskKey, runId));
  }

  /**
   * Merges a run's branch into the repo, on the user's request only. Not while that run is active.
   * Integrating the task's current run, once it is done, marks the task done.
   */
  integrateWorkspace(repo: string, taskKey: string, runId: string, opts: { commit?: boolean } = {}): Promise<WorkspaceView> {
    return this.serial(async () => {
      const worktrees = this.requireWorktrees();
      const workspace = await worktrees.require(repo, taskKey, runId);
      const run = await this.store.find(repo, taskKey);
      const own = run?.runId === runId ? run : undefined;
      if (this.writing(run, workspace)) throw new HttpError(409, t("worktree.active"));
      let integrated: RunWorkspace;
      try {
        integrated = await worktrees.integrate(workspace, opts);
      } catch (error) {
        // A merge that failed (not a refusal to start) is part of the task's record.
        if (own && !(error instanceof WorktreeConflict) && (await worktrees.require(repo, taskKey, runId)).integration.status === "failed")
          await this.store.log(own, HISTORY_TEXT.integrateFailed, { quote: (error as Error).message });
        throw error;
      }
      if (own) {
        await this.store.log(own, HISTORY_TEXT.integrated, { body: HISTORY_TEXT.integratedBody(integrated.branch, integrated.integration.mergeRev ?? "") });
        if (own.phase === "done") {
          await this.store.markTask(own, "done");
          await this.store.save(own, { message: t("run.done") });
        }
      }
      return worktrees.view(integrated, false);
    });
  }

  /**
   * Removes a run's worktree directory, on the user's request only: never while the run is active or
   * while a session in it may still write (the session barrier fails closed). Uncommitted changes need `force`.
   */
  removeWorkspace(repo: string, taskKey: string, runId: string, opts: { force?: boolean } = {}): Promise<WorkspaceView> {
    return this.serial(async () => {
      const worktrees = this.requireWorktrees();
      const workspace = await worktrees.require(repo, taskKey, runId);
      const run = await this.store.find(repo, taskKey);
      if (this.writing(run, workspace)) throw new HttpError(409, t("worktree.active"));
      if (!this.sessions.quiesce) throw new HttpError(503, t("worktree.active"));
      try {
        await this.sessions.quiesce(workspace.cwd);
      } catch {
        throw new HttpError(409, t("worktree.active"));
      }
      const removed = await worktrees.remove(workspace, opts);
      if (run?.runId === runId) await this.store.log(run, HISTORY_TEXT.worktreeRemoved, { body: HISTORY_TEXT.worktreeRemovedBody(removed.path, !!removed.branchKept, removed.branch) });
      return worktrees.view(removed, false);
    });
  }

  private requireWorktrees(): WorkspacePort {
    if (!this.worktrees) throw new HttpError(503, t("worktree.notGit"));
    return this.worktrees;
  }

  /** The run that owns `workspace` is still active, so its sessions may write there. */
  private writing(run: RunState | undefined, workspace: RunWorkspace): boolean {
    return !!run && run.runId === workspace.runId && ACTIVE_RUN_PHASES.includes(run.phase);
  }

  /** Answers a subtask that waits (it ended its turn without its report): logged, then pasted as it is. */
  replySubtask(repo: string, taskKey: string, n: number, text: string): Promise<RunState> {
    return this.serial(async () => {
      if (!text.trim()) throw new HttpError(400, "Reply is empty");
      const { run, sub } = await this.requireSubtask(repo, taskKey, n, ["waiting"]);
      await this.ensureIdle(sub);
      await this.store.log(run, HISTORY_TEXT.subtaskReply(n), { quote: text.trim() });
      await this.deliver(run, text.trim(), { lane: sub });
      return run;
    });
  }

  /** Sends a subtask's prompt again, resuming its session first if it has exited. */
  retrySubtask(repo: string, taskKey: string, n: number): Promise<RunState> {
    return this.serial(async () => {
      const { run, sub } = await this.requireSubtask(repo, taskKey, n, ["starting", "running", "waiting", "interrupted"]);
      await this.ensureIdle(sub);
      await this.deliver(run, sub.pendingPrompt ?? (await this.subtaskPrompt(run, sub)), { force: true, lane: sub });
      return run;
    });
  }

  /**
   * "Đánh dấu xong" for a subtask whose agent sent no Stop: only once its report was written since the
   * prompt, and then exactly as a Stop would end it.
   */
  completeSubtask(repo: string, taskKey: string, n: number): Promise<RunState> {
    return this.serial(async () => {
      const { run, sub } = await this.requireSubtask(repo, taskKey, n, ["running", "waiting"]);
      if (!(await writtenSince(run, sub.report, sub.stepStartedAt, sub))) throw new HttpError(409, `${sub.report} was not written since the prompt was sent`);
      await this.store.log(run, HISTORY_TEXT.subtaskMarkedDone(n), { body: HISTORY_TEXT.markedDoneBody(sub.report) });
      await this.onSubtaskStop(run, sub);
      return run;
    });
  }

  /** The same for the leader's step: its `done-when` file must have been written since the prompt. */
  completeStep(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.store.require(repo, taskKey, ["running", "waiting"]);
      const def = await this.store.defOf(run);
      await this.notWhileDispatching(run);
      const file = def.steps[run.stepIndex].doneWhen?.file;
      if (!file) throw new HttpError(409, "This step has no done-when file to check");
      if (laneBlocked(run, run)) throw new HttpError(409, t("handoff.blocked"));
      if (!(await writtenSince(run, file))) throw new HttpError(409, `${file} was not written since the prompt was sent`);
      await this.store.log(run, HISTORY_TEXT.markedDone, { body: HISTORY_TEXT.markedDoneBody(file) });
      await this.onStop(run);
      return run;
    });
  }

  /** True when an active run drives this session (as the leader or as a subtask); such a session must not be removed. */
  async usesSession(sessionId: string): Promise<boolean> {
    return (await this.store.bySession(sessionId)) !== undefined;
  }

  /** A restarted server proves process exit before allowing any deliberate continuation. */
  recover(): Promise<void> {
    return this.serial(async () => {
      for (const saved of (await this.state.load()).runs) {
        let run = structuredClone(saved);
        await this.handoff.recover(run, (await this.state.load()).sessions);
        run = structuredClone((await this.store.find(run.repo, run.taskKey)) ?? run);
        if (!ACTIVE_RUN_PHASES.includes(run.phase)) continue;
        const def = await this.store.defOf(run);
        const lanes: Lane[] = [run, ...(run.subtasks ?? []).filter((sub) => sub.sessionId && !["pending", "done"].includes(sub.phase))];
        let changed = false;
        for (const lane of lanes) {
          const blocked = lane.recoveryBlocked;
          lane.recoveryBlocked = undefined;
          const transferBlocked = laneBlocked(run, lane);
          lane.recoveryBlocked = blocked;
          if (!lane.sessionId || transferBlocked) continue;
          const controlId = `recovery-${lane.sessionId}`;
          try {
            const session = await this.sessions.get(lane.sessionId);
            if (session.retired) continue;
            if (this.sessions.recoverProcess) {
              if (!session.reservation) await this.sessions.reserve?.(session.id, controlId);
              else if (session.reservation.operationId !== controlId) throw new HttpError(409, t("handoff.blocked"));
              await this.sessions.recoverProcess(session.id);
              const stopped = await this.sessions.get(session.id);
              if (stopped.reservation?.operationId === controlId) await this.sessions.release?.(session.id, controlId);
            } else {
              // Legacy in-memory ports have no process ownership. Production must provide the barrier.
              if (session.generation || session.processOwner || session.reservation) throw new HttpError(503, t("handoff.unavailable"));
              if (session.status === "running") await this.sessions.stop(session.id);
            }
            lane.recoveryBlocked = undefined;
          } catch {
            lane.recoveryBlocked = true;
          }
          if (lane.phase !== "gate" || lane.recoveryBlocked) lane.phase = "interrupted";
          lane.noHook = undefined;
          lane.promptId = randomUUID();
          changed = true;
        }
        if (changed) {
          if (dispatching(run, def)) {
            syncDispatch(run);
            run.phase = "interrupted";
          }
          if ([run, ...(run.subtasks ?? [])].some((lane) => lane.recoveryBlocked)) {
            run.phase = "interrupted";
            run.message = t("handoff.blocked");
          } else if (run.phase === "interrupted") run.message = t("run.restarted");
          await this.store.checkpoint(run);
          if (["starting", "running", "waiting"].includes(saved.phase)) await this.store.log(run, HISTORY_TEXT.interrupted, { body: HISTORY_TEXT.serverRestarted });
        }
      }
    });
  }

  onEvent(meta: SessionMeta, event: SessionEvent): Promise<void> {
    meta = structuredClone(meta);
    const fence = this.eventFence(meta.id);
    return this.serial(async () => {
      const run = await this.store.bySession(meta.id);
      if (!run || !(await this.acceptEvent(run, meta, await fence, event.type === "session.started"))) return;
      const lane = laneOf(run, meta.id)!;
      // While subtasks run, the leader's session sits idle; nothing it reports concerns the run.
      if (lane === run && dispatching(run, await this.store.defOf(run))) return;
      if (lane === run && run.phase === "running" && run.message === t("run.noHook", { agent: agentLabel(run) })) {
        await this.store.save(run, { noHook: undefined, message: t("run.step", { step: (await this.store.defOf(run)).steps[run.stepIndex].title, agent: agentLabel(run) }) });
      }
      const turnEnded = event.type === "turn.completed" || event.type === "turn.interrupted" || event.type === "turn.failed";
      const fromTranscript = turnEnded && event.source === "transcript";
      if (lane !== run && (lane as SubtaskRun).noHook && !fromTranscript) {
        delete (lane as SubtaskRun).noHook;
        syncDispatch(run);
        await this.store.save(run, {});
      }
      if (fromTranscript && (lane.phase === "running" || lane.phase === "waiting")) {
        await this.store.log(run, HISTORY_TEXT.transcriptStop, { body: HISTORY_TEXT.transcriptStopBody });
      }
      if (turnEnded && event.message !== undefined) {
        lane.lastMessage = event.message;
      }
      if (event.type === "session.started" && lane.phase === "starting" && lane.pendingPrompt) {
        await this.send(run, lane.pendingPrompt, lane);
      } else if (event.type === "prompt.submitted" && lane.phase === "waiting") {
        await this.saveLane(run, lane, { phase: "running" }, t("run.working", { agent: agentLabel(run) }));
      } else if (turnEnded && (lane.phase === "running" || lane.phase === "waiting")) {
        if (event.type !== "turn.completed") {
          await this.saveLane(run, lane, { phase: "waiting", pendingPrompt: undefined }, lane.lastMessage || t(event.type === "turn.interrupted" ? "run.turnInterrupted" : "run.turnFailed"));
          return;
        }
        if (lane === run) await this.onStop(run);
        else await this.onSubtaskStop(run, lane as SubtaskRun);
      }
    });
  }

  onExit(meta: SessionMeta): Promise<void> {
    meta = structuredClone(meta);
    const fence = this.eventFence(meta.id);
    return this.serial(async () => {
      const run = await this.store.bySession(meta.id);
      if (!run || !(await this.acceptEvent(run, meta, await fence))) return;
      const lane = laneOf(run, meta.id)!;
      if (!["starting", "running", "waiting"].includes(lane.phase)) return;
      if (lane === run) {
        if (dispatching(run, await this.store.defOf(run))) return;
        await this.store.log(run, HISTORY_TEXT.interrupted, { body: HISTORY_TEXT.sessionStopped });
        await this.store.save(run, { phase: "interrupted", message: t("run.sessionStopped") });
      } else {
        const sub = lane as SubtaskRun;
        await this.store.log(run, HISTORY_TEXT.subtaskInterrupted(sub.n), { body: HISTORY_TEXT.subtaskSessionStopped });
        await this.saveLane(run, sub, { phase: "interrupted" }, "");
      }
    });
  }

  /** Backend observations for both leader and members; generation/lane fences apply first. */
  onMetrics(meta: SessionMeta, data: SessionMetrics): Promise<void> {
    meta = structuredClone(meta);
    const fence = this.eventFence(meta.id);
    return this.serial(async () => {
      const run = await this.store.bySession(meta.id);
      if (run && !(await this.acceptEvent(run, meta, await fence))) return;
      if (!run) return;
      // Only a status line reports what the session cost; token notifications never carry a cost.
      const costUsd = data.source === "claude-statusline" ? { costUsd: data.costUsd } : {};
      this.recordMetrics(run, meta, { model: data.model, inputTokens: data.inputTokens, outputTokens: data.outputTokens, ...costUsd }, data.source ?? "legacy", data);
      await this.store.save(run, {});
    });
  }

  private async onStop(run: RunState): Promise<void> {
    const def = await this.store.defOf(run);
    const step = def.steps[run.stepIndex];
    if (step.doneWhen && !(await writtenSince(run, step.doneWhen.file))) {
      await this.store.save(run, {
        phase: "waiting",
        message: t("run.notWritten", { file: step.doneWhen.file, agent: agentLabel(run) }),
      });
    } else if (step.gate === "approve") {
      this.finishExecution(run);
      const message = step.doneWhen ? t("run.gateFile", { step: step.title, file: step.doneWhen.file }) : t("run.gate", { step: step.title });
      await this.store.save(run, { phase: "gate", message });
    } else if (run.stepIndex + 1 >= def.steps.length) {
      this.finishExecution(run);
      await this.finishRun(run);
    } else {
      await this.enterStep(run, def, run.stepIndex + 1);
    }
  }

  /** A subtask's turn ended: done when its report was written since the prompt, else it waits for an answer. */
  private async onSubtaskStop(run: RunState, sub: SubtaskRun): Promise<void> {
    const def = await this.store.defOf(run);
    const effective = this.effective(run, def, sub);
    if (!(await writtenSince(run, sub.report, sub.stepStartedAt, sub))) {
      await this.saveLane(run, sub, { phase: "waiting" }, "");
      return;
    }
    const now = Date.now();
    const attempt = run.attempts?.findLast((a) => a.sessionId === sub.sessionId);
    if (attempt) attempt.finishedAt = now;
    // Without a status line (Copilot) the model is the one the session was opened with, if any.
    const model = sub.metrics?.model ?? run.attempts?.findLast((attempt) => attempt.sessionId === sub.sessionId)?.actualModel ?? effective.model;
    sub.metrics = {
      ...sub.metrics,
      ...(model ? { model } : {}),
      ...(sub.startedAt !== undefined ? { durationMs: now - sub.startedAt } : {}),
    };
    sub.finishedAt = now;
    await this.saveLane(run, sub, { phase: "done", pendingPrompt: undefined }, "");
    await this.store.log(run, HISTORY_TEXT.subtaskDone(sub.n, PROVIDER_LABELS[effective.agent], effective.subagent, effective.model), {
      body: HISTORY_TEXT.subtaskDoneBody(
        sub.report,
        { ...sub.metrics, model: attempt?.actualModel },
        summarizeMetrics(run, { kind: "subtask", stepId: def.steps[run.stepIndex].id, n: sub.n }),
        run.attempts,
      ),
    });
    if ((await this.sessions.get(sub.sessionId!).catch(() => null))?.status === "running") await this.sessions.stop(sub.sessionId!);
    if ((run.subtasks ?? []).every((s) => s.phase === "done")) {
      await this.store.log(run, HISTORY_TEXT.backToLeader, { body: HISTORY_TEXT.backToLeaderBody(run.subtasks!.length) });
      try {
        await this.enterStep(run, def, run.stepIndex + 1);
      } catch (error) {
        await this.store.save(run, { phase: "interrupted", message: (error as Error).message });
        throw error;
      }
    } else await this.launchReady(run, def);
  }

  /**
   * Moves the run to step `index` and sends its prompt. A step for another agent or model gets a new
   * session of that agent: the previous one is stopped (it stays listed) and the switch goes into the decision
   * log, which the step's prompt has the agent read with the task's documents. A dispatch step opens
   * one session per subtask instead and leaves the leader's session as it is.
   */
  private async enterStep(run: RunState, def: WorkflowDef, index: number, items?: Assignment[]): Promise<void> {
    this.finishExecution(run);
    const step = def.steps[index];
    if (step.dispatch) {
      const table = items ? { items, errors: [] } : await assignmentsFor(run, def, index, this.subagents, this.sessions.preflight?.bind(this.sessions));
      if (table.errors.length) throw new HttpError(400, t("run.assignmentsInvalid", { errors: table.errors.join("; ") }));
      run.stepIndex = index;
      return this.startDispatch(run, def, step.dispatch.report, table.items);
    }
    const effective = resolveExecution({ workflow: def, scope: { kind: "step", stepId: step.id }, run });
    requirePreflight(await this.preflight(run.repo, effective, run.workspace?.cwd));
    const { agent, model } = effective;
    run.stepIndex = index;
    const current = await this.sessions.get(run.sessionId).catch(() => null);
    if (!current || !this.sessionMatches(run, current, effective)) {
      if (current?.status === "running") await this.sessions.stop(run.sessionId);
      const session = await this.sessions.create(run.repo, run.taskKey, { ...this.launchConfig(effective), ...this.placement(run) });
      this.recordExecution(run, session, { kind: "step", stepId: step.id }, effective);
      await this.store.log(run, current?.agent === agent ? HISTORY_TEXT.switchModel : HISTORY_TEXT.switchAgent, {
        body: HISTORY_TEXT.switchAgentBody(current ? sessionLabel(current.agent, current.model) : "?", sessionLabel(agent, model)),
      });
      await this.store.save(run, { sessionId: session.id });
    } else this.recordExecution(run, current, { kind: "step", stepId: step.id }, effective);
    await this.deliver(run, await this.prompt(run, step.prompt));
  }

  private async startDispatch(run: RunState, def: WorkflowDef, report: string, items: Assignment[]): Promise<void> {
    const dispatch = def.steps[run.stepIndex].dispatch!;
    const subtasks: SubtaskRun[] = items.map((a) => ({ ...a, phase: "pending", report: reportOf(report, a.n) }));
    await this.store.save(run, { subtasks, pendingPrompt: undefined, phase: "running", message: t("run.dispatching", { done: 0, total: subtasks.length }) });
    await this.store.log(run, HISTORY_TEXT.dispatch, {
      body: HISTORY_TEXT.dispatchBody(
        items.map((a) => ({ ...a, agent: PROVIDER_LABELS[a.agent] })),
        dispatch.parallel,
      ),
    });
    await this.launchReady(run, def);
  }

  /**
   * Opens a session for every pending subtask that can start: its dependencies are done, a slot is free
   * and its files do not overlap those of a subtask in progress. Subtasks wait their turn in table order.
   */
  private async launchReady(run: RunState, def: WorkflowDef): Promise<void> {
    try {
      await this.launchPending(run, def);
    } catch (error) {
      await this.store.save(run, { phase: "interrupted", message: (error as Error).message });
      throw error;
    }
  }

  private async launchPending(run: RunState, def: WorkflowDef): Promise<void> {
    const dispatch = def.steps[run.stepIndex].dispatch!;
    const subs = run.subtasks ?? [];
    for (;;) {
      const busy = subs.filter((s) => s.phase !== "pending" && s.phase !== "done");
      const next = subs.find(
        (s) =>
          s.phase === "pending" && s.deps.every((d) => subs.find((o) => o.n === d)?.phase === "done") && busy.length < dispatch.parallel && !busy.some((b) => overlaps(b.files, s.files)),
      );
      if (!next) break;
      const problems = await assignmentProblems(run, def, run.stepIndex, [next], this.subagents);
      if (problems.length) throw new HttpError(400, t("run.assignmentsInvalid", { errors: problems.join("; ") }));
      const effective = this.effective(run, def, next);
      requirePreflight(await this.preflight(run.repo, effective, run.workspace?.cwd));
      const session = await this.sessions.create(run.repo, run.taskKey, {
        ...this.launchConfig(effective),
        ...this.placement(run),
        title: t("run.subtaskTitle", { n: next.n }),
      });
      next.sessionId = session.id;
      this.recordExecution(run, session, { kind: "subtask", stepId: def.steps[run.stepIndex].id, n: next.n }, effective);
      next.phase = "starting";
      await this.store.save(run, {});
      await this.deliver(run, await this.subtaskPrompt(run, next), { lane: next });
    }
    syncDispatch(run);
    await this.store.save(run, {});
  }

  /**
   * Sends `text` now if the session can take input; otherwise keeps it pending and (re)starts
   * the session; SessionStart then delivers it. `force` pastes even before SessionStart was seen
   * (manual retry when hooks did not arrive).
   */
  private async deliver(run: RunState, text: string, opts: { force?: boolean; lane?: Lane } = {}): Promise<void> {
    const lane = opts.lane ?? run;
    if (laneBlocked(run, lane)) throw new HttpError(409, t("handoff.blocked"));
    const def = await this.store.defOf(run);
    const sub = lane === run ? undefined : (lane as SubtaskRun);
    if (sub) {
      const errors = await assignmentProblems(run, def, run.stepIndex, [sub], this.subagents);
      if (errors.length) throw new HttpError(400, t("run.assignmentsInvalid", { errors: errors.join("; ") }));
    }
    const effective = this.effective(run, def, sub);
    const session = await this.sessions.get(lane.sessionId!);
    // Resuming a native session cannot change its CLI/model/restrictions.
    if (!this.sessionMatches(run, session, effective)) throw new HttpError(409, "Session configuration does not match the lane execution policy");
    if (opts.force || session.status !== "running") requirePreflight(await this.preflight(run.repo, effective, run.workspace?.cwd));
    if (session.status === "running" && run.attempts?.findLast((attempt) => attempt.sessionId === session.id)?.generation !== (session.generation ?? 0)) {
      this.recordExecution(run, session, sub ? { kind: "subtask", stepId: def.steps[run.stepIndex].id, n: sub.n } : { kind: "step", stepId: def.steps[run.stepIndex].id }, effective);
    }
    if (session.status !== "running") {
      // The model the session reported while it ran belongs to the attempt that ends here.
      const attempt = run.attempts?.findLast((a) => a.sessionId === session.id);
      if (attempt && !attempt.actualModel && session.actualModel) attempt.actualModel = session.actualModel;
      await this.saveLane(run, lane, { phase: "starting", pendingPrompt: text }, t("run.resuming"));
      const resumed = await this.sessions.resume(lane.sessionId!);
      this.recordExecution(run, resumed, sub ? { kind: "subtask", stepId: def.steps[run.stepIndex].id, n: sub.n } : { kind: "step", stepId: def.steps[run.stepIndex].id }, effective);
      await this.store.save(run, {});
    } else if (session.activity === "starting" && !opts.force) {
      await this.saveLane(run, lane, { phase: "starting", pendingPrompt: text }, t("run.starting", { agent: agentLabel(run) }));
    } else {
      await this.send(run, text, lane);
    }
  }

  private async send(run: RunState, text: string, lane: Lane = run): Promise<void> {
    const def = await this.store.defOf(run);
    const step = def.steps[run.stepIndex];
    const file = lane === run ? step.doneWhen?.file : (lane as SubtaskRun).report;
    const baseline = file ? await outputBaseline(run, file) : undefined;
    const now = Date.now();
    await this.saveLane(run, lane, { promptId: randomUUID(), outputBaseline: baseline, stepStartedAt: now }, "");
    try {
      this.sessions.paste(lane.sessionId!, text);
    } catch (error) {
      lane.lastMessage = (error as Error).message;
      await this.saveLane(run, lane, { phase: "waiting", pendingPrompt: undefined }, (error as Error).message);
      return;
    }
    await this.saveLane(
      run,
      lane,
      {
        phase: "running",
        stepStartedAt: now,
        ...(lane !== run && lane.startedAt === undefined ? { startedAt: now } : {}),
        sentPrompt: { stepIndex: run.stepIndex, text, at: now, sessionId: lane.sessionId },
        pendingPrompt: undefined,
        noHook: undefined,
      },
      t("run.step", { step: step.title, agent: agentLabel(run) }),
    );
    this.watchForHooks(run, lane, now, def);
  }

  /**
   * Without Copilot's hooks nothing tells the engine the turn ended (the session manager's transcript
   * watch is the first fallback), so a prompt that gets no hook at all is reported, on the run for
   * a step and on the subtask for a subtask, instead of waiting silently.
   */
  private watchForHooks(run: RunState, lane: Lane, sentAt: number, def: WorkflowDef): void {
    const sub = lane === run ? undefined : (lane as SubtaskRun);
    const agent = this.effective(run, def, sub).agent;
    if (!providerTraits(agent).warnsWhenNoHook) return;
    const sessionId = lane.sessionId!;
    const promptId = lane.promptId;
    const generation = run.attempts?.findLast((attempt) => attempt.sessionId === sessionId)?.generation;
    const timer = setTimeout(() => {
      void this.serial(async () => {
        const current = await this.store.find(run.repo, run.taskKey);
        const target = current && (sub ? current.subtasks?.find((s) => s.n === sub.n) : current);
        if (
          !current ||
          !target ||
          target.sessionId !== sessionId ||
          target.promptId !== promptId ||
          laneBlocked(current, target) ||
          current.attempts?.findLast((a) => a.sessionId === sessionId)?.generation !== generation ||
          !ACTIVE_RUN_PHASES.includes(current.phase) ||
          target.sentPrompt?.at !== sentAt ||
          target.phase !== "running" ||
          this.sessions.hookSeen(sessionId)
        )
          return;
        if (target === current) await this.store.save(current, { noHook: true, message: t("run.noHook", { agent: PROVIDER_LABELS[agent] }) });
        else {
          (target as SubtaskRun).noHook = true;
          syncDispatch(current);
          await this.store.save(current, {});
        }
      }).catch((e: unknown) => this.emit("warning", e));
    }, this.noHookWarnMs);
    timer.unref();
  }

  /** Saves a lane's change: the run's own fields with `message`, or a subtask's with the run's phase following. */
  private async saveLane(run: RunState, lane: Lane, patch: Partial<Lane>, message: string): Promise<void> {
    if (lane === run) await this.store.save(run, { ...patch, message } as Partial<RunState>);
    else {
      Object.assign(lane, patch);
      syncDispatch(run);
      await this.store.save(run, {});
    }
  }

  private async prompt(run: RunState, template: string, extra: { feedback?: string } = {}): Promise<string> {
    const task = await getTask(run.repo, run.taskKey);
    // Read only for a prompt that lists them: the agent folders are read on every call.
    const subagents = (template.includes("{{subagents}}") || template.includes("{{leaderTools}}")) && this.subagents ? await this.subagents(run.repo) : undefined;
    const def = await this.store.defOf(run);
    const inventory = await this.promptInventory(run.repo, def, run.stepIndex, template, run);
    return renderPrompt(
      template,
      promptVars(def, run.stepIndex, task, { run, previous: run.previous, continued: continued(run), subtasks: run.subtasks, subagents, inventory, ...this.promptPlace(run), ...extra }),
    );
  }

  /** What a step's {{subagents}} lists of its provider's own agents and models; read only when the prompt uses the variable and the provider has such a list. */
  private async promptInventory(repo: string, def: WorkflowDef, stepIndex: number, template: string, run?: Parameters<typeof resolveExecution>[0]["run"]) {
    if (!template.includes("{{subagents}}")) return undefined;
    const { agent } = resolveExecution({ workflow: def, run, scope: { kind: "step", stepId: def.steps[stepIndex].id } });
    return this.sessions.promptInventory?.(repo, agent);
  }

  private async subtaskPrompt(run: RunState, sub: SubtaskRun): Promise<string> {
    const def = await this.store.defOf(run);
    const task = await getTask(run.repo, run.taskKey);
    return renderPrompt(
      def.steps[run.stepIndex].dispatch!.prompt,
      promptVars(def, run.stepIndex, task, { run, previous: run.previous, continued: continued(sub), subtask: sub, subtasks: run.subtasks, ...this.promptPlace(run) }),
    );
  }

  private effective(run: RunState, def: WorkflowDef, sub?: SubtaskRun): EffectiveExecution {
    const stepId = def.steps[run.stepIndex].id;
    return resolveExecution({ workflow: def, run, scope: sub ? { kind: "subtask", stepId, n: sub.n } : { kind: "step", stepId }, assignment: sub });
  }

  private launchConfig(effective: EffectiveExecution) {
    const { agent, model, subagent, permissionMode, codex } = effective;
    return { agent, model, subagent, permissionMode, ...(codex ? { codex } : {}) };
  }

  private recordExecution(run: RunState, session: Awaited<ReturnType<SessionPort["get"]>>, scope: LaneScope, execution: EffectiveExecution): void {
    const previous = run.attempts?.findLast((a) => a.sessionId === session.id);
    if (previous && previous.finishedAt === undefined) previous.finishedAt = Date.now();
    (run.attempts ??= []).push({
      id: randomUUID(),
      scope,
      sessionId: session.id,
      generation: session.generation ?? 0,
      execution: { ...execution },
      ...(session.nativeId ? { nativeId: session.nativeId } : {}),
      ...(session.actualModel ? { actualModel: session.actualModel } : {}),
      startedAt: Date.now(),
    });
  }

  private finishExecution(run: RunState): void {
    const attempt = run.attempts?.findLast((a) => a.sessionId === run.sessionId);
    if (attempt && attempt.finishedAt === undefined) attempt.finishedAt = Date.now();
  }

  private recordMetrics(run: RunState, meta: SessionMeta, incoming: SubtaskMetrics, source: MetricsSource, observation?: SessionMetrics): void {
    const read = measuredMetrics(incoming);
    if (!Object.keys(read).length && !observation?.availability) return;
    const all = (run.sessionMetrics ??= []);
    let snapshot = all.find((m) => m.sessionId === meta.id && m.source === source);
    if (!snapshot) {
      snapshot = {
        sessionId: meta.id,
        agent: meta.agent ?? DEFAULT_PROVIDER,
        source,
        basis: source === "codex-thread" ? "thread" : source === "claude-statusline" ? "session" : "unknown",
        metrics: {},
      };
      all.push(snapshot);
    }
    if (source === "codex-thread" && observation) {
      if (!snapshot.nativeId && meta.nativeId) snapshot.nativeId = meta.nativeId;
      if (!updateCodexMeasurement(snapshot, read, observation)) return;
    } else {
      snapshot.metrics = mergeCumulative(snapshot.metrics, read);
      snapshot.observedAt = Date.now();
    }
    snapshot.generation = meta.generation ?? 0;
    if (meta.nativeId) snapshot.nativeId = meta.nativeId;
    const attempt = run.attempts?.findLast((a) => a.sessionId === meta.id);
    if (attempt) {
      attempt.metrics =
        source === "codex-thread"
          ? { ...(attempt.metrics?.durationMs !== undefined ? { durationMs: attempt.metrics.durationMs } : {}), ...snapshot.metrics }
          : mergeCumulative(attempt.metrics, read);
      attempt.metricsSource = source;
      attempt.metricsObservedAt = snapshot.observedAt;
      if (source !== "legacy" && read.model) attempt.actualModel = read.model;
      if (meta.nativeId) attempt.nativeId = meta.nativeId;
    }
    const sub = run.subtasks?.find((s) => s.sessionId === meta.id);
    if (sub)
      sub.metrics =
        source === "codex-thread" ? { ...(sub.metrics?.durationMs !== undefined ? { durationMs: sub.metrics.durationMs } : {}), ...snapshot.metrics } : mergeCumulative(sub.metrics, read);
  }

  private sessionMatches(run: RunState, session: Awaited<ReturnType<SessionPort["get"]>>, effective: EffectiveExecution): boolean {
    // The attempt keeps the model the lane asked for; the session's `model` is only what it was launched with.
    const requested = run.attempts?.findLast((a) => a.sessionId === session.id)?.execution;
    const model = requested ? requested.model : launchModel(session.model);
    return (
      session.agent === effective.agent &&
      model === effective.model &&
      session.subagent === effective.subagent &&
      session.permissionMode === effective.permissionMode &&
      JSON.stringify(session.codex ?? null) === JSON.stringify(effective.codex ?? null)
    );
  }

  private async preflight(repo: string, effective: EffectiveExecution, cwd?: string): Promise<PreflightResult> {
    if (!this.sessions.preflight) throw new HttpError(503, t("preflight.probe_failed", { agent: effective.agent }));
    return this.sessions.preflight(repo, this.launchConfig(effective), cwd ? { cwd } : undefined);
  }

  /** Where a session of `run` runs and what it may use besides: its worktree and the task's documents in the repo. */
  private placement(run: Pick<RunState, "repo" | "taskKey" | "runId" | "workspace">) {
    return {
      ...(run.runId ? { runId: run.runId } : {}),
      ...(run.workspace ? { cwd: run.workspace.cwd, extraDirs: [taskAbsoluteDir(run)] } : {}),
    };
  }

  /** {{taskDir}} and the worktree rule for a run in a worktree; nothing for a run in the repo. */
  private promptPlace(run: RunState) {
    return run.workspace ? { workspace: { taskDir: taskAbsoluteDir(run), workdir: run.workspace.cwd, branch: run.workspace.branch } } : {};
  }

  /**
   * The last step is approved or finished. A run in the repo marks the task done; a run in a worktree
   * has only finished executing: its code is on the run's branch until the user integrates it.
   */
  private async finishRun(run: RunState): Promise<RunState> {
    if (run.workspace) {
      await this.store.log(run, HISTORY_TEXT.done, { body: HISTORY_TEXT.awaitingIntegration(run.workspace.branch) });
      return this.store.save(run, { phase: "done", message: t("run.doneAwaitingIntegration") });
    }
    await this.store.markTask(run, "done");
    return this.store.save(run, { phase: "done", message: t("run.done") });
  }

  /** The run-level reply and retry talk to the leader's session, which has nothing to answer while subtasks work. */
  private async notWhileDispatching(run: RunState): Promise<void> {
    this.assertRecovered(run);
    if (dispatching(run, await this.store.defOf(run))) throw new HttpError(409, "Subtasks are running; answer or retry them one by one");
  }

  private async requireSubtask(repo: string, taskKey: string, n: number, phases: ReadonlyArray<SubtaskPhase>): Promise<{ run: RunState; sub: SubtaskRun }> {
    const run = await this.store.require(repo, taskKey, ["starting", "running", "waiting", "interrupted"]);
    if (!dispatching(run, await this.store.defOf(run))) throw new HttpError(409, "The run is not handing out subtasks");
    const sub = run.subtasks?.find((s) => s.n === n);
    if (!sub) throw new HttpError(404, `No subtask ${n}`);
    if (laneBlocked(run, sub)) throw new HttpError(409, t("handoff.blocked"));
    if (!phases.includes(sub.phase)) throw new HttpError(409, `Not allowed while subtask ${n} is ${sub.phase}`);
    return { run, sub };
  }

  private async ensureIdle(sub: SubtaskRun): Promise<void> {
    const session = await this.sessions.get(sub.sessionId!);
    if (session.status === "running" && session.activity === "busy") {
      throw new HttpError(409, "The agent is still working; wait for it or stop it in the terminal");
    }
  }

  private assertRecovered(run: RunState): void {
    const unresolved = run.handoffs?.some((operation) => operation.cleanup === "blocked" || !["committed", "failed"].includes(operation.stage));
    if (unresolved || [run, ...(run.subtasks ?? [])].some((lane) => laneBlocked(run, lane))) throw new HttpError(409, t("handoff.blocked"));
  }

  /** Capture at ingress: a callback queued behind retry must not borrow the new prompt's identity. */
  private eventFence(sessionId: string): Promise<string | undefined> {
    return this.state.load().then((state) => {
      const run = state.runs.find((entry) => laneOf(entry, sessionId));
      const lane = run && laneOf(run, sessionId);
      return lane ? JSON.stringify([run!.startedAt, run!.stepIndex, lane.promptId]) : undefined;
    });
  }

  private async acceptEvent(run: RunState, meta: SessionMeta, fence: string | undefined, sessionStart = false): Promise<boolean> {
    const lane = laneOf(run, meta.id);
    if (!lane || !["starting", "running", "waiting"].includes(lane.phase) || laneBlocked(run, lane)) return false;
    // A newly created transport can report ready before the engine durably binds its id.
    const initialStart = sessionStart && fence === undefined && lane.phase === "starting" && !!lane.pendingPrompt;
    if (!initialStart && fence !== (await this.eventFence(meta.id))) return false;
    const session = await this.sessions.get(meta.id).catch(() => undefined);
    if (!session || session.retired || session.reservation) return false;
    const generation = meta.generation ?? 0;
    if (generation !== (session.generation ?? 0)) return false;
    const attempt = run.attempts?.findLast((entry) => entry.sessionId === meta.id);
    return !attempt || attempt.generation === generation;
  }

  /** Engine operations and hook handling run one at a time, so a Stop hook cannot race a click. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.run(fn);
  }
}

/** True when the lane's session already got an earlier prompt of this lane; runs saved before `sessionId` was recorded count as fresh. */
function continued(lane: { sessionId?: string; sentPrompt?: { sessionId?: string } }): boolean {
  return lane.sessionId !== undefined && lane.sentPrompt?.sessionId === lane.sessionId;
}
