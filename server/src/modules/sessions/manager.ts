import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
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
import { RpcTransport } from "./transports/rpc.js";
import { codexHttpError } from "./transports/codex-errors.js";
import type { SessionMetrics, SessionTransport } from "./transports/types.js";
import { preflightSession, sessionCapabilities, type PreflightRequest } from "./capabilities.js";
import type { BackendProbeContext } from "./backends/types.js";
import { unknownFailure, type SessionFailure } from "./failure.js";
import type { CodexUsageFields } from "../../core/codex/usage.js";
import type { AccountQuotaEvidence } from "../usage/index.js";

export type SessionStatus = "running" | "exited";

export interface SessionView extends SessionMeta {
  transport: "pty" | "rpc";
  agent: Agent;
  status: SessionStatus;
  exitCode: number | null;
  /** null while the session is not running. */
  activity: Activity | null;
  failure?: SessionFailure;
  accountQuota?: AccountQuotaEvidence;
}

export interface SessionCreateOptions {
  permissionMode?: string;
  agent?: Agent;
  title?: string;
  model?: string;
  subagent?: string;
  /** Creates a locked target; only release after the workflow has committed the lane. */
  operationId?: string;
  /** Runs after the id is durable, before any process. Rejection prevents spawn. */
  beforeSpawn?: (session: SessionView) => Promise<void>;
}

export interface SessionWaitOptions {
  timeoutMs?: number;
}

interface Live {
  failure?: SessionFailure;
  generation?: number;
  started: Signal;
  ready: Signal;
  exited: Signal;
  stopping: boolean;
  startupError?: unknown;
  owner?: SessionMeta["processOwner"];
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
  /** Total deadline for each read-only capability probe (default 5 s). */
  preflightTimeoutMs?: number;
  accountQuota?: (agent: Agent) => Promise<AccountQuotaEvidence | null>;
}

