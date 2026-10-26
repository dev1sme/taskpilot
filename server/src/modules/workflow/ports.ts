import type { ProviderId } from "../../core/providers.js";
import type { ProviderCapability, PreflightRequest, ProviderPromptInventory, PreflightResult, SessionView, SessionCreateOptions, SessionWaitOptions } from "../sessions/index.js";
import type { WorkflowDef } from "./types.js";
import type { ClaudeSubagentInfo } from "./prompt-vars.js";

/** Loads the workflow for a new run: `mode` when given, else the repo's own choice. */
export type LoadDef = (repo: string, mode?: string) => Promise<WorkflowDef>;

/** The repo's and the user's Claude subagents with their checks; handed in so workflow does not import config. */
export type ClaudeSubagentsOf = (repo: string) => Promise<ClaudeSubagentInfo[]>;

/** Read-only checks before run/restart/handoff mutation; receives no environment in its DTO. */
export interface SessionCapabilityPort {
  capabilities(repo: string): Promise<{ agents: ProviderCapability[] }>;
  preflight(repo: string, request: PreflightRequest): Promise<PreflightResult>;
}

/** Handoff primitives. Production implements all; older engine-only test ports may omit them. */
export interface SessionLifecyclePort {
  reserve(id: string, operationId: string, role?: "source" | "target"): Promise<SessionView>;
  release(id: string, operationId: string): Promise<SessionView>;
  retire(id: string, operationId: string, replacedBy: string): Promise<SessionView>;
  waitForReady(id: string, opts?: SessionWaitOptions): Promise<SessionView>;
  waitForExit(id: string, opts?: SessionWaitOptions): Promise<void>;
  stopAndWait(id: string, opts?: SessionWaitOptions): Promise<void>;
  recoverProcess(id: string, opts?: SessionWaitOptions): Promise<void>;
  rollback(sourceId: string, targetId: string, operationId: string, opts?: SessionWaitOptions): Promise<void>;
}

/** The parts of SessionManager the engine uses. */
export interface SessionPort extends Partial<SessionLifecyclePort> {
  /** Optional during port migration; production SessionManager implements both methods. */
  capabilities?: SessionCapabilityPort["capabilities"];
  preflight?: SessionCapabilityPort["preflight"];
  create(repo: string, taskKey: string, opts: SessionCreateOptions): Promise<SessionView>;
  resume(id: string): Promise<SessionView>;
  stop(id: string): Promise<void>;
  get(id: string): Promise<SessionView>;
  paste(id: string, text: string): void;
  /** What the leader's `{{subagents}}` lists for `agent`; absent or undefined = nothing provider-specific. Never rejects. */
  promptInventory?(repo: string, agent: ProviderId): Promise<ProviderPromptInventory | undefined>;
  /** Whether the session's running process has sent a hook of its own yet. */
  hookSeen(id: string): boolean;
}
