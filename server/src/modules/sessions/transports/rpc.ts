import { spawn } from "node:child_process";
import { childEnv, type LaunchSpec } from "../../../core/claude/launch.js";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { CodexError } from "../../../core/codex/errors.js";
import { codexResumeOptions, codexThreadOptions } from "../../../core/codex/launch.js";
import { codexRateLimits, parseCodexRateLimits } from "../../../core/codex/usage.js";
import { listCodexModels } from "../../../core/codex/models.js";
import { codexLoggedIn, initializeCodex, CodexRpc, type CodexProcess, type ServerRequest } from "../../../core/codex/rpc.js";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import type { HookEvent } from "../hooks.js";
import { codexHttpError } from "./codex-errors.js";
import { resolveCodexInput } from "./codex-commands.js";
import { codexStartupFailure, codexTurnFailure, unknownFailure } from "../failure.js";
import type { ConversationItem, SessionTransport, TransportEvents, TransportLaunch } from "./types.js";

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (typeof value === "object" && value !== null ? (value as Obj) : {});
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** One stdio app-server per session. Its conversation buffer survives process resumes, like PTY scrollback. */
export class RpcTransport implements SessionTransport {
  private proc?: CodexProcess;
  private events?: TransportEvents;
  private sessionId = "";
  private threadId?: string;
  private turnId?: string;
  private lastMessage = "";
  private ready = false;
  private submitting = false;
  private starting = false;
  private stopping = false;
  private submittedText = "";
  private cwd?: string;
  /** Set by `/model`; sent with every later turn/start. */
  private model?: string;
  /** Native request ids restart at zero in each process; browser answers must identify the spawn. */
  private approvalPrefix = "";
  private readonly items = new Map<string, ConversationItem>();
  private readonly tools = new Map<string, Obj>();
  private readonly approvals = new Map<string, ServerRequest>();
  private readonly clients = new Set<WebSocket>();

  constructor(private readonly limit = 2_000_000) {}

  get running(): boolean {
    return this.starting || (!!this.proc && this.proc.child.exitCode === null && this.proc.child.signalCode === null);
  }
  get awaitingApproval(): boolean {
    return this.approvals.size > 0;
  }

  async start(launch: TransportLaunch, events: TransportEvents): Promise<void> {
    const { meta, resume } = launch;
    const opts = { cwd: meta.repo, permissionMode: meta.permissionMode, model: meta.model, subagent: meta.subagent };
    // Validate before touching a process or changing live state.
    const params = resume ? codexResumeOptions({ ...opts, threadId: meta.nativeId }) : codexThreadOptions(opts);
    this.events = events;
    this.sessionId = meta.id;
    this.cwd = meta.repo;
    this.model = undefined;
    this.approvalPrefix = randomUUID();
    this.ready = false;
    this.starting = true;
    this.stopping = false;
    this.submitting = false;
    this.turnId = undefined;
    this.threadId = undefined;
    this.lastMessage = "";
    let proc: CodexProcess | undefined;
    try {
      proc = await spawnOwnedCodex(launch.extraEnv, meta.repo, launch.launcher(meta.id, { resume, model: meta.model, permissionMode: meta.permissionMode }), launch.hookEnv);
      this.proc = proc;
      const current = proc;
      proc.rpc.on("notification", (method, params) => {
        if (this.proc === current && !this.stopping) this.notification(method, obj(params));
      });
      proc.rpc.on("request", (request) => {
        if (this.proc === current && !this.stopping) this.request(request);
        else current.rpc.respond(request.id, { decision: "cancel" });
      });
      proc.rpc.once("close", () => {
        if (this.proc === current) this.stop();
      });
      // RPC stdout can close while the process (or a writer child) still runs.
      proc.child.once("exit", (code) => {
        if (this.proc !== current) return;
        this.ready = false;
        this.starting = false;
        this.cancelOpen();
        this.broadcast({ t: "x", code });
        events.exit(code);
      });
      await events.process?.(proc.child.pid!, process.platform === "win32" ? undefined : proc.child.pid);
      if (this.stopping) throw new HttpError(409, "Session startup was stopped");
      await initializeCodex(proc.rpc);
      if (!(await codexLoggedIn(proc.rpc))) throw new CodexError("notLoggedIn", "account/read returned null");
      if (meta.model && !(await listCodexModels(proc.rpc)).some((m) => m.id === meta.model || m.model === meta.model)) {
        throw new CodexError("modelUnknown", meta.model);
      }
      const result = obj(await proc.rpc.request(resume ? "thread/resume" : "thread/start", params));
      const id = str(obj(result.thread).id);
      if (!id || (resume && id !== meta.nativeId)) throw new CodexError("protocol", "thread/start or resume returned an invalid thread id");
      this.threadId = id;
      await events.nativeId?.(id, str(result.model) || undefined);
      if (this.stopping || proc.rpc.isClosed) throw new CodexError("closed", "Codex app-server exited during startup");
      events.metrics?.({ ...(str(result.model) ? { model: str(result.model) } : {}) });
      this.ready = true;
      this.starting = false;
      events.ready?.();
      this.hook("SessionStart", { source: resume ? "resume" : "startup" });
      void this.readRateLimits(current);
    } catch (error) {
      events.failure?.(codexStartupFailure(error));
      this.starting = false;
      this.ready = false;
      this.stopping = true;
      proc?.kill();
      const mapped = codexHttpError(error);
      this.upsert({ id: randomUUID(), kind: "error", text: mapped.message, at: Date.now() });
      throw mapped;
    }
  }

