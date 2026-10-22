import type { Launcher } from "../../../core/claude/launch.js";
import type { SessionMeta } from "../../../core/state.js";
import type { AgentBackend } from "../backends/types.js";
import type { HookEvent } from "../hooks.js";

/** What a transport needs to start the agent's process for one spawn of a session. */
export interface TransportLaunch {
  meta: SessionMeta;
  resume: boolean;
  backend: AgentBackend;
  launcher: Launcher;
  /** Environment set before the launcher's own (TaskPilot's env store). */
  extraEnv: Record<string, string>;
  /** Environment set after the launcher's own (hook URL and token). */
  hookEnv: Record<string, string>;
}

/** How a transport reports back to the SessionManager while its process runs. */
export interface TransportEvents {
  /** An event the transport saw itself, in Claude Code's hook names and payload fields. */
  hook(event: HookEvent, payload: Record<string, unknown>): void;
  /** The process ended; the transport no longer runs. */
  exit(code: number | null): void;
}

/**
 * How a session talks to its agent's process. One transport belongs to one session and outlives
 * its processes: a resume starts the next process on the same transport.
 */
export interface SessionTransport {
  /** Whether a process is running. */
  readonly running: boolean;
  /** Starts a process. Throws when it cannot be started; nothing is changed then. */
  start(launch: TransportLaunch, events: TransportEvents): void;
  /** Sends a prompt and submits it. */
  paste(text: string): void;
  /** Ends the process; the end is reported through `events.exit`. */
  stop(): void;
  /** Closes every client attached to the session. */
  closeClients(code: number, reason: string): void;
}
