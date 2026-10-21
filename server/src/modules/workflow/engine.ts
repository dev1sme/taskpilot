import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../core/errors.js";
import { getTask, TASKS_DIR } from "../tasks/index.js";
import type { HookEvent, SessionView } from "../sessions/index.js";
import type { SessionMeta, StateStore } from "../../core/state.js";
import { loadWorkflow, OVERRIDE_DIR } from "./definition.js";
import { archiveOutputs } from "./archive.js";
import { appendHistory, HISTORY_TEXT } from "./history.js";
import type { RunState, StepDef, WorkflowDef } from "./types.js";
import { promptVars, renderPrompt } from "./vars.js";
import { t } from "../../core/i18n.js";

/** The parts of SessionManager the engine uses. */
export interface SessionPort {
  create(repo: string, taskKey: string, opts: { permissionMode?: string }): Promise<SessionView>;
  resume(id: string): Promise<SessionView>;
  stop(id: string): Promise<void>;
  get(id: string): Promise<SessionView>;
  paste(id: string, text: string): void;
}

export interface RunView {
  workflow: {
    source: string;
    origin: WorkflowDef["origin"];
    historyFile: string;
    steps: Array<{
      id: string;
      title: string;
      gate: StepDef["gate"];
      doneFile: string | null;
      outputs: Array<{ id: string; file: string }>;
    }>;
    /** The run follows the workflow as it was when it started, which has been edited since. */
    outdated: boolean;
  };
  /** Without the workflow snapshot, which only the engine needs. */
  run: Omit<RunState, "workflow"> | null;
}

