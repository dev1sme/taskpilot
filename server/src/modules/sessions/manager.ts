import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { HttpError } from "../../core/errors.js";
import type { SessionMeta, StateStore } from "../../core/state.js";
import { nextActivity, type Activity, type HookEvent } from "./hooks.js";
import type { Launcher } from "../../core/claude/launch.js";
import { DEFAULT_AGENT, type Agent } from "../../core/agents.js";
import { backendOf, type HookState } from "./backends/index.js";
import type { AgentBackend } from "./backends/types.js";
import { PtyTransport, attachPty } from "./transports/pty.js";
import type { SessionTransport } from "./transports/types.js";

export type SessionStatus = "running" | "exited";

export interface SessionView extends SessionMeta {
  agent: Agent;
  status: SessionStatus;
  exitCode: number | null;
  /** null while the session is not running. */
  activity: Activity | null;
}

interface Live {
  /** Runs the agent's process; kept across resumes with its scrollback and attached clients. */
  transport: SessionTransport;
  exitCode: number | null;
  activity: Activity;
  /** Authenticates hook callbacks from this process; new for every spawn. */
  hookToken: string | null;
  /** When the agent last sent a hook of its own (not the ready marker's stand-in); null until then. */
  lastHookAt: number | null;
  /** The backend's memory between hook callbacks of this process. */
  hookState: HookState;
  /** Polls the agent's transcript for the end of a turn while no hook has come (see watchTranscript). */
  transcriptTimer: NodeJS.Timeout | null;
}

export interface SessionManagerOptions {
  /** Replaces Claude's command (tests). */
  launcher?: Launcher;
  /** Replaces an agent's command (tests). */
  launchers?: Partial<Record<Agent, Launcher>>;
  scrollbackLimit?: number;
  /** Base URL the hook commands post to, e.g. http://127.0.0.1:8790/hook; null before listen(). */
  hookUrl?: () => string | null;
  /** Extra environment for sessions of a repo (TaskPilot's env store, e.g. MCP secrets). */
  extraEnv?: (repo: string) => Promise<Record<string, string>>;
  /** How often the transcript of a session without hooks is read (default 2 s). */
  transcriptPollMs?: number;
  /** How long a transcript must stay quiet after a turn's end before TaskPilot takes it as Stop (default 15 s). */
  transcriptIdleMs?: number;
}

export interface SessionEvents {
  /** Status or activity changed; for UI refresh. */
  change: [meta: SessionMeta];
  hook: [meta: SessionMeta, event: HookEvent, payload: Record<string, unknown>];
  /** Input of the session's status line (plan usage, cost). */
  statusline: [meta: SessionMeta, payload: Record<string, unknown>];
  exit: [meta: SessionMeta];
  /** Something went wrong that does not stop the session, e.g. writing an agent's hook file. */
  warning: [error: unknown];
}

export class SessionManager extends EventEmitter<SessionEvents> {
  private readonly live = new Map<string, Live>();
  private readonly byHookToken = new Map<string, string>();
  private readonly launchers: Partial<Record<Agent, Launcher>>;
  private readonly scrollbackLimit: number;
  private readonly hookUrl: () => string | null;
  private readonly extraEnv: (repo: string) => Promise<Record<string, string>>;
  private readonly transcriptPollMs: number;
  private readonly transcriptIdleMs: number;

  constructor(
    private readonly state: StateStore,
    opts: SessionManagerOptions = {},
  ) {
    super();
    this.launchers = { ...(opts.launcher ? { claude: opts.launcher } : {}), ...opts.launchers };
    this.scrollbackLimit = opts.scrollbackLimit ?? 2_000_000;
    this.hookUrl = opts.hookUrl ?? (() => null);
    this.extraEnv = opts.extraEnv ?? (async () => ({}));
    this.transcriptPollMs = opts.transcriptPollMs ?? 2000;
    this.transcriptIdleMs = opts.transcriptIdleMs ?? 15_000;
  }

