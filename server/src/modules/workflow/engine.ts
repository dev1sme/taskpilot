import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AGENT_LABELS, DEFAULT_AGENT, type Agent } from "../../core/agents.js";
import { HttpError } from "../../core/errors.js";
import { getTask, TASKS_DIR } from "../tasks/index.js";
import type { HookEvent, SessionView } from "../sessions/index.js";
import type { SessionMeta, StateStore } from "../../core/state.js";
import { checkForParallel, overlaps, parseAssignments, type ParsedAssignments } from "./assignments.js";
import { loadWorkflow, OVERRIDE_DIR, reportOf } from "./definition.js";
import { archiveOutputs } from "./archive.js";
import { appendHistory, HISTORY_TEXT } from "./history.js";
import { parseQuestions, type Question } from "./questions.js";
import type { Assignment, RunPhase, RunState, StepDef, SubtaskPhase, SubtaskRun, WorkflowDef } from "./types.js";
import { promptVars, renderPrompt } from "./vars.js";
import { t } from "../../core/i18n.js";

/** The parts of SessionManager the engine uses. */
export interface SessionPort {
  create(repo: string, taskKey: string, opts: { permissionMode?: string; agent?: Agent; title?: string }): Promise<SessionView>;
  resume(id: string): Promise<SessionView>;
  stop(id: string): Promise<void>;
  get(id: string): Promise<SessionView>;
  paste(id: string, text: string): void;
  /** Whether the session's running process has sent a hook of its own yet. */
  hookSeen(id: string): boolean;
}

export interface RunView {
  workflow: {
    source: string;
    origin: WorkflowDef["origin"];
    historyFile: string;
    steps: Array<{
      id: string;
      title: string;
      agent: Agent;
      gate: StepDef["gate"];
      doneFile: string | null;
      outputs: Array<{ id: string; file: string }>;
      /** Set on a dispatch step. */
      dispatch: { from: string; report: string; parallel: number } | null;
    }>;
    /** The run follows the workflow as it was when it started, which has been edited since. */
    outdated: boolean;
  };
  /** Without the workflow snapshot, which only the engine needs. */
  run: Omit<RunState, "workflow"> | null;
  /** Claude's numbered questions for the reviewer, at a gate or while it waits for an answer. */
  questions: Question[];
  /** At a gate whose next step is a dispatch step: the subtasks the plan's table gives, or why it is not usable. */
  assignments: ParsedAssignments | null;
  /** Questions of each subtask that waits for an answer, by subtask number. */
  subtaskQuestions: Record<number, Question[]>;
}

/**
 * What the engine drives in one session: the run itself (the leader) or one of its subtasks. Both
 * hold the same fields, so delivering a prompt and reading a hook work the same way for either.
 */
interface Lane {
  sessionId?: string;
  phase: RunPhase | SubtaskPhase;
  stepStartedAt?: number;
  pendingPrompt?: string;
  sentPrompt?: { stepIndex: number; text: string; at: number };
  lastMessage?: string;
}

const MTIME_SLACK_MS = 100;
/** How long a Copilot session may stay without any hook after its prompt before the run says so. */
const NO_HOOK_WARN_MS = 60_000;
const ACTIVE: ReadonlyArray<RunState["phase"]> = ["starting", "running", "waiting", "gate", "interrupted"];

/**
 * Drives one workflow run per task: sends each step's prompt into the run's Claude session,
 * advances on the Stop hook when the step's done-when file was written, and stops at gates.
 */