export interface SessionEvents {
  metrics: [meta: SessionMeta, data: SessionMetrics];
  /** Codex account rate limits, from the session's own app-server. */
  rateLimits: [meta: SessionMeta, data: CodexUsageFields];
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
  private readonly controls = new Map<string, SessionMeta>();
  private readonly launching = new Set<string>();
  private readonly stopBarriers = new Map<string, Promise<void>>();
  private readonly pendingLaunches = new Map<string, Signal>();
  private readonly cancelledLaunches = new Set<string>();
  private closing = false;
  private readonly changing = new Set<string>();
  private readonly byHookToken = new Map<string, string>();
  private readonly launchers: Partial<Record<Agent, Launcher>>;
  private readonly scrollbackLimit: number;
  private readonly hookUrl: () => string | null;
  private readonly extraEnv: (repo: string) => Promise<Record<string, string>>;
  private readonly transcriptPollMs: number;
  private readonly transcriptIdleMs: number;
  private readonly preflightTimeoutMs: number;
  private readonly accountQuota: NonNullable<SessionManagerOptions["accountQuota"]>;

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
    this.preflightTimeoutMs = opts.preflightTimeoutMs ?? 5000;
    this.accountQuota = opts.accountQuota ?? (async () => null);
  }

  async capabilities(repo: string) {
    const result = await sessionCapabilities((request) => this.probeContext(repo, request));
    for (const capability of result.agents) {
      if (capability.agent === "codex") capability.quotaDetection = { status: "supported", source: "adapter" };
    }
    return result;
  }

  async preflight(repo: string, request: PreflightRequest) {
    const result = await preflightSession(request, (configuration) => this.probeContext(repo, configuration));
    if (request.agent === "codex") result.capability.quotaDetection = { status: "supported", source: "adapter" };
    return result;
  }

  private async probeContext(repo: string, request: PreflightRequest): Promise<BackendProbeContext> {
    const backend = backendOf(request.agent);
    const launcher = this.launchers[request.agent] ?? backend.launcher;
    return {
      repo,
      command: launcher("preflight", { resume: false, settings: backend.launchSettings?.(), permissionMode: request.permissionMode, model: request.model, subagent: request.subagent }),
      extraEnv: await this.extraEnv(repo),
      timeoutMs: this.preflightTimeoutMs,
    };
  }

  async list(repo: string, taskKey: string): Promise<SessionView[]> {
    const { sessions } = await this.state.load();
    return Promise.all(
      sessions
        .filter((s) => s.repo === repo && s.taskKey === taskKey)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((s) => this.evidenceView(s)),
    );
  }

  async get(id: string): Promise<SessionView> {
    return this.evidenceView(await this.find(id));
  }

  async create(repo: string, taskKey: string, opts: SessionCreateOptions = {}): Promise<SessionView> {
    if (this.closing) throw new HttpError(409, "Session manager is closing");
    if (opts.operationId && process.platform === "win32") throw new HttpError(409, "Session transfer requires verifiable process groups");
    const count = (await this.list(repo, taskKey)).length;
    const meta: SessionMeta = {
      id: randomUUID(),
      repo,
      taskKey,
      title: opts.title ?? `Session ${count + 1}`,
      createdAt: Date.now(),
      ...(opts.operationId ? { reservation: { operationId: opts.operationId, role: "target" as const, at: Date.now() } } : {}),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(opts.agent && opts.agent !== DEFAULT_AGENT ? { agent: opts.agent } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.subagent ? { subagent: opts.subagent } : {}),
    };
    this.launching.add(meta.id);
    const pending = signal();
    this.pendingLaunches.set(meta.id, pending);
    try {
      await this.state.update((s) => void s.sessions.push(meta));
      this.controls.set(meta.id, meta);
      // A journal failure leaves a discoverable, locked target with no process.
      await opts.beforeSpawn?.(this.view(meta));
      await this.spawn(meta, false);
      return this.get(meta.id);
    } finally {
      this.launching.delete(meta.id);
      this.pendingLaunches.delete(meta.id);
      pending.resolve();
    }
  }

  async resume(id: string): Promise<SessionView> {
    if (this.closing) throw new HttpError(409, "Session manager is closing");
    if (this.launching.has(id) || this.changing.has(id) || this.stopBarriers.has(id)) throw new HttpError(409, "Session lifecycle is busy");
    this.launching.add(id);
    this.cancelledLaunches.delete(id);
    const pending = signal();
    try {
      const meta = await this.find(id);
      this.assertAvailable(meta);
      if (this.isRunning(id)) throw new HttpError(409, "Session is already running");
      // A restart must never turn an unverified owner into a second writer.
      await this.waitForExit(id);
      this.pendingLaunches.set(id, pending);
      await this.spawn(meta, true);
      return this.get(id);
    } finally {
      this.launching.delete(id);
      this.pendingLaunches.delete(id);
      pending.resolve();
    }
  }

  async reserve(id: string, operationId: string, role: "source" | "target" = "source"): Promise<SessionView> {
    if (!operationId) throw new HttpError(400, "Operation id is required");
    if (process.platform === "win32") throw new HttpError(409, "Session transfer requires verifiable process groups");
    return this.changeControl(id, (meta) => {
      if (meta.retired) throw new HttpError(409, "Session has been retired");
      if (meta.reservation && (meta.reservation.operationId !== operationId || meta.reservation.role !== role)) throw new HttpError(409, "Session is reserved by another operation");
      meta.reservation ??= { operationId, role, at: Date.now() };
    });
  }

  /** Deliberate unlock. Rollback callers should use rollback() to first prove the target exited. */
  async release(id: string, operationId: string): Promise<SessionView> {
    return this.changeControl(id, (meta) => {
      this.requireReservation(meta, operationId);
      delete meta.reservation;
    });
  }

  async retire(id: string, operationId: string, replacedBy: string): Promise<SessionView> {
    const current = await this.find(id);
    if (current.retired?.operationId === operationId && current.retired.replacedBy === replacedBy) return this.view(current);
    const replacement = await this.find(replacedBy);
    if (replacement.reservation?.operationId !== operationId) throw new HttpError(409, "Replacement reservation does not match");
    await this.waitForExit(id);
    return this.changeControl(id, (meta) => {
      this.requireReservation(meta, operationId);
      if (meta.id === replacedBy || meta.repo !== replacement.repo || meta.taskKey !== replacement.taskKey) throw new HttpError(409, "Replacement belongs to a different task");
      meta.retired = { operationId, replacedBy, at: Date.now() };
      delete meta.reservation;
    });
  }

  /** No resume or prompt: the workflow decides the next action after this barrier. */
  async rollback(sourceId: string, targetId: string, operationId: string, opts: SessionWaitOptions = {}): Promise<void> {
    const source = await this.find(sourceId);
    const target = await this.find(targetId);
    this.requireReservation(source, operationId);
    this.requireReservation(target, operationId);
    if (source.reservation?.role !== "source" || target.reservation?.role !== "target" || source.repo !== target.repo || source.taskKey !== target.taskKey)
      throw new HttpError(409, "Invalid rollback pair");
    await this.stopAndWait(targetId, opts);
    await this.retire(targetId, operationId, sourceId);
    await this.release(sourceId, operationId);
  }

  async stop(id: string): Promise<void> {
    await this.find(id);
    if (this.launching.has(id)) this.cancelledLaunches.add(id);
    const live = this.live.get(id);
    if (live) {
      live.stopping = true;
      this.stopWatching(live);
      for (const timer of live.hookState.heldPermissions.values()) clearTimeout(timer);
      live.hookState.heldPermissions.clear();
      if (live.hookToken) this.byHookToken.delete(live.hookToken);
      live.hookToken = null;
      live.transport.stop();
    }
  }

  async stopAndWait(id: string, opts: SessionWaitOptions = {}): Promise<void> {
    const current = this.stopBarriers.get(id);
    if (current) return current;
    const barrier = (async () => {
      await this.stop(id);
      await this.waitForExit(id, { ...opts, terminate: true });
    })();
    this.stopBarriers.set(id, barrier);
    try {
      await barrier;
    } finally {
      if (this.stopBarriers.get(id) === barrier) this.stopBarriers.delete(id);
    }
  }

  /** Direct transport barrier: never depends on an engine event queued behind the caller. */
  async waitForReady(id: string, opts: SessionWaitOptions = {}): Promise<SessionView> {
    await this.find(id);
    const live = this.live.get(id);
    if (!live) throw new HttpError(409, "Session has no process");
    await deadline(
      Promise.race([
        Promise.all([live.started.promise, live.ready.promise]),
        live.exited.promise.then(() => {
          throw new HttpError(409, "Session exited before ready");
        }),
      ]),
      opts.timeoutMs ?? 30_000,
      "Session did not become ready",
    );
    if (live.startupError) throw live.startupError;
    if (live.stopping || this.live.get(id) !== live || !live.transport.running) throw new HttpError(409, "Session is no longer ready");
    const view = await this.get(id);
    if (this.live.get(id) !== live || live.stopping || !live.transport.running) throw new HttpError(409, "Session is no longer ready");
    return view;
  }

  /** Also works after restart. Unknown ownership fails closed and never signals an unrelated PID. */
  async waitForExit(id: string, opts: SessionWaitOptions & { terminate?: boolean } = {}): Promise<void> {
    const meta = structuredClone(await this.find(id));
    const until = Date.now() + (opts.timeoutMs ?? 5000);
    const pending = this.pendingLaunches.get(id);
    if (pending) await deadline(pending.promise, Math.max(1, until - Date.now()), "Session startup did not stop");
    const live = this.live.get(id);
    if (live) await deadline(live.exited.promise, Math.max(1, until - Date.now()), "Session did not exit");
    const owner = live?.owner ?? meta.processOwner;
    if (process.platform !== "linux" && !live?.generation && !owner && meta.generation && meta.exitedGeneration !== meta.generation)
      throw new HttpError(409, "Cannot verify session process ownership");
    if (owner) await waitOwnedProcess(owner, until, opts.terminate === true);
    const generationToCheck = live?.generation ?? meta.generation;
    // A tool can leave the original group. Its inherited marker still proves ownership.
    if (generationToCheck) {
      for (;;) {
        const discovered = await discoverOwnedProcesses(this.ownerMarker(id), generationToCheck);
        if (!discovered.length) break;
        for (const candidate of discovered) await waitOwnedProcess(candidate, until, opts.terminate === true);
      }
    }
    const generation = owner?.generation ?? live?.generation ?? meta.generation;
    if (generation) {
      await this.state.update((s) => {
        const saved = s.sessions.find((x) => x.id === id);
        if (saved && saved.generation === generation) {
          delete saved.processOwner;
          saved.exitedGeneration = generation;
        }
      });
      if (live?.owner === owner && live) live.owner = undefined;
    }
  }

  /** Recovery intentionally stops a known surviving owner; it never launches a conversation. */
  async recoverProcess(id: string, opts: SessionWaitOptions = {}): Promise<void> {
    await this.stopAndWait(id, opts);
  }

  private ownerMarker(id: string): string {
    return `${this.state.file}:${id}`;
  }

  private assertAvailable(meta: SessionMeta): void {
    if (meta.retired) throw new HttpError(409, "Session has been retired");
    if (meta.reservation) throw new HttpError(409, "Session is reserved for transfer");
  }

  private requireReservation(meta: SessionMeta, operationId: string): void {
    if (!meta.reservation || meta.reservation.operationId !== operationId) throw new HttpError(409, "Session reservation does not match");
  }

  private assertInput(id: string): void {
    const meta = this.controls.get(id);
    if (!meta || this.changing.has(id) || this.launching.has(id) || this.live.get(id)?.stopping) throw new HttpError(409, "Session does not accept input");
    this.assertAvailable(meta);
  }

  private async changeControl(id: string, change: (meta: SessionMeta) => void): Promise<SessionView> {
    if (this.changing.has(id) || this.launching.has(id)) throw new HttpError(409, "Session lifecycle is busy");
    this.changing.add(id);
    try {
      await this.state.update((s) => {
        const index = s.sessions.findIndex((x) => x.id === id);
        if (index < 0) throw new HttpError(404, `Session not found: ${id}`);
        const meta = structuredClone(s.sessions[index]);
        change(meta);
        s.sessions[index] = meta;
      });
      const meta = await this.find(id);
      this.emit("change", meta);
      return this.view(meta);
    } catch (error) {
      // Concurrent reads can observe a pending write; restore the durable control state on failure.
      await this.find(id).catch(() => undefined);
      throw error;
    } finally {
      this.changing.delete(id);
    }
  }

  /** Removes the session from the task. The agent's own transcript is left untouched. */
  async forget(id: string): Promise<void> {
    if (this.launching.has(id) || this.changing.has(id)) throw new HttpError(409, "Session lifecycle is busy");
    this.changing.add(id);
    try {
      const meta = await this.find(id);
      this.assertAvailable(meta);
      if (this.isRunning(id)) throw new HttpError(409, "Stop the session first");
      await this.waitForExit(id);
      await this.state.update((s) => {
        s.sessions = s.sessions.filter((x) => x.id !== id);
      });
      this.live.get(id)?.transport.closeClients(4410, "Session removed");
      this.live.delete(id);
      this.controls.delete(id);
      this.cancelledLaunches.delete(id);
      this.emit("change", meta);
    } finally {
      this.changing.delete(id);
    }
  }

  /** Submits a prompt through the session's PTY or RPC transport. */
  paste(id: string, text: string): void {
    this.assertInput(id);
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
        if (!backend.finishedTurn || live.lastHookAt !== null || live.stopping || this.live.get(id) !== live) return;
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
    if (!live.transport.running || live.stopping || live.lastHookAt !== null) return this.stopWatching(live);
    if (live.activity === "permission") return;
    const payload = await finishedTurn(meta.id, since, this.transcriptIdleMs);
    // A hook, an exit or a new prompt may have come while the file was read.
    if (!payload || !live.transport.running || live.stopping || live.lastHookAt !== null || !live.transcriptTimer) return;
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
    if (!id || !live || live.stopping) return false;
    live.lastHookAt = Date.now();
    this.stopWatching(live);
    const meta = await this.find(id);
    const backend = backendOf(meta.agent);
    const payload = backend.normalize ? await backend.normalize(event, raw, live.hookState) : raw;
    if (this.live.get(id) !== live || live.stopping || !live.transport.running || live.hookToken !== token) return false;
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
    if (this.live.get(meta.id) !== live || live.stopping) return;
    if (event === "UserPromptSubmit") {
      live.failure = undefined;
      this.emit("change", meta);
    }
    if (event === "Stop" && payload.failed === true && !live.failure) {
      live.failure = { ...unknownFailure(), generation: meta.generation };
      this.emit("change", meta);
    }
    if (event === "SessionStart") live.ready.resolve();
    const activity = live.transport instanceof RpcTransport && live.transport.awaitingApproval ? "permission" : nextActivity(event);
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
    const live = this.live.get(id);
    const meta = await this.find(id);
    if (!live || live.stopping || this.live.get(id) !== live || live.hookToken !== token) return false;
    this.emit("statusline", meta, payload);
    return true;
  }

  /**
   * Streams a session to a WebSocket. Scrollback is replayed after the client's first resize
   * frame, so it is rendered at the client's terminal size.
   */
  async attach(id: string, ws: WebSocket): Promise<void> {
    // Listeners first: the client sends its resize frame right after the socket opens.
    attachPty(
      ws,
      (create) => this.terminal(id, create),
      () => {
        try {
          this.assertInput(id);
          return true;
        } catch {
          return false;
        }
      },
    );
    const meta = (await this.state.load()).sessions.find((s) => s.id === id);
    if (meta) this.controls.set(id, meta);
    const known = !!meta;
    if (!known) ws.close(4404, "Unknown session");
    else if ((await this.find(id)).agent === "codex") {
      ws.close(4409, "Use the conversation socket");
      const live = this.live.get(id);
      if (live?.transport instanceof PtyTransport && !live.transport.running) this.live.delete(id);
    }
  }

  async attachConversation(id: string, ws: WebSocket): Promise<void> {
    try {
      const meta = await this.find(id);
      if (backendOf(meta.agent).transport !== "rpc") {
        ws.close(4409, "Session uses PTY");
        return;
      }
      let live = this.live.get(id);
      if (!live) {
        live = this.emptyLive(meta.agent);
        this.live.set(id, live);
      }
      if (ws.readyState === 1) (live.transport as RpcTransport).attach(ws);
    } catch {
      ws.close(4404, "Unknown session");
    }
  }

  async interrupt(id: string): Promise<void> {
    const transport = await this.rpc(id);
    this.assertInput(id);
    await transport.interrupt();
  }

  async answer(id: string, requestId: string, decision: "accept" | "decline"): Promise<void> {
    const transport = await this.rpc(id);
    this.assertInput(id);
    transport.answer(requestId, decision);
    const live = this.live.get(id)!;
    live.activity = transport.awaitingApproval ? "permission" : "busy";
    this.emit("change", await this.find(id));
  }

  private async rpc(id: string): Promise<RpcTransport> {
    await this.find(id);
    this.assertInput(id);
    const transport = this.live.get(id)?.transport;
    if (!(transport instanceof RpcTransport) || !transport.running) throw new HttpError(409, "Session has no running RPC transport");
    return transport;
  }

  closeAll(): void {
    this.closing = true;
    for (const id of this.launching) this.cancelledLaunches.add(id);
    for (const live of this.live.values()) {
      live.stopping = true;
      this.stopWatching(live);
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

  private async spawn(savedMeta: SessionMeta, resume: boolean): Promise<void> {
    // Event consumers may queue this metadata past the next resume: keep its generation immutable.
    const meta = structuredClone(savedMeta);
    if (this.closing || this.cancelledLaunches.has(meta.id)) throw new HttpError(409, "Session startup was stopped");
    const hookToken = randomBytes(24).toString("base64url");
    const backend = backendOf(meta.agent);
    const previous = this.live.get(meta.id) ?? this.emptyLive(meta.agent);
    const live: Live = {
      ...previous,
      started: signal(),
      ready: signal(),
      exited: signal(),
      stopping: false,
      startupError: undefined,
      failure: undefined,
      owner: undefined,
      exitCode: null,
      activity: "starting",
      hookToken,
      lastHookAt: null,
      hookState: emptyHookState(),
      transcriptTimer: null,
    };
    this.live.set(meta.id, live);
    this.byHookToken.set(hookToken, meta.id);
    try {
      await this.state.update((s) => {
        const saved = s.sessions.find((x) => x.id === meta.id)!;
        saved.generation = (saved.generation ?? 0) + 1;
        meta.generation = saved.generation;
      });
      live.generation = meta.generation;
      const extra = await this.extraEnv(meta.repo);
      await backend.prepare?.(meta.repo).catch((e: unknown) => this.emit("warning", e));
      if (live.stopping) throw new HttpError(409, "Session startup was stopped");
      const launcher = this.launchers[meta.agent ?? DEFAULT_AGENT] ?? backend.launcher;
      const hookUrl = this.hookUrl();
      // Recover even the crash window between OS spawn and persisting its PID.
      const ownerMarker = this.ownerMarker(meta.id);
      await live.transport.start(
        {
          meta,
          resume,
          backend,
          launcher,
          extraEnv: extra,
          hookEnv: {
            TASKPILOT_PROCESS_OWNER: ownerMarker,
            TASKPILOT_PROCESS_GENERATION: String(meta.generation),
            ...(hookUrl ? { TASKPILOT_HOOK_URL: hookUrl, TASKPILOT_HOOK_TOKEN: hookToken } : {}),
          },
        },
        {
          process: async (pid, groupId) => {
            const owner = { pid, ...(groupId ? { groupId } : {}), startedAt: Date.now(), generation: meta.generation!, identity: await processIdentity(pid) };
            live.owner = owner;
            await this.state.update((s) => {
              const saved = s.sessions.find((x) => x.id === meta.id);
              if (!saved || saved.generation !== meta.generation) throw new HttpError(409, "Session generation changed");
              saved.processOwner = owner;
            });
          },
          ready: () => {
            if (!live.stopping) live.ready.resolve();
          },
          hook: (event, payload) => {
            if (backend.transport === "rpc") live.lastHookAt = Date.now();
            this.apply(meta, live, event, payload);
          },
          nativeId: async (nativeId, model) => {
            if (this.live.get(meta.id) !== live || live.stopping) throw new HttpError(409, "Session startup was stopped");
            await this.state.update((s) => {
              const saved = s.sessions.find((x) => x.id === meta.id);
              if (!saved || saved.generation !== meta.generation) throw new HttpError(409, "Session generation changed");
              saved.nativeId = nativeId;
              if (!saved.model && model) saved.model = model;
            });
            meta.nativeId = nativeId;
            if (!meta.model && model) meta.model = model;
          },
          metrics: (data) => {
            if (this.live.get(meta.id) === live && !live.stopping) this.emit("metrics", meta, data);
          },
          rateLimits: (data) => {
            if (this.live.get(meta.id) === live && !live.stopping) this.emit("rateLimits", meta, data);
          },
          failure: (data) => {
            if (this.live.get(meta.id) !== live || live.stopping) return;
            live.failure = { ...data, generation: meta.generation };
            this.emit("change", meta);
          },
          exit: (exitCode) => {
            // Resolve before emitting: listeners enqueue engine work but are never part of this barrier.
            live.exited.resolve();
            if (this.live.get(meta.id) !== live) return;
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
    } catch (error) {
      live.startupError = error;
      this.byHookToken.delete(hookToken);
      live.hookToken = null;
      if (!live.transport.running) live.exited.resolve();
      this.emit("change", meta);
      throw backend.transport === "rpc" && !(error instanceof HttpError) ? codexHttpError(error) : error;
    } finally {
      live.started.resolve();
    }
    this.emit("change", meta);
  }

  private async find(id: string): Promise<SessionMeta> {
    const meta = (await this.state.load()).sessions.find((s) => s.id === id);
    if (!meta) throw new HttpError(404, `Session not found: ${id}`);
    this.controls.set(id, meta);
    return meta;
  }

  private isRunning(id: string): boolean {
    const live = this.live.get(id);
    return !!live && (!live.started.done || live.transport.running);
  }

  private emptyLive(agent?: Agent): Live {
    const exited = signal();
    exited.resolve();
    const started = signal();
    started.resolve();
    return {
      started,
      ready: signal(),
      exited,
      stopping: false,
      transport: backendOf(agent).transport === "rpc" ? new RpcTransport(this.scrollbackLimit) : new PtyTransport(this.scrollbackLimit),
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
      transport: backendOf(meta.agent).transport ?? "pty",
      status: this.isRunning(meta.id) ? "running" : "exited",
      exitCode: live?.exitCode ?? null,
      activity: live?.transport.running ? live.activity : null,
      ...(live?.failure ? { failure: live.failure } : {}),
    };
  }

  private async evidenceView(meta: SessionMeta): Promise<SessionView> {
    const accountQuota = await this.accountQuota(meta.agent ?? DEFAULT_AGENT);
    return { ...this.view(meta), ...(accountQuota ? { accountQuota } : {}) };
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

interface Signal {
  promise: Promise<void>;
  resolve(): void;
  done: boolean;
}
function signal(): Signal {
  let resolve!: () => void;
  const result: Signal = {
    promise: new Promise<void>((r) => (resolve = r)),
    done: false,
    resolve() {
      result.done = true;
      resolve();
    },
  };
  return result;
}
async function deadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpError(409, message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function processStat(pid: number): Promise<{ state: string; groupId: number; start: string } | undefined> {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    return { state: fields[0], groupId: Number(fields[2]), start: fields[19] };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw error;
  }
}
async function processIdentity(pid: number): Promise<string | undefined> {
  if (process.platform !== "linux") return undefined;
  const stat = await processStat(pid);
  if (!stat) return undefined;
  return `${(await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()}:${stat.start}`;
}
async function ownedAlive(owner: NonNullable<SessionMeta["processOwner"]>): Promise<boolean> {
  if (process.platform === "linux") {
    const entries = owner.groupId ? (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry)).map(Number) : [owner.pid];
    for (const pid of entries) {
      const stat = await processStat(pid);
      if (stat && stat.state !== "Z" && stat.state !== "X" && (!owner.groupId || stat.groupId === owner.groupId)) return true;
    }
    return false;
  }
  try {
    process.kill(owner.groupId ? -owner.groupId : owner.pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
async function waitOwnedProcess(owner: NonNullable<SessionMeta["processOwner"]>, until: number, terminate: boolean): Promise<void> {
  if (!(await ownedAlive(owner))) return;
  if (terminate || process.platform === "linux") {
    const identity = await processIdentity(owner.pid);
    const stat = process.platform === "linux" ? await processStat(owner.pid) : undefined;
    if (stat && owner.groupId && stat.groupId !== owner.groupId) throw new HttpError(409, "Session process group does not match its owner");
    if (!stat && owner.groupId && owner.pid !== owner.groupId && (await processStat(owner.groupId))) throw new HttpError(409, "Cannot verify a reused process group");
    const boot = process.platform === "linux" ? (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() : undefined;
    if (!owner.identity || !boot || !owner.identity.startsWith(`${boot}:`) || (identity && identity !== owner.identity)) throw new HttpError(409, "Cannot verify session process ownership");
    try {
      if (terminate) process.kill(owner.groupId ? -owner.groupId : owner.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  while (await ownedAlive(owner)) {
    if (Date.now() >= until) throw new HttpError(409, "Session process group did not exit");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Find an owned group when the server crashed before saving the spawn callback. */
async function discoverOwnedProcesses(marker: string, generation: number): Promise<Array<NonNullable<SessionMeta["processOwner"]>>> {
  if (process.platform !== "linux") return [];
  const groups = new Map<number, NonNullable<SessionMeta["processOwner"]>>();
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let env: string;
    try {
      env = await readFile(`/proc/${pid}/environ`, "utf8");
    } catch (error) {
      if (["ENOENT", "ESRCH", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
      throw error;
    }
    const variables = env.split("\0");
    if (!variables.includes(`TASKPILOT_PROCESS_OWNER=${marker}`)) continue;
    const childGeneration = Number(variables.find((entry) => entry.startsWith("TASKPILOT_PROCESS_GENERATION="))?.split("=")[1]);
    if (!Number.isInteger(childGeneration) || childGeneration < 1 || childGeneration > generation) continue;
    const stat = await processStat(pid);
    if (!stat || stat.state === "Z" || stat.state === "X") continue;
    if (!groups.has(stat.groupId) || pid === stat.groupId)
      groups.set(stat.groupId, { pid, groupId: stat.groupId, generation: childGeneration, startedAt: Date.now(), identity: await processIdentity(pid) });
  }
  return [...groups.values()];
}
