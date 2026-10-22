import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { childEnv } from "../claude/launch.js";
import { CodexError, RpcError } from "./errors.js";
import { codexCommand } from "./launch.js";

/** A request the app-server sends to us (an approval); answer it with respond() or fail(). */
export interface ServerRequest {
  /** Numeric, counted by the server from 0: it can equal the id of a request of ours. */
  id: number | string;
  method: string;
  params: unknown;
}

export interface RpcEvents {
  notification: [method: string, params: unknown];
  request: [request: ServerRequest];
  /** A line that is not JSON-RPC; the client skips it. */
  invalid: [line: string];
  /** The stream ended or the process exited; pending requests were rejected. */
  close: [code: number | null];
}

export interface RpcIo {
  input: Writable;
  output: Readable;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * JSON-RPC 2.0 over lines of JSON on a stream pair, as `codex app-server --listen stdio://` speaks
 * it (the "jsonrpc" field is left out on the wire). Unknown notifications and fields pass through:
 * the protocol is experimental and grows between Codex versions.
 */
export class CodexRpc extends EventEmitter<RpcEvents> {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buffer = "";
  private closed = false;

  constructor(private readonly io: RpcIo) {
    super();
    io.output.setEncoding("utf8");
    io.output.on("data", (chunk: string) => this.feed(chunk));
    io.output.on("end", () => this.shutdown(null));
    io.output.on("close", () => this.shutdown(null));
    // A write to a dead process fails with EPIPE; the close handler reports it.
    io.input.on("error", () => {});
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (this.closed) return Promise.reject(new CodexError("closed", `Codex app-server is closed (${method})`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexError("timeout", `Codex app-server did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.send({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.closed) this.send({ method, ...(params === undefined ? {} : { params }) });
  }

  /** Answers a server request, e.g. `{decision: "accept"}` for an approval. */
  respond(id: number | string, result: unknown): void {
    if (!this.closed) this.send({ id, result });
  }

  /** Answers a server request with an error, e.g. for a method we do not handle. */
  fail(id: number | string, code: number, message: string): void {
    if (!this.closed) this.send({ id, error: { code, message } });
  }

  /** Stops talking and rejects what is pending; the process is the caller's to stop. */
  close(): void {
    this.shutdown(null);
  }

  private send(message: object): void {
    this.io.input.write(`${JSON.stringify(message)}\n`);
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
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      message = parsed as Record<string, unknown>;
    } catch {
      this.emit("invalid", line);
      return;
    }
    const { id, method } = message;
    const hasId = typeof id === "number" || typeof id === "string";
    if (typeof method === "string") {
      // A method means a notification or a server request, whatever the id: server ids are
      // counted apart from ours and may collide with a pending request of ours.
      if (hasId) this.emit("request", { id, method, params: message.params });
      else this.emit("notification", method, message.params);
    } else if (typeof id === "number") {
      this.settle(id, message);
    } else {
      this.emit("invalid", line);
    }
  }

  private settle(id: number, message: Record<string, unknown>): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    const error = message.error as { code?: unknown; message?: unknown; data?: unknown } | undefined;
    if (error) entry.reject(new RpcError(typeof error.code === "number" ? error.code : -32603, typeof error.message === "string" ? error.message : "Codex app-server error", error.data));
    else entry.resolve(message.result);
  }

  /** `code` is the exit code when the process is known to have exited; null for a closed stream. */
  shutdown(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new CodexError("closed", "Codex app-server exited"));
      this.pending.delete(id);
    }
    this.emit("close", code);
  }
}

export interface CodexProcess {
  rpc: CodexRpc;
  child: ChildProcess;
  /** Last stderr output, for the message when the handshake or the process fails. */
  stderr: () => string;
  kill: () => void;
}

/**
 * Starts `codex app-server --listen stdio://`. A missing binary rejects with CodexError "missing".
 * One process per call: stdio does not share state with the user's app-server daemon (fixtures README).
 */
export function spawnCodex(env: Record<string, string> = {}, cwd?: string): Promise<CodexProcess> {
  const { file, args } = codexCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: childEnv(process.env, env), cwd, stdio: ["pipe", "pipe", "pipe"] });
    let errText = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (errText = (errText + chunk).slice(-4000)));
    const rpc = new CodexRpc({ input: child.stdin, output: child.stdout });
    child.once("error", (err: NodeJS.ErrnoException) => {
      rpc.shutdown(null);
      reject(err.code === "ENOENT" ? new CodexError("missing", `${file} not found`) : err);
    });
    child.once("exit", (code) => rpc.shutdown(code));
    child.once("spawn", () => resolve({ rpc, child, stderr: () => errText, kill: () => child.kill() }));
  });
}

/** Clients that send `initialize` identify themselves; the version is TaskPilot's. */
const CLIENT_INFO = { name: "taskpilot", title: "TaskPilot", version: "0.1.0" };

export interface InitializeResult {
  userAgent?: string;
  codexHome?: string;
}

/** The handshake: `initialize`, then the `initialized` notification. */
export async function initializeCodex(rpc: CodexRpc, opts: { timeoutMs?: number } = {}): Promise<InitializeResult> {
  const result = await rpc.request<InitializeResult>("initialize", { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: false, requestAttestation: false } }, opts.timeoutMs);
  if (typeof result !== "object" || result === null || typeof result.userAgent !== "string") {
    throw new CodexError("protocol", "initialize returned no userAgent");
  }
  rpc.notify("initialized");
  return result;
}

/** Spawn plus handshake; the process is killed when the handshake fails. */
export async function startCodex(env: Record<string, string> = {}, cwd?: string): Promise<CodexProcess & { init: InitializeResult }> {
  const proc = await spawnCodex(env, cwd);
  try {
    return { ...proc, init: await initializeCodex(proc.rpc) };
  } catch (err) {
    proc.kill();
    if (err instanceof CodexError && err.code === "closed" && proc.stderr()) {
      throw new CodexError("closed", `Codex app-server exited: ${proc.stderr().trim().split("\n").at(-1)}`);
    }
    throw err;
  }
}

/** `account/read`: false when nobody is logged in (`account` is null; model/list still answers then). */
export async function codexLoggedIn(rpc: CodexRpc): Promise<boolean> {
  const result = await rpc.request<{ account?: unknown } | null>("account/read", { refreshToken: false });
  if (typeof result !== "object" || result === null || !("account" in result)) throw new CodexError("protocol", "account/read returned no account field");
  return result.account !== null && result.account !== undefined;
}