  paste(text: string): void {
    if (!this.ready || !this.proc || !this.threadId) throw new HttpError(409, "Codex session is not ready");
    if (this.submitting) throw new HttpError(409, "Codex is submitting a prompt");
    this.submitting = true;
    this.submittedText = text;
    // turn/start can steer a running turn; UserPromptSubmit comes only from turn/started.
    const proc = this.proc;
    const threadId = this.threadId;
    void resolveCodexInput(text, { rpc: proc.rpc, threadId, cwd: this.cwd })
      .then(async (resolved) => {
        if (resolved.kind === "handled") {
          if (this.proc !== proc || this.stopping) return;
          if (resolved.model) this.model = resolved.model;
          const at = Date.now();
          if (resolved.error) this.upsert({ id: randomUUID(), kind: "error", text: resolved.error, at });
          else if (resolved.notice) this.upsert({ id: randomUUID(), kind: "agent", text: resolved.notice, status: "done", at });
          return;
        }
        await proc.rpc.request("turn/start", { threadId, input: resolved.input, ...(this.model ? { model: this.model } : {}) });
      })
      .catch((error: unknown) => {
        if (this.proc !== proc || this.stopping) return;
        const message = codexHttpError(error).message;
        this.upsert({ id: randomUUID(), kind: "error", text: message, at: Date.now() });
        if (!this.turnId) {
          this.events?.failure?.(unknownFailure());
          this.hook("Stop", { last_assistant_message: message, failed: true });
        }
      })
      .finally(() => {
        if (this.proc === proc) this.submitting = false;
      });
  }

  async interrupt(): Promise<void> {
    if (!this.proc || !this.turnId) throw new HttpError(409, "Codex has no active turn");
    await this.proc.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
  }

  answer(requestId: string, decision: "accept" | "decline"): void {
    const request = this.approvals.get(requestId);
    if (!request || !this.ready || !this.proc) throw new HttpError(409, "Approval is no longer pending");
    this.proc.rpc.respond(request.id, { decision });
    this.approvals.delete(requestId);
    this.update(`approval:${requestId}`, { status: decision === "accept" ? "accepted" : "declined" });
  }

  attach(ws: WebSocket): void {
    this.clients.add(ws);
    ws.send(JSON.stringify({ t: "items", items: [...this.items.values()] }));
    if (!this.running) ws.send(JSON.stringify({ t: "x", code: null }));
    ws.on("close", () => this.clients.delete(ws));
  }

  stop(): void {
    this.stopping = true;
    this.ready = false;
    this.cancelOpen();
    this.proc?.kill();
  }

  closeClients(code: number, reason: string): void {
    for (const ws of this.clients) ws.close(code, reason);
    this.clients.clear();
  }

  private hook(event: HookEvent, payload: Obj = {}): void {
    this.events?.hook(event, { ...payload, session_id: this.sessionId });
  }