const MTIME_SLACK_MS = 100;
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
          gate: s.gate,
          doneFile: s.doneWhen?.file ?? null,
          outputs: s.outputs.map((o) => ({ id: o.id, file: o.file })),
        })),
        outdated: !!pinned && JSON.stringify(pinned) !== JSON.stringify(current),
      },
      run: run ? withoutSnapshot(run) : null,
    };
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
    const session = await this.sessions.create(repo, taskKey, { permissionMode: def.permissionMode });
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

  approve(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.require(repo, taskKey, ["gate"]);
      const def = await this.defOf(run);
      const last = run.stepIndex + 1 >= def.steps.length;
      await this.log(run, HISTORY_TEXT.approve, last ? { body: HISTORY_TEXT.done } : {});
      if (last) {
        return this.save(run, { phase: "done", message: t("run.done") });
      }
      run.stepIndex += 1;
      await this.deliver(run, await this.prompt(run, def.steps[run.stepIndex].prompt));
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

  /** Sends the current step again, resuming the session first if it has exited. */
  retry(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.require(repo, taskKey, ["starting", "running", "waiting", "interrupted"]);
      const session = await this.sessions.get(run.sessionId);
      if (session.status === "running" && session.activity === "busy") {
        throw new HttpError(409, "Claude is still working; wait for it or stop it in the terminal");
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

  /** True when an active run drives this session; such a session must not be removed. */
  async usesSession(sessionId: string): Promise<boolean> {
    return (await this.bySession(sessionId)) !== undefined;
  }

  /** After a server restart no session is running; active runs cannot continue on their own. */
  recover(): Promise<void> {
    return this.serial(async () => {
      for (const run of (await this.state.load()).runs) {
        if (["starting", "running", "waiting"].includes(run.phase)) {
          await this.log(run, HISTORY_TEXT.interrupted, { body: HISTORY_TEXT.serverRestarted });
          await this.save(run, {
            phase: "interrupted",
            message: t("run.restarted"),
          });
        }
      }
    });
  }

  onHook(meta: SessionMeta, event: HookEvent, payload: Record<string, unknown> = {}): Promise<void> {
    return this.serial(async () => {
      const run = await this.bySession(meta.id);
      if (!run) return;
      if (event === "Stop" && typeof payload.last_assistant_message === "string") {
        run.lastMessage = payload.last_assistant_message;
      }
      if (event === "SessionStart" && run.phase === "starting" && run.pendingPrompt) {
        await this.send(run, run.pendingPrompt);
      } else if (event === "UserPromptSubmit" && run.phase === "waiting") {
        await this.save(run, { phase: "running", message: t("run.working") });
      } else if (event === "Stop" && (run.phase === "running" || run.phase === "waiting")) {
        await this.onStop(run);
      }
    });
  }

  onExit(meta: SessionMeta): Promise<void> {
    return this.serial(async () => {
      const run = await this.bySession(meta.id);
      if (!run || !["starting", "running", "waiting"].includes(run.phase)) return;
      await this.log(run, HISTORY_TEXT.interrupted, { body: HISTORY_TEXT.sessionStopped });
      await this.save(run, {
        phase: "interrupted",
        message: t("run.sessionStopped"),
      });
    });
  }

  private async onStop(run: RunState): Promise<void> {
    const def = await this.defOf(run);
    const step = def.steps[run.stepIndex];
    if (step.doneWhen && !(await this.writtenSince(run, step.doneWhen.file))) {
      await this.save(run, {
        phase: "waiting",
        message: t("run.notWritten", { file: step.doneWhen.file }),
      });
    } else if (step.gate === "approve") {
      const message = step.doneWhen ? t("run.gateFile", { step: step.title, file: step.doneWhen.file }) : t("run.gate", { step: step.title });
      await this.save(run, { phase: "gate", message });
    } else if (run.stepIndex + 1 >= def.steps.length) {
      await this.save(run, { phase: "done", message: t("run.done") });
    } else {
      run.stepIndex += 1;
      await this.deliver(run, await this.prompt(run, def.steps[run.stepIndex].prompt));
    }
  }

  /**
   * Sends `text` now if the session can take input; otherwise keeps it pending and (re)starts
   * the session; SessionStart then delivers it. `force` pastes even before SessionStart was seen
   * (manual retry when hooks did not arrive).
   */
  private async deliver(run: RunState, text: string, opts: { force?: boolean } = {}): Promise<void> {
    const session = await this.sessions.get(run.sessionId);
    if (session.status !== "running") {
      await this.save(run, { phase: "starting", message: t("run.resuming"), pendingPrompt: text });
      await this.sessions.resume(run.sessionId);
    } else if (session.activity === "starting" && !opts.force) {
      await this.save(run, {
        phase: "starting",
        message: t("run.starting"),
        pendingPrompt: text,
      });
    } else {
      await this.send(run, text);
    }
  }

  private async send(run: RunState, text: string): Promise<void> {
    const step = (await this.defOf(run)).steps[run.stepIndex];
    this.sessions.paste(run.sessionId, text);
    const now = Date.now();
    await this.save(run, {
      phase: "running",
      stepStartedAt: now,
      sentPrompt: { stepIndex: run.stepIndex, text, at: now },
      message: t("run.step", { step: step.title }),
      pendingPrompt: undefined,
    });
  }

  private async prompt(run: RunState, template: string, extra: { feedback?: string } = {}): Promise<string> {
    const task = await getTask(run.repo, run.taskKey);
    return renderPrompt(template, promptVars(await this.defOf(run), run.stepIndex, task, { previous: run.previous, ...extra }));
  }

  /** The workflow the run started with; runs saved before snapshots existed follow the current one. */
  private defOf(run: RunState): Promise<WorkflowDef> {
    return run.workflow ? Promise.resolve(run.workflow) : this.loadDef(run.repo);
  }

  private async writtenSince(run: RunState, file: string): Promise<boolean> {
    try {
      const s = await stat(path.join(taskDirOf(run), file));
      // File timestamps come from the kernel's coarse clock and can trail Date.now() by a few ms.
      return s.mtimeMs >= run.stepStartedAt - MTIME_SLACK_MS;
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
    return (await this.state.load()).runs.find((r) => r.sessionId === sessionId && ACTIVE.includes(r.phase));
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

function withoutSnapshot(run: RunState): Omit<RunState, "workflow"> {
  const { workflow: _workflow, ...rest } = run;
  return rest;
}

function taskDirOf(run: RunState): string {
  return path.join(run.repo, TASKS_DIR, run.taskKey);
}
