import * as pty from "node-pty";
import type { WebSocket } from "ws";
import { childEnv } from "../../../core/claude/launch.js";
import type { SessionTransport, TransportEvents, TransportLaunch } from "./types.js";

/** Client → server frames on the PTY WebSocket. */
type ClientFrame = { t: "i"; d: string } | { t: "r"; cols: number; rows: number };
/** Server → client frames: output, exit. */
type ServerFrame = { t: "o"; d: string } | { t: "x"; code: number | null };

const DEFAULT_SIZE = { cols: 120, rows: 32 };
/** Delay between a bracketed paste and the Enter that submits it (M0 spike used 200–300 ms). */
const SUBMIT_DELAY_MS = 200;
/** Plain-text output kept while looking for a ready marker; the marker is a short footer. */
const PENDING_OUTPUT_CHARS = 8192;

/** Runs the agent's TUI in a pseudo-terminal and streams it to WebSocket clients. */
export class PtyTransport implements SessionTransport {
  private proc: pty.IPty | null = null;
  /** Recent output as plain text, while waiting for the backend's ready marker. */
  private pendingOutput: string | null = null;
  /** Raw PTY output replayed to clients that attach later (page reload, second tab). */
  private readonly scrollback: string[] = [];
  private scrollbackSize = 0;
  private readonly clients = new Set<WebSocket>();
  private exitCode: number | null = null;

  constructor(private readonly scrollbackLimit: number) {}

  get running(): boolean {
    return this.proc !== null;
  }

  start({ meta, resume, backend, launcher, extraEnv, hookEnv }: TransportLaunch, events: TransportEvents): void {
    const {
      file,
      args,
      env: launchEnv,
    } = launcher(meta.id, {
      resume,
      settings: backend.launchSettings?.(),
      permissionMode: meta.permissionMode,
      model: meta.model,
      subagent: meta.subagent,
    });
    const proc = pty.spawn(file, args, {
      name: "xterm-256color",
      cwd: meta.repo,
      env: childEnv(process.env, { ...extraEnv, ...launchEnv, ...hookEnv }),
      ...DEFAULT_SIZE,
    });
    // On resume, keep the previous run's scrollback and attached clients.
    this.proc = proc;
    this.exitCode = null;
    this.pendingOutput = backend.readyMarker ? "" : null;

    proc.onData((data) => {
      this.scrollback.push(data);
      this.scrollbackSize += data.length;
      while (this.scrollbackSize > this.scrollbackLimit && this.scrollback.length > 1) {
        this.scrollbackSize -= this.scrollback.shift()!.length;
      }
      for (const ws of this.clients) send(ws, { t: "o", d: data });
      if (this.pendingOutput !== null && backend.readyMarker) {
        this.pendingOutput = (this.pendingOutput + stripAnsi(data)).slice(-PENDING_OUTPUT_CHARS);
        if (this.pendingOutput.includes(backend.readyMarker)) {
          this.pendingOutput = null;
          // Stands in for the SessionStart hook the agent sends only with its first prompt.
          events.hook("SessionStart", { session_id: meta.id, source: resume ? "resume" : "startup" });
        }
      }
    });
    proc.onExit(({ exitCode }) => {
      this.proc = null;
      this.exitCode = exitCode;
      for (const ws of this.clients) send(ws, { t: "x", code: exitCode });
      events.exit(exitCode);
    });
  }

  /** Types a prompt into the session as one bracketed paste, then submits it. */
  paste(text: string): void {
    this.proc?.write(`\x1b[200~${text}\x1b[201~`);
    setTimeout(() => this.proc?.write("\r"), SUBMIT_DELAY_MS);
  }

  stop(): void {
    this.proc?.kill();
  }

  closeClients(code: number, reason: string): void {
    for (const ws of this.clients) ws.close(code, reason);
  }

  write(data: string): void {
    this.proc?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.proc?.resize(cols, rows);
  }

  /** Sends the scrollback (and the exit, when no process runs) to a client and adds it to the clients. */
  replay(ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) return;
    if (this.scrollback.length > 0) send(ws, { t: "o", d: this.scrollback.join("") });
    if (!this.proc) send(ws, { t: "x", code: this.exitCode });
    this.clients.add(ws);
  }

  detach(ws: WebSocket): void {
    this.clients.delete(ws);
  }
}

/**
 * Streams a PTY session to a WebSocket. Scrollback is replayed after the client's first resize
 * frame, so it is rendered at the client's terminal size. `terminal(true)` returns the session's
 * transport and creates it when missing; `terminal(false)` only returns an existing one.
 */
export function attachPty(ws: WebSocket, terminal: (create: boolean) => PtyTransport | undefined): void {
  // Listeners first: the client sends its resize frame right after the socket opens.
  let attached = false;
  ws.on("message", (raw) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(String(raw)) as ClientFrame;
    } catch {
      return;
    }
    if (ws.readyState !== ws.OPEN) return;
    if (frame.t === "i" && typeof frame.d === "string") {
      terminal(false)?.write(frame.d);
    } else if (frame.t === "r" && validSize(frame.cols, frame.rows)) {
      terminal(false)?.resize(frame.cols, frame.rows);
      if (!attached) {
        attached = true;
        terminal(true)?.replay(ws);
      }
    }
  });
  ws.on("close", () => terminal(false)?.detach(ws));
}

/** Terminal output without escape sequences, enough to find a line of text in it. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, "")
    .replace(/\x1b[()][A-Za-z0-9]/g, "");
}

function send(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

function validSize(cols: number, rows: number): boolean {
  const ok = (n: number) => Number.isInteger(n) && n > 0 && n <= 1000;
  return ok(cols) && ok(rows);
}