export class WorkflowEngine extends EventEmitter<{ change: [run: RunState]; warning: [error: unknown] }> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly state: StateStore,
    private readonly sessions: SessionPort,
    private readonly loadDef: (repo: string) => Promise<WorkflowDef> = loadWorkflow,
    private readonly noHookWarnMs: number = NO_HOOK_WARN_MS,
  ) {
    super();
  }

  /** The active run's workflow snapshot, else the workflow a new run would get. */
  async view(repo: string, taskKey: string): Promise<RunView> {
    const run = await this.find(repo, taskKey);
    const pinned = run && ACTIVE.includes(run.phase) ? run.workflow : undefined;
    const current = await this.loadDef(repo).catch((e: unknown) => {
      if (pinned) return null;
      throw e;
    });
    const def = pinned ?? current!;
    return {
      workflow: {
        source: def.source,
        origin: def.origin,
        historyFile: def.history.file,
        steps: def.steps.map((s) => ({
          id: s.id,
          title: s.title,
          agent: s.agent ?? DEFAULT_AGENT,
          gate: s.gate,
          doneFile: s.doneWhen?.file ?? null,
          outputs: s.outputs.map((o) => ({ id: o.id, file: o.file })),
          dispatch: s.dispatch ? { from: s.dispatch.from, report: s.dispatch.report, parallel: s.dispatch.parallel } : null,
        })),
        outdated: !!pinned && JSON.stringify(pinned) !== JSON.stringify(current),
      },
      run: run ? withoutSnapshot(run) : null,
      questions: run ? await this.questionsOf(run, def) : [],
      assignments: run?.phase === "gate" && def.steps[run.stepIndex + 1]?.dispatch ? await this.assignmentsFor(run, def, run.stepIndex + 1) : null,
      subtaskQuestions: Object.fromEntries(
        (run?.subtasks ?? []).filter((s) => s.phase === "waiting").map((s) => [s.n, parseQuestions(s.lastMessage ?? "")]),
      ),
    };
  }

  /** At a gate: the open questions of the step's done-when document, else of Claude's last message. */
  private async questionsOf(run: RunState, def: WorkflowDef): Promise<Question[]> {
    if (dispatching(run, def)) return [];
    if (run.phase === "gate") {
      const file = def.steps[run.stepIndex]?.doneWhen?.file;
      const doc = file ? await readFile(path.join(taskDirOf(run), file), "utf8").catch(() => "") : "";
      const fromDoc = parseQuestions(doc);
      if (fromDoc.length > 0) return fromDoc;
    }
    return run.phase === "gate" || run.phase === "waiting" ? parseQuestions(run.lastMessage ?? "") : [];
  }

  start(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const existing = await this.find(repo, taskKey);
      if (existing && ACTIVE.includes(existing.phase)) throw new HttpError(409, "A workflow run is already active");
      return this.begin(repo, taskKey);
    });
  }

  /**
   * Starts over from the first step in a new session, whatever the current phase. The old session
   * is stopped (it stays listed) and the task's documents are copied to archive/ first: Claude then
   * rewrites them in place, so the step names and done-when files do not change.
   */
  restart(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const existing = await this.find(repo, taskKey);
      if (!existing) throw new HttpError(409, "No workflow run to restart; start one first");
      const old = await this.sessions.get(existing.sessionId).catch(() => null);
      if (old?.status === "running") await this.sessions.stop(existing.sessionId);
      for (const sub of existing.subtasks ?? []) {
        if (sub.sessionId && (await this.sessions.get(sub.sessionId).catch(() => null))?.status === "running") await this.sessions.stop(sub.sessionId);
      }
      const before = await this.defOf(existing);
      const previous = await archiveOutputs(taskDirOf(existing), before.history.file, new Date());
      await this.log(existing, HISTORY_TEXT.restart, {
        body: previous.files.length ? HISTORY_TEXT.archived(previous.dir, previous.files) : HISTORY_TEXT.nothingArchived,
      });
      return this.begin(repo, taskKey, previous);
    });
  }

  /**
   * A new run on a new session at step 1, pinned to the workflow as it is now; callers hold the
   * queue. `previous` is what a restart archived, for {{previousRun}}.
   */
  private async begin(repo: string, taskKey: string, previous?: RunState["previous"]): Promise<RunState> {
    const def = await this.loadDef(repo);
    const session = await this.sessions.create(repo, taskKey, { permissionMode: def.permissionMode, agent: def.steps[0].agent ?? DEFAULT_AGENT });
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
    const source = def.origin === "repo" ? `${OVERRIDE_DIR.split(path.sep).join("/")}/` : HISTORY_TEXT.defaultSource;
    await this.log(run, HISTORY_TEXT.start, { body: HISTORY_TEXT.startBody(source, def.steps.length) });
    await this.deliver(run, await this.prompt(run, def.steps[0].prompt));
    return run;
  }

  /**
   * Approves the gate. `note` (e.g. answers to Claude's open questions) is quoted in the decision
   * log, which the next step's prompt has Claude read first.
   */
  approve(repo: string, taskKey: string, note = ""): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.require(repo, taskKey, ["gate"]);
      const def = await this.defOf(run);
      const last = run.stepIndex + 1 >= def.steps.length;
      const table = !last && def.steps[run.stepIndex + 1].dispatch ? await this.assignmentsFor(run, def, run.stepIndex + 1) : null;
      if (table && table.errors.length > 0) throw new HttpError(400, t("run.assignmentsInvalid", { errors: table.errors.join("; ") }));
      await this.log(run, HISTORY_TEXT.approve, { ...(note.trim() ? { quote: note.trim() } : {}), ...(last ? { body: HISTORY_TEXT.done } : {}) });
      if (last) {
        return this.save(run, { phase: "done", message: t("run.done") });
      }
      await this.enterStep(run, def, run.stepIndex + 1, table?.items);
      return run;
    });
  }

  feedback(repo: string, taskKey: string, text: string): Promise<RunState> {
    return this.serial(async () => {
      if (!text.trim()) throw new HttpError(400, "Feedback is empty");
      const run = await this.require(repo, taskKey, ["gate"]);
      const step = (await this.defOf(run)).steps[run.stepIndex];
      const template = step.onReject ?? "{{feedback}}";
      await this.log(run, HISTORY_TEXT.feedback, { quote: text.trim() });
      await this.deliver(run, await this.prompt(run, template, { feedback: text.trim() }));
      return run;
    });
  }

  /** Answers Claude while it waits (it ended its turn without the step's document): logged, then pasted as it is. */
  reply(repo: string, taskKey: string, text: string): Promise<RunState> {
    return this.serial(async () => {
      if (!text.trim()) throw new HttpError(400, "Reply is empty");
      const run = await this.require(repo, taskKey, ["waiting"]);
      await this.notWhileDispatching(run);
      const session = await this.sessions.get(run.sessionId);
      if (session.status === "running" && session.activity === "busy") {
        throw new HttpError(409, "The agent is still working; wait for it or stop it in the terminal");
      }
      await this.log(run, HISTORY_TEXT.reply, { quote: text.trim() });
      await this.deliver(run, text.trim());
      return run;
    });
  }

  /** Sends the current step again, resuming the session first if it has exited. */
  retry(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.require(repo, taskKey, ["starting", "running", "waiting", "interrupted"]);
      await this.notWhileDispatching(run);
      const session = await this.sessions.get(run.sessionId);
      if (session.status === "running" && session.activity === "busy") {
        throw new HttpError(409, "The agent is still working; wait for it or stop it in the terminal");
      }
      const step = (await this.defOf(run)).steps[run.stepIndex];
      await this.deliver(run, run.pendingPrompt ?? (await this.prompt(run, step.prompt)), { force: true });
      return run;
    });
  }

  cancel(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.require(repo, taskKey, ACTIVE);
      await this.log(run, HISTORY_TEXT.cancel);
      return this.save(run, { phase: "cancelled", message: t("run.cancelled"), pendingPrompt: undefined });
    });
  }

  /** Answers a subtask that waits (it ended its turn without its report): logged, then pasted as it is. */
  replySubtask(repo: string, taskKey: string, n: number, text: string): Promise<RunState> {
    return this.serial(async () => {
      if (!text.trim()) throw new HttpError(400, "Reply is empty");
      const { run, sub } = await this.requireSubtask(repo, taskKey, n, ["waiting"]);
      await this.ensureIdle(sub);
      await this.log(run, HISTORY_TEXT.subtaskReply(n), { quote: text.trim() });
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

  /** True when an active run drives this session (as the leader or as a subtask); such a session must not be removed. */
  async usesSession(sessionId: string): Promise<boolean> {
    return (await this.bySession(sessionId)) !== undefined;
  }

  /** After a server restart no session is running; active runs cannot continue on their own. */
  recover(): Promise<void> {
    return this.serial(async () => {
      for (const run of (await this.state.load()).runs) {
        if (["starting", "running", "waiting"].includes(run.phase)) {
          await this.log(run, HISTORY_TEXT.interrupted, { body: HISTORY_TEXT.serverRestarted });
          for (const sub of run.subtasks ?? []) {
            if (["starting", "running", "waiting"].includes(sub.phase)) sub.phase = "interrupted";
          }
          await this.save(run, { phase: "interrupted", message: t("run.restarted") });
        }
      }
    });
  }

  onHook(meta: SessionMeta, event: HookEvent, payload: Record<string, unknown> = {}): Promise<void> {
    return this.serial(async () => {
      const run = await this.bySession(meta.id);
      if (!run) return;
      const lane = laneOf(run, meta.id)!;
      // While subtasks run, the leader's session sits idle; nothing it reports concerns the run.
      if (lane === run && dispatching(run, await this.defOf(run))) return;
      if (lane === run && run.phase === "running" && run.message === t("run.noHook", { agent: agentLabel(run) })) {
        await this.save(run, { message: t("run.step", { step: (await this.defOf(run)).steps[run.stepIndex].title, agent: agentLabel(run) }) });
      }
      if (event === "Stop" && typeof payload.last_assistant_message === "string") {
        lane.lastMessage = payload.last_assistant_message;
      }
      if (event === "SessionStart" && lane.phase === "starting" && lane.pendingPrompt) {
        await this.send(run, lane.pendingPrompt, lane);
      } else if (event === "UserPromptSubmit" && lane.phase === "waiting") {
        await this.saveLane(run, lane, { phase: "running" }, t("run.working", { agent: agentLabel(run) }));
      } else if (event === "Stop" && (lane.phase === "running" || lane.phase === "waiting")) {
        if (lane === run) await this.onStop(run);
        else await this.onSubtaskStop(run, lane as SubtaskRun);
      }
    });
  }

  onExit(meta: SessionMeta): Promise<void> {
    return this.serial(async () => {
      const run = await this.bySession(meta.id);
      if (!run) return;
      const lane = laneOf(run, meta.id)!;
      if (!["starting", "running", "waiting"].includes(lane.phase)) return;
      if (lane === run) {
        if (dispatching(run, await this.defOf(run))) return;
        await this.log(run, HISTORY_TEXT.interrupted, { body: HISTORY_TEXT.sessionStopped });
        await this.save(run, { phase: "interrupted", message: t("run.sessionStopped") });
      } else {
        const sub = lane as SubtaskRun;
        await this.log(run, HISTORY_TEXT.subtaskInterrupted(sub.n), { body: HISTORY_TEXT.subtaskSessionStopped });
        await this.saveLane(run, sub, { phase: "interrupted" }, "");
      }
    });
  }

  private async onStop(run: RunState): Promise<void> {
    const def = await this.defOf(run);
    const step = def.steps[run.stepIndex];
    if (step.doneWhen && !(await this.writtenSince(run, step.doneWhen.file))) {
      await this.save(run, {
        phase: "waiting",
        message: t("run.notWritten", { file: step.doneWhen.file, agent: agentLabel(run) }),
      });
    } else if (step.gate === "approve") {
      const message = step.doneWhen ? t("run.gateFile", { step: step.title, file: step.doneWhen.file }) : t("run.gate", { step: step.title });
      await this.save(run, { phase: "gate", message });
    } else if (run.stepIndex + 1 >= def.steps.length) {
      await this.save(run, { phase: "done", message: t("run.done") });
    } else {
      await this.enterStep(run, def, run.stepIndex + 1);
    }
  }

  /** A subtask's turn ended: done when its report was written since the prompt, else it waits for an answer. */
  private async onSubtaskStop(run: RunState, sub: SubtaskRun): Promise<void> {
    const def = await this.defOf(run);
    if (!(await this.writtenSince(run, sub.report, sub.stepStartedAt))) {
      await this.saveLane(run, sub, { phase: "waiting" }, "");
      return;
    }
    await this.saveLane(run, sub, { phase: "done", pendingPrompt: undefined }, "");
    await this.log(run, HISTORY_TEXT.subtaskDone(sub.n, AGENT_LABELS[sub.agent]), { body: HISTORY_TEXT.subtaskDoneBody(sub.report) });
    if ((await this.sessions.get(sub.sessionId!).catch(() => null))?.status === "running") await this.sessions.stop(sub.sessionId!);
    if ((run.subtasks ?? []).every((s) => s.phase === "done")) {
      await this.log(run, HISTORY_TEXT.backToLeader, { body: HISTORY_TEXT.backToLeaderBody(run.subtasks!.length) });
      await this.enterStep(run, def, run.stepIndex + 1);
    } else await this.launchReady(run, def);
  }

  /**
   * Moves the run to step `index` and sends its prompt. A step for another agent gets a new session
   * of that agent: the previous one is stopped (it stays listed) and the switch goes into the decision
   * log, which the step's prompt has the agent read with the task's documents. A dispatch step opens
   * one session per subtask instead and leaves the leader's session as it is.
   */
  private async enterStep(run: RunState, def: WorkflowDef, index: number, items?: Assignment[]): Promise<void> {
    run.stepIndex = index;
    const step = def.steps[index];
    if (step.dispatch) return this.startDispatch(run, def, step.dispatch.report, items ?? []);
    const agent = step.agent ?? DEFAULT_AGENT;
    const current = await this.sessions.get(run.sessionId).catch(() => null);
    if (current && current.agent !== agent) {
      if (current.status === "running") await this.sessions.stop(run.sessionId);
      const session = await this.sessions.create(run.repo, run.taskKey, { permissionMode: def.permissionMode, agent });
      await this.log(run, HISTORY_TEXT.switchAgent, { body: HISTORY_TEXT.switchAgentBody(AGENT_LABELS[current.agent], AGENT_LABELS[agent]) });
      await this.save(run, { sessionId: session.id });
    }
    await this.deliver(run, await this.prompt(run, step.prompt));
  }

  private async startDispatch(run: RunState, def: WorkflowDef, report: string, items: Assignment[]): Promise<void> {
    const dispatch = def.steps[run.stepIndex].dispatch!;
    const subtasks: SubtaskRun[] = items.map((a) => ({ ...a, phase: "pending", report: reportOf(report, a.n) }));
    await this.save(run, { subtasks, pendingPrompt: undefined, phase: "running", message: t("run.dispatching", { done: 0, total: subtasks.length }) });
    await this.log(run, HISTORY_TEXT.dispatch, {
      body: HISTORY_TEXT.dispatchBody(items.map((a) => ({ ...a, agent: AGENT_LABELS[a.agent] })), dispatch.parallel),
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
          s.phase === "pending" &&
          s.deps.every((d) => subs.find((o) => o.n === d)?.phase === "done") &&
          busy.length < dispatch.parallel &&
          !busy.some((b) => overlaps(b.files, s.files)),
      );
      if (!next) break;
      const session = await this.sessions.create(run.repo, run.taskKey, {
        permissionMode: def.permissionMode,
        agent: next.agent,
        title: t("run.subtaskTitle", { n: next.n }),
      });
      next.sessionId = session.id;
      next.phase = "starting";
      await this.save(run, {});
      await this.deliver(run, await this.subtaskPrompt(run, next), { lane: next });
    }
    this.syncDispatch(run);
    await this.save(run, {});
  }

  /** The run's own phase and message while its subtasks work: the one needing attention first. */
  private syncDispatch(run: RunState) {
    const subs = run.subtasks ?? [];
    const interrupted = subs.find((s) => s.phase === "interrupted");
    const waiting = subs.find((s) => s.phase === "waiting");
    const done = subs.filter((s) => s.phase === "done").length;
    if (interrupted) Object.assign(run, { phase: "interrupted", message: t("run.subtaskInterrupted", { n: interrupted.n }) });
    else if (waiting) Object.assign(run, { phase: "waiting", message: t("run.subtaskWaiting", { n: waiting.n, file: waiting.report }) });
    else Object.assign(run, { phase: "running", message: t("run.dispatching", { done, total: subs.length }) });
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
    const step = (await this.defOf(run)).steps[run.stepIndex];
    this.sessions.paste(lane.sessionId!, text);
    const now = Date.now();
    await this.saveLane(
      run,
      lane,
      { phase: "running", stepStartedAt: now, sentPrompt: { stepIndex: run.stepIndex, text, at: now }, pendingPrompt: undefined },
      t("run.step", { step: step.title, agent: agentLabel(run) }),
    );
    this.watchForHooks(run, lane, now);
  }

  /**
   * Copilot loads a repo's hooks only in a trusted folder. Without them nothing tells the engine
   * the turn ended, so a prompt that gets no hook at all is reported instead of waiting silently.
   */
  private watchForHooks(run: RunState, lane: Lane, sentAt: number): void {
    const sub = lane === run ? undefined : (lane as SubtaskRun);
    const agent = sub ? sub.agent : (run.workflow?.steps[run.stepIndex]?.agent ?? DEFAULT_AGENT);
    if (agent !== "copilot") return;
    const sessionId = lane.sessionId!;
    const timer = setTimeout(() => {
      void this.serial(async () => {
        const current = await this.find(run.repo, run.taskKey);
        const same = current && (sub ? current.subtasks?.find((s) => s.n === sub.n) : current)?.sentPrompt?.at === sentAt;
        if (!current || !same || current.phase !== "running" || this.sessions.hookSeen(sessionId)) return;
        if (sub) this.emit("warning", new Error(`Copilot session of subtask ${sub.n} sent no hook ${this.noHookWarnMs} ms after its prompt`));
        else await this.save(current, { message: t("run.noHook", { agent: AGENT_LABELS.copilot }) });
      }).catch((e: unknown) => this.emit("warning", e));
    }, this.noHookWarnMs);
    timer.unref();
  }

  /** Saves a lane's change: the run's own fields with `message`, or a subtask's with the run's phase following. */
  private async saveLane(run: RunState, lane: Lane, patch: Partial<Lane>, message: string): Promise<void> {
    if (lane === run) await this.save(run, { ...patch, message } as Partial<RunState>);
    else {
      Object.assign(lane, patch);
      this.syncDispatch(run);
      await this.save(run, {});
    }
  }

  private async prompt(run: RunState, template: string, extra: { feedback?: string } = {}): Promise<string> {
    const task = await getTask(run.repo, run.taskKey);
    return renderPrompt(template, promptVars(await this.defOf(run), run.stepIndex, task, { previous: run.previous, subtasks: run.subtasks, ...extra }));
  }

  private async subtaskPrompt(run: RunState, sub: SubtaskRun): Promise<string> {
    const def = await this.defOf(run);
    const task = await getTask(run.repo, run.taskKey);
    return renderPrompt(def.steps[run.stepIndex].dispatch!.prompt, promptVars(def, run.stepIndex, task, { previous: run.previous, subtask: sub, subtasks: run.subtasks }));
  }

  /** The subtasks a dispatch step would get from the plan's table, with the problems that keep them from running. */
  private async assignmentsFor(run: RunState, def: WorkflowDef, index: number): Promise<ParsedAssignments> {
    const dispatch = def.steps[index].dispatch!;
    const file = def.steps.flatMap((s) => s.outputs).find((o) => o.id === dispatch.from)?.file ?? "";
    const doc = await readFile(path.join(taskDirOf(run), file), "utf8").catch(() => "");
    const parsed = parseAssignments(doc);
    const errors = parsed.errors.length ? parsed.errors : checkForParallel(parsed.items, dispatch.parallel);
    return { items: errors.length ? [] : parsed.items, errors };
  }

  /** The run-level reply and retry talk to the leader's session, which has nothing to answer while subtasks work. */
  private async notWhileDispatching(run: RunState): Promise<void> {
    if (dispatching(run, await this.defOf(run))) throw new HttpError(409, "Subtasks are running; answer or retry them one by one");
  }

  private async requireSubtask(repo: string, taskKey: string, n: number, phases: ReadonlyArray<SubtaskPhase>): Promise<{ run: RunState; sub: SubtaskRun }> {
    const run = await this.require(repo, taskKey, ["starting", "running", "waiting", "interrupted"]);
    if (!dispatching(run, await this.defOf(run))) throw new HttpError(409, "The run is not handing out subtasks");
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

  /** The workflow the run started with; runs saved before snapshots existed follow the current one. */
  private defOf(run: RunState): Promise<WorkflowDef> {
    return run.workflow ? Promise.resolve(run.workflow) : this.loadDef(run.repo);
  }

  private async writtenSince(run: RunState, file: string, since: number = run.stepStartedAt): Promise<boolean> {
    try {
      const s = await stat(path.join(taskDirOf(run), file));
      // File timestamps come from the kernel's coarse clock and can trail Date.now() by a few ms.
      return s.mtimeMs >= since - MTIME_SLACK_MS;
    } catch {
      return false;
    }
  }

  /** Appends to the task's decision log; a failed write is reported but never blocks the run. */
  private async log(run: RunState, source: string, extra: { body?: string; quote?: string } = {}): Promise<void> {
    try {
      const def = await this.defOf(run);
      const step = def.steps[run.stepIndex];
      await appendHistory(taskDirOf(run), def.history.file, run.taskKey, { at: Date.now(), step: step?.title ?? "", source, ...extra });
    } catch (e) {
      this.emit("warning", e);
    }
  }

  private async save(run: RunState, patch: Partial<RunState>): Promise<RunState> {
    Object.assign(run, patch, { updatedAt: Date.now() });
    await this.state.update((s) => {
      s.runs = s.runs.filter((r) => !(r.repo === run.repo && r.taskKey === run.taskKey));
      s.runs.push(run);
    });
    this.emit("change", run);
    return run;
  }

  private async find(repo: string, taskKey: string): Promise<RunState | undefined> {
    return (await this.state.load()).runs.find((r) => r.repo === repo && r.taskKey === taskKey);
  }

  private async bySession(sessionId: string): Promise<RunState | undefined> {
    return (await this.state.load()).runs.find((r) => laneOf(r, sessionId) && ACTIVE.includes(r.phase));
  }

  private async require(repo: string, taskKey: string, phases: ReadonlyArray<RunState["phase"]>): Promise<RunState> {
    const run = await this.find(repo, taskKey);
    if (!run) throw new HttpError(404, "No workflow run for this task");
    if (!phases.includes(run.phase)) throw new HttpError(409, `Not allowed while the run is ${run.phase}`);
    return run;
  }

  /** Engine operations and hook handling run one at a time, so a Stop hook cannot race a click. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** The run itself when `sessionId` is its leader's session, else the subtask that session works on. */
function laneOf(run: RunState, sessionId: string): Lane | undefined {
  return run.sessionId === sessionId ? run : run.subtasks?.find((s) => s.sessionId === sessionId);
}

/** The run is at its dispatch step: subtasks are being handed out and worked on. */
function dispatching(run: RunState, def: WorkflowDef): boolean {
  return !!run.subtasks && !!def.steps[run.stepIndex]?.dispatch;
}

function withoutSnapshot(run: RunState): Omit<RunState, "workflow"> {
  const { workflow: _workflow, ...rest } = run;
  return rest;
}

/** Name of the agent that runs the run's current step, for run messages. */
function agentLabel(run: RunState): string {
  return AGENT_LABELS[run.workflow?.steps[run.stepIndex]?.agent ?? DEFAULT_AGENT];
}

function taskDirOf(run: RunState): string {
  return path.join(run.repo, TASKS_DIR, run.taskKey);
}
