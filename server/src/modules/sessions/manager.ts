import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import * as pty from "node-pty";
import type { WebSocket } from "ws";
import { HttpError } from "../../core/errors.js";
import type { SessionMeta, StateStore } from "../../core/state.js";
import { nextActivity, type Activity, type HookEvent } from "./hooks.js";
import { childEnv, type Launcher } from "../../core/claude/launch.js";
import { DEFAULT_AGENT, type Agent } from "../../core/agents.js";
import { backendOf, type HookState } from "./backends/index.js";

export type SessionStatus = "running" | "exited";

export interface SessionView extends SessionMeta {
  agent: Agent;
  status: SessionStatus;
  exitCode: number | null;
  /** null while the session is not running. */
  activity: Activity | null;
}

/** Client → server frames on the PTY WebSocket. */
type ClientFrame = { t: "i"; d: string } | { t: "r"; cols: number; rows: number };
/** Server → client frames: output, exit. */
type ServerFrame = { t: "o"; d: string } | { t: "x"; code: number | null };

interface Live {
  proc: pty.IPty | null;
  exitCode: number | null;
  activity: Activity;
  /** Authenticates hook callbacks from this process; new for every spawn. */
  hookToken: string | null;
  /** The backend's memory between hook callbacks of this process. */
  hookState: HookState;
  /** Recent output as plain text, while waiting for the backend's ready marker. */
  pendingOutput: string | null;
  /** Raw PTY output replayed to clients that attach later (page reload, second tab). */
  scrollback: string[];
  scrollbackSize: number;
  clients: Set<WebSocket>;
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

const DEFAULT_SIZE = { cols: 120, rows: 32 };
/** Delay between a bracketed paste and the Enter that submits it (M0 spike used 200–300 ms). */
const SUBMIT_DELAY_MS = 200;
/** Plain-text output kept while looking for a ready marker; the marker is a short footer. */
const PENDING_OUTPUT_CHARS = 8192;

export class SessionManager extends EventEmitter<SessionEvents> {
  private readonly live = new Map<string, Live>();
  private readonly byHookToken = new Map<string, string>();
  private readonly launchers: Partial<Record<Agent, Launcher>>;
  private readonly scrollbackLimit: number;
  private readonly hookUrl: () => string | null;
  private readonly extraEnv: (repo: string) => Promise<Record<string, string>>;

  constructor(
    private readonly state: StateStore,
    opts: SessionManagerOptions = {},
  ) {
    super();
    this.launchers = { ...(opts.launcher ? { claude: opts.launcher } : {}), ...opts.launchers };
    this.scrollbackLimit = opts.scrollbackLimit ?? 2_000_000;
    this.hookUrl = opts.hookUrl ?? (() => null);
    this.extraEnv = opts.extraEnv ?? (async () => ({}));
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

  async create(repo: string, taskKey: string, opts: { permissionMode?: string; agent?: Agent } = {}): Promise<SessionView> {
    const count = (await this.list(repo, taskKey)).length;
    const meta: SessionMeta = {
      id: randomUUID(),
      repo,
      taskKey,
      title: `Session ${count + 1}`,
      createdAt: Date.now(),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(opts.agent && opts.agent !== DEFAULT_AGENT ? { agent: opts.agent } : {}),
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
    this.live.get(id)?.proc?.kill();
  }

  /** Removes the session from the task. The agent's own transcript is left untouched. */
  async forget(id: string): Promise<void> {
    const meta = await this.find(id);
    if (this.isRunning(id)) throw new HttpError(409, "Stop the session first");
    for (const ws of this.live.get(id)?.clients ?? []) ws.close(4410, "Session removed");
    this.live.delete(id);
    await this.state.update((s) => {
      s.sessions = s.sessions.filter((x) => x.id !== id);
    });
    this.emit("change", meta);
  }

  /** Types a prompt into the session as one bracketed paste, then submits it. */
  paste(id: string, text: string): void {
    const proc = this.live.get(id)?.proc;
    if (!proc) throw new HttpError(409, "Session is not running");
    proc.write(`\x1b[200~${text}\x1b[201~`);
    setTimeout(() => this.live.get(id)?.proc?.write("\r"), SUBMIT_DELAY_MS);
  }

  /** Applies a hook callback. Returns false when the token does not belong to a live session. */
  async handleHook(token: string, event: HookEvent, raw: Record<string, unknown>): Promise<boolean> {
    const id = this.byHookToken.get(token);
    const live = id ? this.live.get(id) : undefined;
    if (!id || !live) return false;
    const meta = await this.find(id);
    const normalize = backendOf(meta.agent).normalize;
    const payload = normalize ? await normalize(event, raw, live.hookState) : raw;
    if (payload && typeof payload.session_id === "string" && payload.session_id !== id) return false;
    if (payload) this.apply(meta, live, event, payload);
    return true;
  }

  private apply(meta: SessionMeta, live: Live, event: HookEvent, payload: Record<string, unknown>): void {
    const activity = nextActivity(event);
    if (activity !== live.activity) {
      live.activity = activity;
      this.emit("change", meta);
    }
    this.emit("hook", meta, event, payload);
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
    let attached = false;
    ws.on("message", (raw) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(String(raw)) as ClientFrame;
      } catch {
        return;
      }
      const live = this.live.get(id);
      if (ws.readyState !== ws.OPEN) return;
      if (frame.t === "i" && typeof frame.d === "string") {
        live?.proc?.write(frame.d);
      } else if (frame.t === "r" && validSize(frame.cols, frame.rows)) {
        live?.proc?.resize(frame.cols, frame.rows);
        if (!attached) {
          attached = true;
          this.replay(id, ws);
        }
      }
    });
    ws.on("close", () => this.live.get(id)?.clients.delete(ws));
    const known = (await this.state.load()).sessions.some((s) => s.id === id);
    if (!known) ws.close(4404, "Unknown session");
  }