  private request(request: ServerRequest): void {
    const p = obj(request.params);
    if (request.method !== "item/commandExecution/requestApproval" && request.method !== "item/fileChange/requestApproval") {
      this.proc?.rpc.fail(request.id, -32601, `Unsupported interactive request: ${request.method}`);
      this.upsert({ id: randomUUID(), kind: "error", text: t("codex.unsupportedRequest", { method: request.method }), at: Date.now() });
      return;
    }
    const key = `${this.approvalPrefix}:${String(request.id)}`;
    this.approvals.set(key, request);
    const tool = this.tools.get(str(p.itemId)) ?? { tool_name: request.method.includes("command") ? "Bash" : "Edit", tool_input: { command: p.command } };
    this.upsert({
      id: `approval:${key}`,
      kind: "approval",
      text: str(p.reason) || str(tool.tool_name),
      detail: str(p.command) || this.items.get(str(p.itemId))?.detail,
      requestId: key,
      status: "pending",
      at: Date.now(),
    });
    this.hook("PermissionRequest", tool);
  }

  /** Best effort: an old Codex or a signed-out API key has no rate limits, and that must not fail the session. */
  private async readRateLimits(proc: CodexProcess): Promise<void> {
    try {
      const usage = await codexRateLimits(proc.rpc);
      if (usage && this.proc === proc && !this.stopping) this.events?.rateLimits?.(usage);
    } catch {
      // Display only.
    }
  }

  private notification(method: string, p: Obj): void {
    if (method === "account/rateLimits/updated") {
      const usage = parseCodexRateLimits(p);
      if (usage) this.events?.rateLimits?.(usage);
      return;
    }
    if (this.threadId && p.threadId && p.threadId !== this.threadId) return;
    if (method === "turn/started") {
      this.turnId = str(obj(p.turn).id);
      this.lastMessage = "";
      this.hook("UserPromptSubmit", { prompt: this.submittedText });
    } else if (method === "item/started" || method === "item/completed") {
      this.item(obj(p.item), method === "item/completed");
    } else if (method === "item/agentMessage/delta") {
      const id = str(p.itemId);
      const previous = this.items.get(id);
      this.upsert({ id, kind: "agent", text: (previous?.text ?? "") + str(p.delta), status: "running", at: previous?.at ?? Date.now() });
    } else if (method === "item/commandExecution/outputDelta") {
      const previous = this.items.get(str(p.itemId));
      if (previous) this.update(previous.id, { detail: ((previous.detail ?? "") + str(p.delta)).slice(-30_000) });
    } else if (method === "thread/tokenUsage/updated") {
      const total = obj(obj(p.tokenUsage).total);
      this.events?.metrics?.({
        ...(typeof total.inputTokens === "number" ? { inputTokens: total.inputTokens } : {}),
        ...(typeof total.outputTokens === "number" ? { outputTokens: total.outputTokens } : {}),
      });
    } else if (method === "serverRequest/resolved") {
      const key = `${this.approvalPrefix}:${String(p.requestId)}`;
      if (this.approvals.delete(key)) this.update(`approval:${key}`, { status: "cancelled" });
    } else if (method === "error") {
      this.upsert({ id: randomUUID(), kind: "error", text: str(obj(p.error).message), at: Date.now() });
      // willRetry errors are progress; turn/completed is the authoritative end of a turn.
    } else if (method === "turn/completed") {
      const turn = obj(p.turn);
      // A completion from a previous turn must not overwrite evidence or stop the active lane.
      if (!this.turnId || turn.id !== this.turnId || p.threadId !== this.threadId) return;
      if (Array.isArray(turn.items))
        for (const raw of turn.items) {
          const item = obj(raw);
          if (item.type === "agentMessage" && str(item.text)) this.item(item, true);
        }
      this.cancelOpen();
      const error = str(obj(turn.error).message);
      if (turn.status === "failed") this.events?.failure?.(codexTurnFailure(turn.error, this.threadId!, this.turnId));
      this.turnId = undefined;
      this.hook("Stop", {
        last_assistant_message: error || this.lastMessage,
        ...(turn.status === "failed" ? { failed: true } : {}),
        ...(turn.status === "interrupted" ? { interrupted: true } : {}),
      });
    }
  }

