import type { Agent } from "../../../core/agents.js";
import type { Launcher } from "../../../core/claude/launch.js";
import type { HookEvent } from "../hooks.js";

/** What a backend may remember about one running session between hook callbacks. */
export interface HookState {
  /** Ids handed out to tool calls that have not finished yet, oldest first, by tool name. */
  openTools: Map<string, string[]>;
  nextToolId: number;
  /** When each tool call last finished, by tool name and subject (permissionGraceMs). */
  finishedAt: Map<string, number>;
  /** PermissionRequests held back for permissionGraceMs, by tool name and subject. */
  heldPermissions: Map<string, NodeJS.Timeout>;
}

/**
 * How TaskPilot runs one coding agent in a session. Everything past this interface (engine,
 * activity feed, hook routes) works with Claude Code's hook names and payload fields.
 */
export interface AgentBackend {
  id: Agent;
  launcher: Launcher;
  /** JSON for the agent's --settings flag, when it takes its hooks on the command line. */
  launchSettings?(): string;
  /** Writes the hook configuration the agent reads from disk; runs before every spawn. */
  prepare?(repo: string): Promise<void>;
  /**
   * Text the agent prints once its prompt takes input. Set when the agent's SessionStart hook does
   * not fire at startup: the session then reports SessionStart when this text appears.
   */
  readyMarker?: string;
  /**
   * Set when the agent fires PermissionRequest before deciding whether to ask at all: the request
   * shows only if the tool has not finished after this long (or did not just finish).
   */
  permissionGraceMs?: number;
  /**
   * For agents whose Stop hook may never arrive: the Stop payload when the agent's own transcript
   * shows that the turn begun after `since` (ms) has ended and nothing was written for `idleMs`,
   * null while it has not. Only asked for sessions that have not sent a single hook of their own.
   */
  finishedTurn?(sessionId: string, since: number, idleMs: number): Promise<Record<string, unknown> | null>;
  /** The payload as Claude Code would send it; null drops the event. */
  normalize?(event: HookEvent, payload: Record<string, unknown>, state: HookState): Promise<Record<string, unknown> | null>;
}
