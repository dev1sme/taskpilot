import { EventEmitter } from "node:events";
import path from "node:path";
import { AGENT_LABELS, DEFAULT_AGENT } from "../../core/agents.js";
import { HttpError } from "../../core/errors.js";
import { getTask, TASKS_DIR, writeTaskStatus } from "../tasks/index.js";
import type { HookEvent, SessionMetrics } from "../sessions/index.js";
import type { SessionMeta, StateStore } from "../../core/state.js";
import { overlaps } from "./assignments.js";
import { loadWorkflow, modeOf, OVERRIDE_DIR, reportOf } from "./definition.js";
import { CUSTOM_MODE } from "./modes.js";
import { launchModel } from "./models.js";
import { archiveOutputs } from "./archive.js";
import { HISTORY_TEXT } from "./history.js";
import { ACTIVE, agentLabel, dispatching, laneOf, sessionLabel, statusLineMetrics, syncDispatch, taskDirOf, writtenSince, type Lane } from "./lane.js";
import type { LoadDef, SessionPort, SubagentsOf } from "./ports.js";
import { assignmentsFor } from "./run-checks.js";
import { RunStore } from "./run-store.js";
import { buildRunView, type RunView } from "./run-view.js";
import type { Assignment, RunState, SubtaskPhase, SubtaskRun, WorkflowDef } from "./types.js";
import { promptVars, renderPrompt } from "./vars.js";
import { t } from "../../core/i18n.js";

export type { LoadDef, SubagentsOf, SessionPort } from "./ports.js";
export type { RunView } from "./run-view.js";

/** How long a Copilot session may stay without any hook after its prompt before the run says so. */
const NO_HOOK_WARN_MS = 60_000;

/**
 * Drives one workflow run per task: sends each step's prompt into the run's Claude session,
 * advances on the Stop hook when the step's done-when file was written, and stops at gates.
 */
export class WorkflowEngine extends EventEmitter<{ change: [run: RunState]; warning: [error: unknown] }> {
  private queue: Promise<unknown> = Promise.resolve();

  private readonly store: RunStore;

  constructor(
    private readonly state: StateStore,
    private readonly sessions: SessionPort,
    private readonly loadDef: LoadDef = (repo, mode) => loadWorkflow(repo, mode),
    /** Without it the table's subagents are not checked and {{subagents}} lists none. */
    private readonly subagents?: SubagentsOf,
    private readonly noHookWarnMs: number = NO_HOOK_WARN_MS,
  ) {
    super();
    this.store = new RunStore(
      state,
      loadDef,
      (run) => this.emit("change", run),
      (e) => this.emit("warning", e),
    );
  }

  /** The active run's workflow snapshot, else the workflow a new run would get. */
  async view(repo: string, taskKey: string): Promise<RunView> {
    return buildRunView(repo, await this.store.find(repo, taskKey), this.loadDef, (run, def, index) => assignmentsFor(run, def, index, this.subagents));
  }

  /** Starts a run in `mode` (a workflows/ directory, or "custom"); the repo's own mode when absent. */
  start(repo: string, taskKey: string, mode?: string): Promise<RunState> {
    return this.serial(async () => {
      const existing = await this.store.find(repo, taskKey);
      if (existing && ACTIVE.includes(existing.phase)) throw new HttpError(409, "A workflow run is already active");
      return this.begin(repo, taskKey, await this.loadDef(repo, mode));
    });
  }

  /**
   * Starts over from the first step in a new session, whatever the current phase. The old session
   * is stopped (it stays listed) and the task's documents are copied to archive/ first: Claude then
   * rewrites them in place, so the step names and done-when files do not change.
   */
  restart(repo: string, taskKey: string, mode?: string): Promise<RunState> {
    return this.serial(async () => {
      const existing = await this.store.find(repo, taskKey);
      if (!existing) throw new HttpError(409, "No workflow run to restart; start one first");
      // Loaded before anything is stopped or archived: a bad mode or a broken workflow changes nothing.
      const next = await this.loadDef(repo, mode);
      const old = await this.sessions.get(existing.sessionId).catch(() => null);
      if (old?.status === "running") await this.sessions.stop(existing.sessionId);
      for (const sub of existing.subtasks ?? []) {
        if (sub.sessionId && (await this.sessions.get(sub.sessionId).catch(() => null))?.status === "running") await this.sessions.stop(sub.sessionId);
      }
      const before = await this.store.defOf(existing);
      const previous = await archiveOutputs(taskDirOf(existing), before.history.file, new Date());
      await this.store.log(existing, HISTORY_TEXT.restart, {
        body: previous.files.length ? HISTORY_TEXT.archived(previous.dir, previous.files) : HISTORY_TEXT.nothingArchived,
      });
      return this.begin(repo, taskKey, next, previous);
    });
  }