  private item(item: Obj, completed: boolean): void {
    const id = str(item.id);
    if (!id) return;
    const type = str(item.type);
    const previous = this.items.get(id);
    const at = previous?.at ?? Date.now();
    if (type === "agentMessage") {
      const text = str(item.text) || previous?.text || "";
      this.upsert({ id, kind: "agent", text, status: completed ? "done" : "running", at });
      if (completed && text) this.lastMessage = text;
    } else if (type === "userMessage") {
      const text = Array.isArray(item.content)
        ? item.content
            .map((c) => str(obj(c).text))
            .filter(Boolean)
            .join("\n")
        : "";
      this.upsert({ id, kind: "user", text, status: "done", at });
    } else if (type && type !== "reasoning") {
      const payload = toolPayload(item);
      const failed = ["failed", "declined", "cancelled"].includes(str(item.status));
      this.upsert({
        id,
        kind: "tool",
        text: str(payload.tool_name),
        detail:
          (str(item.command) || (type === "fileChange" ? JSON.stringify(item.changes) : JSON.stringify(item.arguments ?? item.action ?? {}))) +
          (str(item.aggregatedOutput) ? `\n${str(item.aggregatedOutput)}` : ""),
        status: completed ? (failed ? "failed" : "done") : "running",
        at,
      });
      if (!completed && !this.tools.has(id)) {
        this.tools.set(id, payload);
        this.hook("PreToolUse", payload);
      }
      if (completed && this.tools.delete(id)) this.hook(failed ? "PostToolUseFailure" : "PostToolUse", { ...payload, tool_response: item.aggregatedOutput ?? item.result });
    }
  }

  private cancelOpen(): void {
    for (const [id, tool] of this.tools) {
      this.update(id, { status: "cancelled" });
      this.hook("PostToolUseFailure", tool);
    }
    this.tools.clear();
    for (const [key, request] of this.approvals) {
      this.proc?.rpc.respond(request.id, { decision: "cancel" });
      this.update(`approval:${key}`, { status: "cancelled" });
    }
    this.approvals.clear();
    for (const item of this.items.values()) if (item.kind === "agent" && item.status === "running") this.update(item.id, { status: "cancelled" });
  }

  private update(id: string, patch: Partial<ConversationItem>): void {
    const item = this.items.get(id);
    if (item) this.upsert({ ...item, ...patch });
  }

  private upsert(item: ConversationItem): void {
    item.text = item.text.slice(-Math.min(this.limit, 100_000));
    if (item.detail) item.detail = item.detail.slice(-Math.min(this.limit, 30_000));
    this.items.set(item.id, item);
    let size = 0;
    let trimmed = false;
    const values = [...this.items.values()];
    for (let i = values.length - 1; i >= 0; i--) {
      size += values[i].text.length + (values[i].detail?.length ?? 0) + 200;
      if ((size > this.limit || values.length - i > 1000) && values[i].status !== "pending") {
        this.items.delete(values[i].id);
        trimmed = true;
      }
    }
    this.broadcast(trimmed ? { t: "items", items: [...this.items.values()] } : { t: "item", item });
  }

  private broadcast(frame: unknown): void {
    const data = JSON.stringify(frame);
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(data);
  }
}

function toolPayload(item: Obj): Obj {
  const type = item.type;
  const names: Record<string, string> = { commandExecution: "Bash", fileChange: "Edit", webSearch: "WebSearch" };
  const name = type === "mcpToolCall" ? `mcp__${str(item.server)}__${str(item.tool)}` : (names[str(type)] ?? str(type));
  const changes = Array.isArray(item.changes) ? item.changes : [];
  return {
    tool_use_id: item.id,
    tool_name: name,
    tool_input: type === "commandExecution" ? { command: item.command } : type === "fileChange" ? { file_path: str(obj(changes[0]).path), changes } : (item.arguments ?? item.action ?? {}),
  };
}

/** Unlike a read-only probe, a session owns an isolated group including its tool children. */
function spawnOwnedCodex(env: Record<string, string>, cwd: string, command: LaunchSpec, hookEnv: Record<string, string>): Promise<CodexProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      env: childEnv(process.env, { ...env, ...command.env, ...hookEnv }),
      cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-4000)));
    const rpc = new CodexRpc({ input: child.stdin, output: child.stdout });
    child.once("error", (error: NodeJS.ErrnoException) => {
      rpc.shutdown(null);
      reject(error.code === "ENOENT" ? new CodexError("missing", `${command.file} not found`) : error);
    });
    child.once("exit", (code) => rpc.shutdown(code));
    child.once("spawn", () =>
      resolve({
        rpc,
        child,
        stderr: () => stderr,
        kill: () => {
          if (process.platform === "win32") child.kill();
          else if (child.pid) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            }
          }
        },
      }),
    );
  });
}
