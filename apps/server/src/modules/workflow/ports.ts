import type { ProviderId } from "@taskpilot/shared";
import type { ProviderCapability, PreflightRequest, ProviderPromptInventory, PreflightResult, SessionView, SessionCreateOptions, SessionWaitOptions } from "../sessions/index.js";
import type { WorkflowDef } from "./types.js";
import type { RunWorkspace, WorkspaceDiff, WorkspaceView, WorktreeCheck } from "../workspace/types.js";
import type { ClaudeSubagentInfo } from "./prompt-vars.js";

/** Loads the workflow for a new run: `mode` when given, else the repo's own choice. */
export type LoadDef = (repo: string, mode?: string) => Promise<WorkflowDef>;

/** The repo's and the user's Claude subagents with their checks; handed in so workflow does not import config. */
export type ClaudeSubagentsOf = (repo: string) => Promise<ClaudeSubagentInfo[]>;

/** Read-only checks before run/restart/handoff mutation; receives no environment in its DTO. */
export interface SessionCapabilityPort {
  capabilities(repo: string): Promise<{ agents: ProviderCapability[] }>;
  /** `cwd`: the run's worktree, when the session will run there. */
  preflight(repo: string, request: PreflightRequest, opts?: { cwd?: string }): Promise<PreflightResult>;
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
  /** No session in `cwd` is running and every process it owned is proven gone. */
  quiesce(cwd: string, opts?: SessionWaitOptions): Promise<void>;
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

/** The worktree operations a run needs; handed in so workflow does not construct Git state itself. */
export interface WorkspacePort {
  check(repo: string): Promise<WorktreeCheck>;
  create(repo: string, taskKey: string, runId: string, opts?: { acceptDirty?: boolean }): Promise<RunWorkspace>;
  discardUnused(workspace: RunWorkspace): Promise<void>;
  require(repo: string, taskKey: string, runId: string): Promise<RunWorkspace>;
  list(repo: string, taskKey: string): Promise<RunWorkspace[]>;
  view(workspace: RunWorkspace, active: boolean): Promise<WorkspaceView>;
  diff(workspace: RunWorkspace): Promise<WorkspaceDiff>;
  integrate(workspace: RunWorkspace, opts?: { commit?: boolean }): Promise<RunWorkspace>;
  remove(workspace: RunWorkspace, opts?: { force?: boolean }): Promise<RunWorkspace>;
}