  async list(repo: string, taskKey: string): Promise<SessionView[]> {
    const { sessions } = await this.state.load();
    return sessions
      .filter((s) => s.repo === repo && s.taskKey === taskKey)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => this.view(s));
  }

  async get(id: string): Promise<SessionView> {
    return this.view(await this.find(id));
  }

  async create(repo: string, taskKey: string, opts: { permissionMode?: string; agent?: Agent; title?: string; model?: string; subagent?: string } = {}): Promise<SessionView> {
    const count = (await this.list(repo, taskKey)).length;
    const meta: SessionMeta = {
      id: randomUUID(),
      repo,
      taskKey,
      title: opts.title ?? `Session ${count + 1}`,
      createdAt: Date.now(),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(opts.agent && opts.agent !== DEFAULT_AGENT ? { agent: opts.agent } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.subagent ? { subagent: opts.subagent } : {}),
    };
    await this.state.update((s) => void s.sessions.push(meta));
    await this.spawn(meta, false);
    return this.view(meta);
  }

  async resume(id: string): Promise<SessionView> {
    const meta = await this.find(id);
    if (this.isRunning(id)) throw new HttpError(409, "Session is already running");
    await this.spawn(meta, true);
    return this.view(meta);
  }

  async stop(id: string): Promise<void> {
    await this.find(id);
    this.live.get(id)?.transport.stop();
  }

  /** Removes the session from the task. The agent's own transcript is left untouched. */
  async forget(id: string): Promise<void> {
    const meta = await this.find(id);
    if (this.isRunning(id)) throw new HttpError(409, "Stop the session first");
    this.live.get(id)?.transport.closeClients(4410, "Session removed");
    this.live.delete(id);
    await this.state.update((s) => {
      s.sessions = s.sessions.filter((x) => x.id !== id);
    });
    this.emit("change", meta);
  }

  /** Types a prompt into the session as one bracketed paste, then submits it. */
  paste(id: string, text: string): void {
    const transport = this.live.get(id)?.transport;
    if (!transport?.running) throw new HttpError(409, "Session is not running");
    transport.paste(text);
    this.watchTranscript(id, Date.now());
  }

  /**
   * Agents whose Stop hook can fail to arrive (Copilot, TPL-017) have a transcript that shows the end
   * of a turn. While the process has sent no hook at all, that end is applied as a Stop of
   * its own so a run does not wait forever; the first real hook cancels the watch.
   */
  private watchTranscript(id: string, since: number): void {
    const live = this.live.get(id);
    if (!live) return;
    clearInterval(live.transcriptTimer ?? undefined);
    live.transcriptTimer = null;
    void this.find(id)
      .then((meta) => {
        const backend = backendOf(meta.agent);
        if (!backend.finishedTurn || live.lastHookAt !== null) return;
        this.stopWatching(live);
        let busy = false;
        const timer = setInterval(() => {
          if (busy) return;
          busy = true;
          void this.pollTranscript(meta, live, backend.finishedTurn!, since)
            .catch((e: unknown) => this.emit("warning", e))
            .finally(() => (busy = false));
        }, this.transcriptPollMs);
        timer.unref();
        live.transcriptTimer = timer;
      })
      .catch((e: unknown) => this.emit("warning", e));
  }

  private async pollTranscript(meta: SessionMeta, live: Live, finishedTurn: NonNullable<AgentBackend["finishedTurn"]>, since: number): Promise<void> {
    if (!live.transport.running || live.lastHookAt !== null) return this.stopWatching(live);
    if (live.activity === "permission") return;
    const payload = await finishedTurn(meta.id, since, this.transcriptIdleMs);
    // A hook, an exit or a new prompt may have come while the file was read.
    if (!payload || !live.transport.running || live.lastHookAt !== null || !live.transcriptTimer) return;
    this.stopWatching(live);
    this.apply(meta, live, "Stop", payload);
  }

  private stopWatching(live: Live): void {
    clearInterval(live.transcriptTimer ?? undefined);
    live.transcriptTimer = null;
  }

  /** Applies a hook callback. Returns false when the token does not belong to a live session. */
  async handleHook(token: string, event: HookEvent, raw: Record<string, unknown>): Promise<boolean> {
    const id = this.byHookToken.get(token);
    const live = id ? this.live.get(id) : undefined;
    if (!id || !live) return false;
    live.lastHookAt = Date.now();
    this.stopWatching(live);
    const meta = await this.find(id);
    const backend = backendOf(meta.agent);
    const payload = backend.normalize ? await backend.normalize(event, raw, live.hookState) : raw;
    if (payload && typeof payload.session_id === "string" && payload.session_id !== id) return false;
    if (!payload) return true;
    if (backend.permissionGraceMs) this.graced(meta, live, event, payload, backend.permissionGraceMs);
    else this.apply(meta, live, event, payload);
    return true;
  }

  /**
   * For agents whose PermissionRequest also fires for tools they then allow on their own: the
   * request is held back and dropped when the tool finishes within `graceMs` (hooks can also arrive
   * in the other order, so a tool that just finished drops it at once).
   */
  private graced(meta: SessionMeta, live: Live, event: HookEvent, payload: Record<string, unknown>, graceMs: number): void {
    const { finishedAt, heldPermissions: held } = live.hookState;
    const tool = toolCallKey(payload);
    if (event === "PermissionRequest") {
      if (Date.now() - (finishedAt.get(tool) ?? 0) < graceMs) return;
      clearTimeout(held.get(tool));
      held.set(
        tool,
        setTimeout(() => {
          held.delete(tool);
          if (live.transport.running) this.apply(meta, live, event, payload);
        }, graceMs),
      );
      return;
    }
    if (event === "PostToolUse" || event === "PostToolUseFailure") {
      finishedAt.set(tool, Date.now());
      clearTimeout(held.get(tool));
      held.delete(tool);
    } else if (event === "Stop") {
      for (const timer of held.values()) clearTimeout(timer);
      held.clear();
    }
    this.apply(meta, live, event, payload);
  }

  private apply(meta: SessionMeta, live: Live, event: HookEvent, payload: Record<string, unknown>): void {
    const activity = nextActivity(event);
    if (activity !== live.activity) {
      live.activity = activity;
      this.emit("change", meta);
    }
    this.emit("hook", meta, event, payload);
  }

  /** Whether the running process of this session has sent a hook of its own yet. */
  hookSeen(id: string): boolean {
    return this.live.get(id)?.lastHookAt != null;
  }

  /** Applies a status line callback; same token check as hooks. */
  async handleStatusLine(token: string, payload: Record<string, unknown>): Promise<boolean> {
    const id = this.byHookToken.get(token);
    if (!id || !this.live.has(id)) return false;
    if (typeof payload.session_id === "string" && payload.session_id !== id) return false;
    this.emit("statusline", await this.find(id), payload);
    return true;
  }

  /**
   * Streams a session to a WebSocket. Scrollback is replayed after the client's first resize
   * frame, so it is rendered at the client's terminal size.
   */
  async attach(id: string, ws: WebSocket): Promise<void> {
    // Listeners first: the client sends its resize frame right after the socket opens.
    attachPty(ws, (create) => this.terminal(id, create));
    const known = (await this.state.load()).sessions.some((s) => s.id === id);
    if (!known) ws.close(4404, "Unknown session");
  }

  closeAll(): void {
    for (const live of this.live.values()) {
      live.transport.stop();
      live.transport.closeClients(1001, "Server shutting down");
    }
  }

  /** The session's PTY transport; `create` makes the live entry when missing. */
  private terminal(id: string, create: boolean): PtyTransport | undefined {
    // A session from an earlier server run has no live entry; create one so this client
    // also receives the output of a later resume.
    let live = this.live.get(id);
    if (!live && create) {
      live = this.emptyLive();
      this.live.set(id, live);
    }
    return live?.transport instanceof PtyTransport ? live.transport : undefined;
  }

  private async spawn(meta: SessionMeta, resume: boolean): Promise<void> {
    const hookToken = randomBytes(24).toString("base64url");
    const hookUrl = this.hookUrl();
    const extra = await this.extraEnv(meta.repo);
    const backend = backendOf(meta.agent);
    // Without its hooks the session still runs; the run then waits and can be retried by hand.
    await backend.prepare?.(meta.repo).catch((e: unknown) => this.emit("warning", e));
    const launcher = this.launchers[meta.agent ?? DEFAULT_AGENT] ?? backend.launcher;
    // On resume, keep the previous run's transport (scrollback, attached clients).
    const live: Live = {
      ...(this.live.get(meta.id) ?? this.emptyLive()),
      exitCode: null,
      activity: "starting",
      hookToken,
      lastHookAt: null,
      hookState: emptyHookState(),
      transcriptTimer: null,
    };
    live.transport.start(
      { meta, resume, backend, launcher, extraEnv: extra, hookEnv: hookUrl ? { TASKPILOT_HOOK_URL: hookUrl, TASKPILOT_HOOK_TOKEN: hookToken } : {} },
      {
        hook: (event, payload) => this.apply(meta, live, event, payload),
        exit: (exitCode) => {
          this.stopWatching(live);
          for (const timer of live.hookState.heldPermissions.values()) clearTimeout(timer);
          live.exitCode = exitCode;
          this.byHookToken.delete(hookToken);
          live.hookToken = null;
          this.emit("exit", meta);
          this.emit("change", meta);
        },
      },
    );
    this.live.set(meta.id, live);
    this.byHookToken.set(hookToken, meta.id);
    this.emit("change", meta);
  }

  private async find(id: string): Promise<SessionMeta> {
    const meta = (await this.state.load()).sessions.find((s) => s.id === id);
    if (!meta) throw new HttpError(404, `Session not found: ${id}`);
    return meta;
  }

  private isRunning(id: string): boolean {
    return this.live.get(id)?.transport.running === true;
  }

  private emptyLive(): Live {
    return {
      transport: new PtyTransport(this.scrollbackLimit),
      exitCode: null,
      activity: "starting",
      hookToken: null,
      lastHookAt: null,
      hookState: emptyHookState(),
      transcriptTimer: null,
    };
  }

  private view(meta: SessionMeta): SessionView {
    const live = this.live.get(meta.id);
    return {
      ...meta,
      agent: meta.agent ?? DEFAULT_AGENT,
      status: live?.transport.running ? "running" : "exited",
      exitCode: live?.exitCode ?? null,
      activity: live?.transport.running ? live.activity : null,
    };
  }
}

/** Tool name and what it acts on: tells two calls of the same tool apart (inputs differ in extras like `description`). */
function toolCallKey(payload: Record<string, unknown>): string {
  const input = typeof payload.tool_input === "object" && payload.tool_input !== null ? (payload.tool_input as Record<string, unknown>) : {};
  const subject = ["command", "file_path", "path", "url", "query", "pattern"].map((k) => input[k]).find((v) => typeof v === "string");
  return `${typeof payload.tool_name === "string" ? payload.tool_name : ""}\0${subject ?? ""}`;
}

function emptyHookState(): HookState {
  return { openTools: new Map(), nextToolId: 1, finishedAt: new Map(), heldPermissions: new Map() };
}
