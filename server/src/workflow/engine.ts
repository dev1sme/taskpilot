import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../errors.js";
import { getTask, SPEC_DIR, TASKS_DIR } from "../repo/tasks.js";
import type { HookEvent } from "../sessions/hooks.js";
import type { SessionView } from "../sessions/manager.js";
import type { SessionMeta, StateStore } from "../state.js";
import { loadWorkflow, render } from "./definition.js";
import type { RunState, StepDef, WorkflowDef } from "./types.js";

/** The parts of SessionManager the engine uses. */
export interface SessionPort {
  create(repo: string, taskKey: string, opts: { permissionMode?: string }): Promise<SessionView>;
  resume(id: string): Promise<SessionView>;
  get(id: string): Promise<SessionView>;
  paste(id: string, text: string): void;
}

export interface RunView {
  workflow: {
    source: string;
    steps: Array<{ id: string; title: string; gate: StepDef["gate"]; doneFile: string | null }>;
  };
  run: RunState | null;
}

const MTIME_SLACK_MS = 100;
const ACTIVE: ReadonlyArray<RunState["phase"]> = ["starting", "running", "waiting", "gate", "interrupted"];

/**
 * Drives one workflow run per task: sends each step's prompt into the run's Claude session,
 * advances on the Stop hook when the step's done-when file was written, and stops at gates.
 */
export class WorkflowEngine extends EventEmitter<{ change: [run: RunState] }> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly state: StateStore,
    private readonly sessions: SessionPort,
    private readonly loadDef: (repo: string) => Promise<WorkflowDef> = loadWorkflow,
  ) {
    super();
  }

  async view(repo: string, taskKey: string): Promise<RunView> {
    const def = await this.loadDef(repo);
    return {
      workflow: {
        source: def.source,
        steps: def.steps.map((s) => ({ id: s.id, title: s.title, gate: s.gate, doneFile: s.doneWhen?.file ?? null })),
      },
      run: (await this.find(repo, taskKey)) ?? null,
    };
  }

  start(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const existing = await this.find(repo, taskKey);
      if (existing && ACTIVE.includes(existing.phase)) throw new HttpError(409, "A workflow run is already active");
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
        startedAt: now,
        updatedAt: now,
      };
      await this.deliver(run, await this.prompt(run, def.steps[0].prompt));
      return run;
    });
  }

  approve(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.require(repo, taskKey, ["gate"]);
      const def = await this.loadDef(repo);
      if (run.stepIndex + 1 >= def.steps.length) {
        return this.save(run, { phase: "done", message: "Quy trình hoàn tất." });
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
      const step = (await this.loadDef(repo)).steps[run.stepIndex];
      const template = step.onReject ?? "{{feedback}}";
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
      const step = (await this.loadDef(repo)).steps[run.stepIndex];
      await this.deliver(run, run.pendingPrompt ?? (await this.prompt(run, step.prompt)), { force: true });
      return run;
    });
  }

  cancel(repo: string, taskKey: string): Promise<RunState> {
    return this.serial(async () => {
      const run = await this.require(repo, taskKey, ACTIVE);
      return this.save(run, { phase: "cancelled", message: "Đã huỷ quy trình. Session vẫn giữ nguyên.", pendingPrompt: undefined });
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
          await this.save(run, {
            phase: "interrupted",
            message: "TaskPilot đã khởi động lại. Bấm \"Gửi lại bước\" để resume session và chạy tiếp.",
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
        await this.save(run, { phase: "running", message: "Claude đang làm việc." });
      } else if (event === "Stop" && (run.phase === "running" || run.phase === "waiting")) {
        await this.onStop(run);
      }
    });
  }

  onExit(meta: SessionMeta): Promise<void> {
    return this.serial(async () => {
      const run = await this.bySession(meta.id);
      if (!run || !["starting", "running", "waiting"].includes(run.phase)) return;
      await this.save(run, {
        phase: "interrupted",
        message: "Session đã dừng giữa chừng. Bấm \"Gửi lại bước\" để resume session và chạy tiếp bước này.",
      });
    });
  }

  private async onStop(run: RunState): Promise<void> {
    const def = await this.loadDef(run.repo);
    const step = def.steps[run.stepIndex];
    if (step.doneWhen && !(await this.writtenSince(run, step.doneWhen.file))) {
      await this.save(run, {
        phase: "waiting",
        message: `Claude đã dừng nhưng chưa ghi ${step.doneWhen.file}. Trả lời Claude trong terminal, hoặc bấm "Gửi lại bước".`,
      });
    } else if (step.gate === "approve") {
      const what = step.doneWhen ? ` Xem ${step.doneWhen.file} rồi duyệt hoặc góp ý.` : "";
      await this.save(run, { phase: "gate", message: `Bước "${step.title}" xong, chờ duyệt.${what}` });
    } else if (run.stepIndex + 1 >= def.steps.length) {
      await this.save(run, { phase: "done", message: "Quy trình hoàn tất." });
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
      await this.save(run, { phase: "starting", message: "Đang resume session…", pendingPrompt: text });
      await this.sessions.resume(run.sessionId);
    } else if (session.activity === "starting" && !opts.force) {
      await this.save(run, {
        phase: "starting",
        message: "Đang chờ Claude khởi động. Nếu Claude hỏi trust folder, trả lời trong terminal.",
        pendingPrompt: text,
      });
    } else {
      await this.send(run, text);
    }
  }

  private async send(run: RunState, text: string): Promise<void> {
    const step = (await this.loadDef(run.repo)).steps[run.stepIndex];
    this.sessions.paste(run.sessionId, text);
    await this.save(run, {
      phase: "running",
      stepStartedAt: Date.now(),
      message: `Claude đang làm bước "${step.title}".`,
      pendingPrompt: undefined,
    });
  }

  private async prompt(run: RunState, template: string, extra: Record<string, string> = {}): Promise<string> {
    const task = await getTask(run.repo, run.taskKey);
    const taskDir = path.posix.join(TASKS_DIR.split(path.sep).join("/"), run.taskKey);
    return render(template, {
      key: task.key,
      title: task.title,
      taskDir,
      specDir: `${taskDir}/${SPEC_DIR}`,
      ...extra,
    });
  }

  private async writtenSince(run: RunState, file: string): Promise<boolean> {
    try {
      const s = await stat(path.join(run.repo, TASKS_DIR, run.taskKey, file));
      // File timestamps come from the kernel's coarse clock and can trail Date.now() by a few ms.
      return s.mtimeMs >= run.stepStartedAt - MTIME_SLACK_MS;
    } catch {
      return false;
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
