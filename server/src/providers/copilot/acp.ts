import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../../core/launch.js";
import { copilotHome } from "./home.js";

/** A failed ACP step; `code` tells the caller what went wrong, `message` is for logs. */
export class CopilotError extends Error {
  constructor(
    readonly code: "missing" | "protocol" | "closed" | "timeout" | "rpc",
    message: string,
  ) {
    super(message);
  }
}

export interface AcpModel {
  modelId: string;
  name?: string;
  /** `_meta.copilotEnablement`: "enabled" or another state; absent when the entry carries no meta. */
  enablement?: string;
  /** `_meta.copilotUsage`, e.g. "1x". */
  usage?: string;
}

export interface AcpSession {
  sessionId: string;
  models: AcpModel[];
  currentModelId?: string;
}

const REQUEST_TIMEOUT_MS = 20_000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Minimal Agent Client Protocol client for `copilot --acp` (JSON-RPC 2.0, one JSON object per line).
 * Checked on copilot 1.0.103: `session/new` answers `models.availableModels`; `session/close` ends
 * the session but leaves its directory in ~/.copilot/session-state, so callers remove it (see copilotAcpSession).
 */
export class AcpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buffer = "";
  private closed = false;

  constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.feed(chunk));
    proc.stdout.on("close", () => this.shutdown());
    proc.on("error", (err: NodeJS.ErrnoException) =>
      this.shutdown(err.code === "ENOENT" ? new CopilotError("missing", "copilot is not installed or not on PATH") : new CopilotError("closed", err.message)),
    );
    proc.on("close", () => this.shutdown());
    proc.stdin.on("error", () => {});
    // Kept for the error message when the process dies before it answers.
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-500)));
  }

  private stderr = "";

  request<T = unknown>(method: string, params?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closed) return Promise.reject(new CopilotError("closed", `copilot --acp is closed (${method})`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CopilotError("timeout", `copilot --acp did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  }

  kill(): void {
    this.shutdown();
    this.proc.kill();
  }

  private feed(chunk: string): void {
    this.buffer += chunk;
    for (let at = this.buffer.indexOf("\n"); at >= 0; at = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (line) this.handle(line);
    }
  }

  private handle(line: string): void {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const { id, method } = message;
    if (typeof method === "string") {
      // Notifications (session/update) are ignored; a request of the agent (permission, fs) is refused.
      if (id !== undefined) this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "not supported" } })}\n`);
      return;
    }
    if (typeof id !== "number") return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    const error = message.error as { message?: unknown } | undefined;
    if (error) entry.reject(new CopilotError("rpc", typeof error.message === "string" ? error.message : "copilot --acp error"));
    else entry.resolve(message.result);
  }

  private shutdown(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    const reason = error ?? new CopilotError("closed", `copilot --acp exited${this.stderr.trim() ? `: ${this.stderr.trim()}` : ""}`);
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(reason);
      this.pending.delete(id);
    }
  }
}

/** Where copilot keeps a session's directory; COPILOT_HOME moves the whole config tree. */
function sessionDir(sessionId: string): string {
  return join(copilotHome(), "session-state", sessionId);
}

export function parseModels(result: unknown): { models: AcpModel[]; currentModelId?: string } {
  const models = (result as { models?: { availableModels?: unknown; currentModelId?: unknown } } | null)?.models;
  if (!models || !Array.isArray(models.availableModels)) throw new CopilotError("protocol", "session/new returned no models.availableModels");
  const byId = new Map<string, AcpModel>();
  for (const raw of models.availableModels as Record<string, unknown>[]) {
    const modelId = raw?.modelId;
    if (typeof modelId !== "string" || !modelId) throw new CopilotError("protocol", "model entry without modelId");
    const meta = (raw._meta ?? {}) as Record<string, unknown>;
    const entry: AcpModel = {
      modelId,
      name: typeof raw.name === "string" ? raw.name : undefined,
      enablement: typeof meta.copilotEnablement === "string" ? meta.copilotEnablement : undefined,
      usage: typeof meta.copilotUsage === "string" ? meta.copilotUsage : undefined,
    };
    // "auto" is listed twice, once without meta; the entry with meta wins.
    const seen = byId.get(modelId);
    if (!seen || (seen.enablement === undefined && entry.enablement !== undefined)) byId.set(modelId, entry);
  }
  return { models: [...byId.values()], currentModelId: typeof models.currentModelId === "string" ? models.currentModelId : undefined };
}

/**
 * Starts `copilot --acp` in a scratch directory, opens a session to read what the account offers,
 * closes it, and removes the session directory copilot leaves behind. Never touches a user session.
 */
export async function copilotAcpSession(): Promise<AcpSession> {
  const cwd = await mkdtemp(join(tmpdir(), "taskpilot-copilot-acp-"));
  const proc = spawn(process.env.TASKPILOT_COPILOT ?? "copilot", ["--acp"], { cwd, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
  const client = new AcpClient(proc);
  let sessionId: string | undefined;
  try {
    await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const result = await client.request<{ sessionId?: unknown }>("session/new", { cwd, mcpServers: [] });
    if (typeof result?.sessionId !== "string" || !SESSION_ID.test(result.sessionId)) throw new CopilotError("protocol", "session/new returned no session id");
    sessionId = result.sessionId;
    const { models, currentModelId } = parseModels(result);
    await client.request("session/close", { sessionId }, 5_000).catch(() => {});
    return { sessionId, models, currentModelId };
  } finally {
    client.kill();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
    if (sessionId) await rm(sessionDir(sessionId), { recursive: true, force: true }).catch(() => {});
  }
}
