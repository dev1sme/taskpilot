import type { Agent } from "../../../core/agents.js";
import type { Launcher, LaunchSpec } from "../../../core/claude/launch.js";
import type { HookEvent } from "../hooks.js";

export type CapabilityStatus = "supported" | "unsupported" | "unknown";
export type PreflightErrorCode =
  | "missing_cli"
  | "not_logged_in"
  | "model_unavailable"
  | "inventory_unavailable"
  | "unsupported_permission"
  | "unsupported_subagent"
  | "invalid_model"
  | "timeout"
  | "protocol"
  | "network"
  | "probe_failed";

/** Safe to return through an API: never include raw stderr, account data or environment. */
export interface PreflightProblem {
  code: PreflightErrorCode;
  agent: Agent;
  field: "cli" | "login" | "model" | "permissionMode" | "subagent";
  message: string;
}

export interface CapabilityCheck {
  status: CapabilityStatus;
  source: "unverified" | "cli-version" | "initialize" | "account/read" | "model/list" | "adapter";
  error?: PreflightProblem;
}

export interface AgentCapability {
  agent: Agent;
  checkedAt: number;
  cli: CapabilityCheck & { version?: string };
  login: CapabilityCheck;
  models: CapabilityCheck & { items: Array<{ id: string; model: string; displayName?: string; isDefault: boolean }> };
  /** No model flag. Inventory's isDefault never promises the model this session will use. */
  defaultModel: { kind: "agent-default" };
  permissionModes: string[];
  subagents: CapabilityCheck;
  /** Detecting typed turn exhaustion, independent of account-wide usage or CLI availability. */
  quotaDetection: CapabilityCheck;
}

export interface BackendProbeContext {
  repo: string;
  /** The same launcher and repo extras as the session transport, without hook credentials. */
  command: LaunchSpec;
  extraEnv: Record<string, string>;
  timeoutMs: number;
}

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
  permissionModes: readonly string[];
  /** Subagent flags supported by the adapter, not proof of a particular custom agent's tools. */
  supportsSubagents: boolean;
  probe(context: BackendProbeContext): Promise<AgentCapability>;
  transport?: "pty" | "rpc";
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
