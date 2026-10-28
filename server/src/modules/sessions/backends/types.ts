import type { SessionMeta } from "../../../core/state.js";
import type { ClaudeCliOptions } from "../../../providers/claude/cli-launcher.js";
import type { CodexCliOptions } from "../../../providers/codex/cli-launcher.js";

/** Injection boundary: provider extensions stay out of the shared process contract. */
export type SessionLaunchOptions = ClaudeCliOptions & CodexCliOptions;
export type SessionLauncher = Launcher<SessionLaunchOptions>;

import type { ProviderId } from "../../../core/providers.js";
import type { LaunchOptions, Launcher, LaunchSpec } from "../../../core/launch.js";
import type { HookEvent } from "../hooks.js";
import type { SessionMetrics, SessionMetricsSource } from "../transports/types.js";
import type { ClaudeStatusLineUsage } from "../../../providers/claude/status-line.js";

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
  agent: ProviderId;
  field: "cli" | "login" | "model" | "permissionMode" | "subagent";
  message: string;
}

export interface CapabilityCheck {
  status: CapabilityStatus;
  source: "unverified" | "cli-version" | "initialize" | "account/read" | "model/list" | "adapter";
  error?: PreflightProblem;
}

export interface ProviderCapability {
  agent: ProviderId;
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

/** `unsupported` blocks the lane; `unknown` (a name that is no file, e.g. a built-in agent) only warns. */
export type SubagentCheck = "found" | "unsupported" | "unknown";

/** A provider's custom agents and the model names it accepts, for the leader's `{{subagents}}`; `models` null = list unreadable. */
export interface ProviderPromptInventory {
  agents: Array<{ name: string; scope: "project" | "user"; description?: string; model?: string }>;
  models: string[] | null;
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

/** What the workflow may know about a provider without any I/O; the engine reads these instead of comparing agent names. */
/** Account usage a session reported, tagged with the agent whose account it measures. */
export type AccountUsageReport = { agent: "claude"; usage: ClaudeStatusLineUsage | null };

export interface StatusLineReading {
  metrics: SessionMetrics;
  account: AccountUsageReport;
}

export interface ProviderTraits {
  permissionModes: readonly string[];
  /** Subagent flags supported by the adapter, not proof of a particular custom agent's tools. */
  supportsSubagents: boolean;
  /** Preflight blocks the lane when the account is not logged in (the probe can tell). */
  requiresLogin: boolean;
  /** Preflight blocks an explicit model when the model inventory could not be read. */
  requiresModelInventory: boolean;
  /** A prompt that gets no hook at all is reported to the user: this provider's hooks may silently not fire. */
  warnsWhenNoHook: boolean;
  /** What `turnMetrics` measures; absent = the backend reports no metrics of its own. */
  metricsSource?: SessionMetricsSource;
  /** Why `value` (a one-word model name) cannot be this provider's model, or null; absent = any name goes. */
  modelProblem?(value: string): string | null;
}

/**
 * How TaskPilot runs one coding agent in a session. Hooks reach it in Claude Code's names and
 * payload fields; past SessionManager, consumers see only `SessionEvent` and `SessionMetrics`.
 */
export interface ProviderBackend extends ProviderTraits {
  id: ProviderId;
  probe(context: BackendProbeContext): Promise<ProviderCapability>;
  launcher: SessionLauncher;
  launchOptions(meta: Pick<SessionMeta, "nativeId" | "codex">, options: LaunchOptions): SessionLaunchOptions;
  /** Writes the hook configuration the agent reads from disk; runs before every spawn. */
  prepare?(repo: string): Promise<void>;
  /**
   * Text the agent prints once its prompt takes input. Set when the agent's SessionStart hook does
   * not fire at startup: the session then reports SessionStart when this text appears. A RegExp is
   * matched against the recent output as plain text (ANSI removed).
   */
  readyMarker?: string | RegExp;
  /** The agent's own conversation id in a hook payload, when it names sessions itself (Codex: `session_id` is its thread id); used to resume. */
  nativeIdOf?(payload: Record<string, unknown>): string | undefined;
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
  /** Whether `name` is a subagent of the repo this provider can run; absent = names are not checked. Never throws. */
  checkSubagent?(repo: string, name: string): SubagentCheck;
  /** What the leader's `{{subagents}}` lists for this provider; absent = nothing to list. Never rejects. */
  promptInventory?(repo: string): Promise<ProviderPromptInventory>;
  /** Cumulative measurements this turn's hook carries (Codex: the rollout's last `token_count`); null = none. Called with the normalized payload, before the hook is emitted. */
  turnMetrics?(event: HookEvent, payload: Record<string, unknown>): Promise<SessionMetrics | null>;
  /** What a status line callback reports (Claude: model, session cost, plan usage); absent = the agent has no status line. */
  readStatusLine?(payload: Record<string, unknown>): StatusLineReading;
  /** The payload as Claude Code would send it; null drops the event. */
  normalize?(event: HookEvent, payload: Record<string, unknown>, state: HookState): Promise<Record<string, unknown> | null>;
}