  /**
   * A new run on a new session at step 1, pinned to the workflow as it is now; callers hold the
   * queue. `previous` is what a restart archived, for {{previousRun}}.
   */
  private async begin(repo: string, taskKey: string, def: WorkflowDef, previous?: RunState["previous"]): Promise<RunState> {
    const session = await this.sessions.create(repo, taskKey, { permissionMode: def.permissionMode, agent: def.steps[0].agent ?? DEFAULT_AGENT, model: def.steps[0].model });
    const now = Date.now();
    const run: RunState = {
      repo,
      taskKey,
      sessionId: session.id,
      stepIndex: 0,
      phase: "starting",
      stepStartedAt: now,
      message: "",
      workflow: def,
      ...(previous ? { previous } : {}),
      startedAt: now,
      updatedAt: now,
    };
    const mode = modeOf(def);
    // A "custom" workflow is the override itself; for the others the override is added to the built-in one.
    const override = mode.override && mode.id !== CUSTOM_MODE ? `${OVERRIDE_DIR.split(path.sep).join("/")}/` : null;
    const name = mode.id === CUSTOM_MODE ? `${OVERRIDE_DIR.split(path.sep).join("/")}/` : mode.name;
    await this.store.markTask(run, "open");
    await this.store.log(run, HISTORY_TEXT.start, { body: HISTORY_TEXT.startBody(name, override, def.steps.length) });
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
      const def = await this.store.defOf(run);
      const last = run.stepIndex + 1 >= def.steps.length;
      const table = !last && def.steps[run.stepIndex + 1].dispatch ? await assignmentsFor(run, def, run.stepIndex + 1, this.subagents) : null;
      if (table && table.errors.length > 0) throw new HttpError(400, t("run.assignmentsInvalid", { errors: table.errors.join("; ") }));
      await this.store.log(run, HISTORY_TEXT.approve, { ...(note.trim() ? { quote: note.trim() } : {}), ...(last ? { body: HISTORY_TEXT.done } : {}) });
      if (last) {
        await this.store.markTask(run, "done");
        return this.store.save(run, { phase: "done", message: t("run.done") });
      }
      await this.enterStep(run, def, run.stepIndex + 1, table?.items);
      return run;
    });
  }

  feedback(repo: string, taskKey: string, text: string): Promise<RunState> {
    return this.serial(async () => {
      if (!text.trim()) throw new HttpError(400, "Feedback is empty");
      const run = await this.store.require(repo, taskKey, ["gate"]);
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
      if (run && ACTIVE.includes(run.phase)) throw new HttpError(409, t("run.activeForDone"));
      const status = await writeTaskStatus(path.join(repo, TASKS_DIR, taskKey), done ? "done" : "open");
      if (run) await this.store.log(run, done ? HISTORY_TEXT.taskDone : HISTORY_TEXT.taskReopened);
      return { done: status.status === "done" ? { at: status.doneAt } : null };
    });
  }

  cancel(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.store.require(repo, taskKey, ACTIVE);
      await this.store.log(run, HISTORY_TEXT.cancel);
      return this.store.save(run, { phase: "cancelled", message: t("run.cancelled"), pendingPrompt: undefined });
    });
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
      if (!(await writtenSince(run, sub.report, sub.stepStartedAt))) throw new HttpError(409, `${sub.report} was not written since the prompt was sent`);
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

  /** After a server restart no session is running; active runs cannot continue on their own. */
  recover(): Promise<void> {
    return this.serial(async () => {
      for (const run of (await this.state.load()).runs) {
        if (["starting", "running", "waiting"].includes(run.phase)) {
          await this.store.log(run, HISTORY_TEXT.interrupted, { body: HISTORY_TEXT.serverRestarted });
          for (const sub of run.subtasks ?? []) {
            if (["starting", "running", "waiting"].includes(sub.phase)) sub.phase = "interrupted";
          }
          await this.store.save(run, { phase: "interrupted", message: t("run.restarted") });
        }
      }
    });
  }

  onHook(meta: SessionMeta, event: HookEvent, payload: Record<string, unknown> = {}): Promise<void> {
    return this.serial(async () => {
      const run = await this.store.bySession(meta.id);
      if (!run) return;
      const lane = laneOf(run, meta.id)!;
      // While subtasks run, the leader's session sits idle; nothing it reports concerns the run.
      if (lane === run && dispatching(run, await this.store.defOf(run))) return;
      if (lane === run && run.phase === "running" && run.message === t("run.noHook", { agent: agentLabel(run) })) {
        await this.store.save(run, { noHook: undefined, message: t("run.step", { step: (await this.store.defOf(run)).steps[run.stepIndex].title, agent: agentLabel(run) }) });
      }
      const fromTranscript = event === "Stop" && payload.source === "transcript";
      if (lane !== run && (lane as SubtaskRun).noHook && !fromTranscript) {
        delete (lane as SubtaskRun).noHook;
        syncDispatch(run);
        await this.store.save(run, {});
      }
      if (fromTranscript && (lane.phase === "running" || lane.phase === "waiting")) {
        await this.store.log(run, HISTORY_TEXT.transcriptStop, { body: HISTORY_TEXT.transcriptStopBody });
      }
      if (event === "Stop" && typeof payload.last_assistant_message === "string") {
        lane.lastMessage = payload.last_assistant_message;
      }
      if (event === "SessionStart" && lane.phase === "starting" && lane.pendingPrompt) {
        await this.send(run, lane.pendingPrompt, lane);
      } else if (event === "UserPromptSubmit" && lane.phase === "waiting") {
        await this.saveLane(run, lane, { phase: "running" }, t("run.working", { agent: agentLabel(run) }));
      } else if (event === "Stop" && (lane.phase === "running" || lane.phase === "waiting")) {
        if (payload.failed === true || payload.interrupted === true) {
          await this.saveLane(run, lane, { phase: "waiting", pendingPrompt: undefined }, lane.lastMessage || t(payload.interrupted === true ? "run.turnInterrupted" : "run.turnFailed"));
          return;
        }
        if (lane === run) await this.onStop(run);
        else await this.onSubtaskStop(run, lane as SubtaskRun);
      }
    });
  }

  onExit(meta: SessionMeta): Promise<void> {
    return this.serial(async () => {
      const run = await this.store.bySession(meta.id);
      if (!run) return;
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

  /**
   * Claude's status line of a subtask's session: the model it really runs and the session's cost so
   * far, kept for the review. The leader's own session and finished subtasks are left alone, so the
   * numbers stay those the decision log got.
   */
  onStatusLine(meta: SessionMeta, payload: Record<string, unknown>): Promise<void> {
    return this.serial(async () => {
      if ((meta.agent ?? DEFAULT_AGENT) !== "claude") return;
      const run = await this.store.bySession(meta.id);
      const sub = run && laneOf(run, meta.id);
      if (!run || !sub || sub === run || sub.phase === "done" || sub.phase === "pending") return;
      const read = statusLineMetrics(payload);
      const metrics = { ...(sub as SubtaskRun).metrics, ...read };
      if (JSON.stringify(metrics) === JSON.stringify((sub as SubtaskRun).metrics ?? {})) return;
      (sub as SubtaskRun).metrics = metrics;
      await this.store.save(run, {});
    });
  }

  onMetrics(meta: SessionMeta, data: SessionMetrics): Promise<void> {
    return this.serial(async () => {
      const run = await this.store.bySession(meta.id);
      const sub = run?.subtasks?.find((s) => s.sessionId === meta.id);
      if (!run || !sub || sub.phase === "done") return;
      sub.metrics = { ...sub.metrics, ...data };
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
      const message = step.doneWhen ? t("run.gateFile", { step: step.title, file: step.doneWhen.file }) : t("run.gate", { step: step.title });
      await this.store.save(run, { phase: "gate", message });
    } else if (run.stepIndex + 1 >= def.steps.length) {
      await this.store.markTask(run, "done");
      await this.store.save(run, { phase: "done", message: t("run.done") });
    } else {
      await this.enterStep(run, def, run.stepIndex + 1);
    }
  }

  /** A subtask's turn ended: done when its report was written since the prompt, else it waits for an answer. */
  private async onSubtaskStop(run: RunState, sub: SubtaskRun): Promise<void> {
    const def = await this.store.defOf(run);
    if (!(await writtenSince(run, sub.report, sub.stepStartedAt))) {
      await this.saveLane(run, sub, { phase: "waiting" }, "");
      return;
    }
    const now = Date.now();
    // Without a status line (Copilot) the model is the one the session was opened with, if any.
    const model = sub.metrics?.model ?? launchModel(sub.model);
    sub.metrics = {
      ...sub.metrics,
      ...(model ? { model } : {}),
      ...(sub.startedAt !== undefined ? { durationMs: now - sub.startedAt } : {}),
    };
    sub.finishedAt = now;
    await this.saveLane(run, sub, { phase: "done", pendingPrompt: undefined }, "");
    await this.store.log(run, HISTORY_TEXT.subtaskDone(sub.n, AGENT_LABELS[sub.agent], sub.subagent, sub.model), { body: HISTORY_TEXT.subtaskDoneBody(sub.report, sub.metrics) });
    if ((await this.sessions.get(sub.sessionId!).catch(() => null))?.status === "running") await this.sessions.stop(sub.sessionId!);
    if ((run.subtasks ?? []).every((s) => s.phase === "done")) {
      await this.store.log(run, HISTORY_TEXT.backToLeader, { body: HISTORY_TEXT.backToLeaderBody(run.subtasks!.length) });
      await this.enterStep(run, def, run.stepIndex + 1);
    } else await this.launchReady(run, def);
  }

  /**
   * Moves the run to step `index` and sends its prompt. A step for another agent or model gets a new
   * session of that agent: the previous one is stopped (it stays listed) and the switch goes into the decision
   * log, which the step's prompt has the agent read with the task's documents. A dispatch step opens
   * one session per subtask instead and leaves the leader's session as it is.
   */
  private async enterStep(run: RunState, def: WorkflowDef, index: number, items?: Assignment[]): Promise<void> {
    run.stepIndex = index;
    const step = def.steps[index];
    if (step.dispatch) return this.startDispatch(run, def, step.dispatch.report, items ?? []);
    const agent = step.agent ?? DEFAULT_AGENT;
    const current = await this.sessions.get(run.sessionId).catch(() => null);
    if (current && (current.agent !== agent || current.model !== step.model)) {
      if (current.status === "running") await this.sessions.stop(run.sessionId);
      const session = await this.sessions.create(run.repo, run.taskKey, { permissionMode: def.permissionMode, agent, model: step.model });
      await this.store.log(run, current.agent === agent ? HISTORY_TEXT.switchModel : HISTORY_TEXT.switchAgent, {
        body: HISTORY_TEXT.switchAgentBody(sessionLabel(current.agent, current.model), sessionLabel(agent, step.model)),
      });
      await this.store.save(run, { sessionId: session.id });
    }
    await this.deliver(run, await this.prompt(run, step.prompt));
  }

  private async startDispatch(run: RunState, def: WorkflowDef, report: string, items: Assignment[]): Promise<void> {
    const dispatch = def.steps[run.stepIndex].dispatch!;
    const subtasks: SubtaskRun[] = items.map((a) => ({ ...a, phase: "pending", report: reportOf(report, a.n) }));
    await this.store.save(run, { subtasks, pendingPrompt: undefined, phase: "running", message: t("run.dispatching", { done: 0, total: subtasks.length }) });
    await this.store.log(run, HISTORY_TEXT.dispatch, {
      body: HISTORY_TEXT.dispatchBody(
        items.map((a) => ({ ...a, agent: AGENT_LABELS[a.agent] })),
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
    const dispatch = def.steps[run.stepIndex].dispatch!;
    const subs = run.subtasks ?? [];
    for (;;) {
      const busy = subs.filter((s) => s.phase !== "pending" && s.phase !== "done");
      const next = subs.find(
        (s) =>
          s.phase === "pending" && s.deps.every((d) => subs.find((o) => o.n === d)?.phase === "done") && busy.length < dispatch.parallel && !busy.some((b) => overlaps(b.files, s.files)),
      );
      if (!next) break;
      const session = await this.sessions.create(run.repo, run.taskKey, {
        permissionMode: def.permissionMode,
        agent: next.agent,
        title: t("run.subtaskTitle", { n: next.n }),
        model: launchModel(next.model),
        subagent: next.subagent,
      });
      next.sessionId = session.id;
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
    const session = await this.sessions.get(lane.sessionId!);
    if (session.status !== "running") {
      await this.saveLane(run, lane, { phase: "starting", pendingPrompt: text }, t("run.resuming"));
      await this.sessions.resume(lane.sessionId!);
    } else if (session.activity === "starting" && !opts.force) {
      await this.saveLane(run, lane, { phase: "starting", pendingPrompt: text }, t("run.starting", { agent: agentLabel(run) }));
    } else {
      await this.send(run, text, lane);
    }
  }

  private async send(run: RunState, text: string, lane: Lane = run): Promise<void> {
    const step = (await this.store.defOf(run)).steps[run.stepIndex];
    try {
      this.sessions.paste(lane.sessionId!, text);
    } catch (error) {
      lane.lastMessage = (error as Error).message;
      await this.saveLane(run, lane, { phase: "waiting", pendingPrompt: undefined }, (error as Error).message);
      return;
    }
    const now = Date.now();
    await this.saveLane(
      run,
      lane,
      {
        phase: "running",
        stepStartedAt: now,
        ...(lane !== run && lane.startedAt === undefined ? { startedAt: now } : {}),
        sentPrompt: { stepIndex: run.stepIndex, text, at: now },
        pendingPrompt: undefined,
        noHook: undefined,
      },
      t("run.step", { step: step.title, agent: agentLabel(run) }),
    );
    this.watchForHooks(run, lane, now);
  }

  /**
   * Without Copilot's hooks nothing tells the engine the turn ended (the session manager's transcript
   * watch is the first fallback), so a prompt that gets no hook at all is reported, on the run for
   * a step and on the subtask for a subtask, instead of waiting silently.
   */
  private watchForHooks(run: RunState, lane: Lane, sentAt: number): void {
    const sub = lane === run ? undefined : (lane as SubtaskRun);
    const agent = sub ? sub.agent : (run.workflow?.steps[run.stepIndex]?.agent ?? DEFAULT_AGENT);
    if (agent !== "copilot") return;
    const sessionId = lane.sessionId!;
    const timer = setTimeout(() => {
      void this.serial(async () => {
        const current = await this.store.find(run.repo, run.taskKey);
        const target = current && (sub ? current.subtasks?.find((s) => s.n === sub.n) : current);
        if (!current || !target || target.sentPrompt?.at !== sentAt || target.phase !== "running" || this.sessions.hookSeen(sessionId)) return;
        if (target === current) await this.store.save(current, { noHook: true, message: t("run.noHook", { agent: AGENT_LABELS.copilot }) });
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
    const subagents = template.includes("{{subagents}}") && this.subagents ? await this.subagents(run.repo) : undefined;
    return renderPrompt(template, promptVars(await this.store.defOf(run), run.stepIndex, task, { previous: run.previous, subtasks: run.subtasks, subagents, ...extra }));
  }

  private async subtaskPrompt(run: RunState, sub: SubtaskRun): Promise<string> {
    const def = await this.store.defOf(run);
    const task = await getTask(run.repo, run.taskKey);
    return renderPrompt(def.steps[run.stepIndex].dispatch!.prompt, promptVars(def, run.stepIndex, task, { previous: run.previous, subtask: sub, subtasks: run.subtasks }));
  }

  /** The run-level reply and retry talk to the leader's session, which has nothing to answer while subtasks work. */
  private async notWhileDispatching(run: RunState): Promise<void> {
    if (dispatching(run, await this.store.defOf(run))) throw new HttpError(409, "Subtasks are running; answer or retry them one by one");
  }

  private async requireSubtask(repo: string, taskKey: string, n: number, phases: ReadonlyArray<SubtaskPhase>): Promise<{ run: RunState; sub: SubtaskRun }> {
    const run = await this.store.require(repo, taskKey, ["starting", "running", "waiting", "interrupted"]);
    if (!dispatching(run, await this.store.defOf(run))) throw new HttpError(409, "The run is not handing out subtasks");
    const sub = run.subtasks?.find((s) => s.n === n);
    if (!sub) throw new HttpError(404, `No subtask ${n}`);
    if (!phases.includes(sub.phase)) throw new HttpError(409, `Not allowed while subtask ${n} is ${sub.phase}`);
    return { run, sub };
  }

  private async ensureIdle(sub: SubtaskRun): Promise<void> {
    const session = await this.sessions.get(sub.sessionId!);
    if (session.status === "running" && session.activity === "busy") {
      throw new HttpError(409, "The agent is still working; wait for it or stop it in the terminal");
    }
  }

  /** Engine operations and hook handling run one at a time, so a Stop hook cannot race a click. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