  closeAll(): void {
    for (const live of this.live.values()) {
      live.proc?.kill();
      for (const ws of live.clients) ws.close(1001, "Server shutting down");
    }
  }

  private replay(id: string, ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) return;
    // A session from an earlier server run has no live entry; create one so this client
    // also receives the output of a later resume.
    let live = this.live.get(id);
    if (!live) {
      live = emptyLive();
      this.live.set(id, live);
    }
    if (live.scrollback.length > 0) send(ws, { t: "o", d: live.scrollback.join("") });
    if (!live.proc) send(ws, { t: "x", code: live.exitCode });
    live.clients.add(ws);
  }

  private async spawn(meta: SessionMeta, resume: boolean): Promise<void> {
    const hookToken = randomBytes(24).toString("base64url");
    const hookUrl = this.hookUrl();
    const extra = await this.extraEnv(meta.repo);
    const backend = backendOf(meta.agent);
    // Without its hooks the session still runs; the run then waits and can be retried by hand.
    await backend.prepare?.(meta.repo).catch((e: unknown) => this.emit("warning", e));
    const launcher = this.launchers[meta.agent ?? DEFAULT_AGENT] ?? backend.launcher;
    const { file, args } = launcher(meta.id, {
      resume,
      settings: backend.launchSettings?.(),
      permissionMode: meta.permissionMode,
    });
    const proc = pty.spawn(file, args, {
      name: "xterm-256color",
      cwd: meta.repo,
      env: childEnv(process.env, { ...extra, ...(hookUrl ? { TASKPILOT_HOOK_URL: hookUrl, TASKPILOT_HOOK_TOKEN: hookToken } : {}) }),
      ...DEFAULT_SIZE,
    });
    // On resume, keep the previous run's scrollback and attached clients.
    const live: Live = {
      ...(this.live.get(meta.id) ?? emptyLive()),
      proc,
      exitCode: null,
      activity: "starting",
      hookToken,
      hookState: emptyHookState(),
      pendingOutput: backend.readyMarker ? "" : null,
    };
    this.live.set(meta.id, live);
    this.byHookToken.set(hookToken, meta.id);

    proc.onData((data) => {
      live.scrollback.push(data);
      live.scrollbackSize += data.length;
      while (live.scrollbackSize > this.scrollbackLimit && live.scrollback.length > 1) {
        live.scrollbackSize -= live.scrollback.shift()!.length;
      }
      for (const ws of live.clients) send(ws, { t: "o", d: data });
      if (live.pendingOutput !== null && backend.readyMarker) {
        live.pendingOutput = (live.pendingOutput + stripAnsi(data)).slice(-PENDING_OUTPUT_CHARS);
        if (live.pendingOutput.includes(backend.readyMarker)) {
          live.pendingOutput = null;
          // Stands in for the SessionStart hook the agent sends only with its first prompt.
          this.apply(meta, live, "SessionStart", { session_id: meta.id, source: resume ? "resume" : "startup" });
        }
      }
    });
    proc.onExit(({ exitCode }) => {
      live.proc = null;
      live.exitCode = exitCode;
      this.byHookToken.delete(hookToken);
      live.hookToken = null;
      for (const ws of live.clients) send(ws, { t: "x", code: exitCode });
      this.emit("exit", meta);
      this.emit("change", meta);
    });
    this.emit("change", meta);
  }

  private async find(id: string): Promise<SessionMeta> {
    const meta = (await this.state.load()).sessions.find((s) => s.id === id);
    if (!meta) throw new HttpError(404, `Session not found: ${id}`);
    return meta;
  }

  private isRunning(id: string): boolean {
    return this.live.get(id)?.proc != null;
  }

  private view(meta: SessionMeta): SessionView {
    const live = this.live.get(meta.id);
    return {
      ...meta,
      agent: meta.agent ?? DEFAULT_AGENT,
      status: live?.proc ? "running" : "exited",
      exitCode: live?.exitCode ?? null,
      activity: live?.proc ? live.activity : null,
    };
  }
}

function emptyLive(): Live {
  return {
    proc: null,
    exitCode: null,
    activity: "starting",
    hookToken: null,
    hookState: emptyHookState(),
    pendingOutput: null,
    scrollback: [],
    scrollbackSize: 0,
    clients: new Set(),
  };
}

function emptyHookState(): HookState {
  return { openTools: new Map(), nextToolId: 1 };
}

/** Terminal output without escape sequences, enough to find a line of text in it. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, "").replace(/\x1b[()][A-Za-z0-9]/g, "");
}

function send(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

function validSize(cols: number, rows: number): boolean {
  const ok = (n: number) => Number.isInteger(n) && n > 0 && n <= 1000;
  return ok(cols) && ok(rows);
}
