import type { Agent } from "../../shared/agents";
import type { RunPhase } from "../workspace";

/** A complete choice: absent model means no model flag, never inheritance from the workflow. */
export type AgentExecution = { agent: Agent; model?: string };
export type ExecutionSelection = { agent: "workflow"; model?: never } | AgentExecution;
export type ExecutionSelectionSource = "request" | "repo" | "workflow";
export type ExecutionSource = "workflow" | "assignment" | "execution" | "lane-override";

export interface SelectedExecution {
  execution: ExecutionSelection;
  source: ExecutionSelectionSource;
}

/** Requested launch configuration; this does not claim account/model availability. */
export interface EffectiveExecution extends AgentExecution {
  subagent?: string;
  permissionMode?: string;
  source: ExecutionSource;
  modelSource: "explicit" | "default";
}

/** Step id scopes a member number to its dispatch, independent of the current step index. */
export type LaneScope = { kind: "step"; stepId: string } | { kind: "subtask"; stepId: string; n: number };

export interface LaneOverride {
  scope: LaneScope;
  execution: AgentExecution;
  operationId: string;
  at: number;
}

export interface ExecutionSnapshot extends SelectedExecution {
  version: 1;
  /** Initial requested configurations; the original WorkflowDef is kept separately. */
  steps: Record<string, EffectiveExecution>;
}

export interface ExecutionProblem {
  field: string;
  message: string;
  n?: number;
}

export interface ExecutionAttempt {
  id: string;
  scope: LaneScope;
  sessionId: string;
  generation: number;
  execution: EffectiveExecution;
  actualModel?: string;
  startedAt: number;
  finishedAt?: number;
  metrics?: SubtaskMetrics;
  metricsSource?: "claude-statusline" | "codex-thread" | "legacy";
  metricsObservedAt?: number;
  nativeId?: string;
}

export type UsageTotals = Pick<SubtaskMetrics, "inputTokens" | "outputTokens" | "costUsd">;
export interface SessionMetricSnapshot {
  sessionId: string;
  nativeId?: string;
  agent?: Agent;
  generation?: number;
  source: "claude-statusline" | "codex-thread" | "legacy";
  basis: "session" | "thread" | "unknown";
  observedAt?: number;
  metrics: SubtaskMetrics;
}
export interface MetricsSummary {
  sessions: Array<{
    sessionId: string;
    nativeId?: string;
    agent?: Agent;
    attemptIds: string[];
    scopes: LaneScope[];
    actualModels: string[];
    measurements: SessionMetricSnapshot[];
    metrics: UsageTotals;
  }>;
  totals: UsageTotals;
  coverage: Record<keyof UsageTotals, number>;
}

export interface HandoffRequest {
  scope: LaneScope;
  target: AgentExecution;
  reason?: string;
}
export interface HandoffCommitRequest extends HandoffRequest {
  previewId: string;
  fingerprint: string;
  sourceSessionId: string;
  expectedGeneration: number;
  operationId: string;
  confirmStop?: boolean;
}
export interface HandoffPreview {
  version: 1;
  id: string;
  fingerprint: string;
  createdAt: number;
  scope: LaneScope;
  sourceSessionId: string;
  expectedGeneration: number;
  source: EffectiveExecution;
  target: EffectiveExecution;
  documents: Array<{
    kind: "spec" | "history" | "approved-plan" | "input" | "dependency-report" | "output";
    path?: string;
    status: "present" | "missing" | "unknown" | "omitted";
    required: boolean;
  }>;
  reason?: string;
  text: string;
  prompt: string;
}
export interface HandoffPreviewResult {
  preview: HandoffPreview;
  requiresConfirmation: boolean;
  preflight: { status: "ready" | "unknown" | "blocked"; errors: Array<{ field: string; message: string }> };
}

/** Persist each stage before its side effects; only sanitized text belongs in this journal. */
export interface HandoffJournal {
  operationId: string;
  scope: LaneScope;
  stage: "prepared" | "source-stopped" | "target-created" | "committed" | "failed";
  sourceSessionId: string;
  targetSessionId?: string;
  expectedGeneration: number;
  target: AgentExecution;
  previewId: string;
  fingerprint: string;
  requestHash?: string;
  promptState?: "pending" | "sending" | "sent";
  cleanup?: "complete" | "blocked";
  recovery?: "interrupted" | "blocked";
  text: string;
  reason?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RunState {
  taskKey: string;
  sessionId: string;
  stepIndex: number;
  phase: RunPhase;
  message: string;
  lastMessage?: string;
  /** The latest prompt pasted into the session, as sent. */
  sentPrompt?: { stepIndex: number; text: string; at: number };
  stepStartedAt: number;
  /** The step's agent sent no hook for a while, so TaskPilot cannot tell when it is done. */
  noHook?: boolean;
  startedAt: number;
  updatedAt: number;
  /** Set while a dispatch step runs (and after it): one entry per row of the plan's assignment table. */
  subtasks?: SubtaskRun[];
  execution?: ExecutionSelection;
  executionSnapshot?: ExecutionSnapshot;
  laneOverrides?: Record<string, LaneOverride>;
  attempts?: ExecutionAttempt[];
  handoffs?: HandoffJournal[];
  recoveryBlocked?: boolean;
  sessionMetrics?: SessionMetricSnapshot[];
}

export type SubtaskPhase = "pending" | "starting" | "running" | "waiting" | "done" | "interrupted";

/** One row of the plan's assignment table. */
export interface Assignment {
  n: number;
  title: string;
  agent: Agent;
  /** Subagent the whole session runs as (--agent); absent = the agent itself. */
  subagent?: string;
  /** Model as written in the table; absent = the subagent's or the user's default. */
  model?: string;
  files: string[];
  output: string;
  deps: number[];
}

/** What a finished subtask's session reported; Copilot gives no cost. */
export interface SubtaskMetrics {
  inputTokens?: number;
  outputTokens?: number;
  /** Model id the session ran (Claude's status line), else the model passed with --model. */
  model?: string;
  costUsd?: number;
  durationMs?: number;
}

export interface SubtaskRun extends Assignment {
  phase: SubtaskPhase;
  sessionId?: string;
  /** When the subtask's first prompt was sent. */
  startedAt?: number;
  finishedAt?: number;
  metrics?: SubtaskMetrics;
  lastMessage?: string;
  /** The agent sent no hook for a while after the prompt. */
  noHook?: boolean;
  /** Report file name in the task directory. */
  report: string;
  recoveryBlocked?: boolean;
}

/** What the plan's table gives, or why it cannot run yet. */
export interface ParsedAssignments {
  items: Assignment[];
  errors: string[];
}

/** A question Claude left for the reviewer (numbered in its document or message). */
export interface Question {
  n: number;
  text: string;
  proposal?: string;
}

export interface WorkflowStep {
  id: string;
  title: string;
  /** The agent that runs the step. */
  agent: Agent;
  model?: string;
  effective?: EffectiveExecution;
  gate: "approve" | "none";
  doneFile: string | null;
  /** Documents the step writes, from the workflow. */
  outputs: Array<{ id: string; file: string }>;
  /** Set on a dispatch step: each subtask of the plan runs in its own session. */
  dispatch: { from: string; report: string; parallel: number } | null;
}

/** The ways a repo can run a workflow, and the one it uses by default. */
export interface ModesInfo {
  modes: Array<{ id: string; name: string; description: string }>;
  selected: string;
  override: { kind: "none" | "legacy" | "extends"; extends: string | null };
  hash: string;
  settingsPath: string;
}

export interface RunOptionsValue {
  mode?: string;
  execution?: ExecutionSelection;
}

export interface ExecutionDefaults {
  execution: ExecutionSelection | null;
  executionVersion: number | null;
  errors: ExecutionProblem[];
  hash: string;
  settingsPath: string;
}

export interface CapabilityCheck {
  status: "supported" | "unsupported" | "unknown";
  source: string;
  error?: { code: string; agent: Agent; field: string; message: string };
}

export interface AgentCapability {
  agent: Agent;
  checkedAt: number;
  cli: CapabilityCheck & { version?: string };
  login: CapabilityCheck;
  models: CapabilityCheck & { items: Array<{ id: string; model: string; displayName?: string; isDefault: boolean }> };
  defaultModel: { kind: "agent-default" };
  permissionModes: string[];
  subagents: CapabilityCheck;
  quotaDetection: CapabilityCheck;
}

export interface RunPreview {
  workflow: { source: string; mode: { id: string; name: string; override: boolean } };
  execution: ExecutionSelection;
  source: ExecutionSelectionSource;
  steps: Array<{
    id: string;
    configured: EffectiveExecution;
    effective: EffectiveExecution;
    changes: string[];
    preflight: { status: "ready" | "unknown" | "blocked"; errors: Array<{ field: string; message: string }> };
    prompt: string | null;
    onReject: string | null;
  }>;
  errors: Array<{ stepId: string; field: string; message: string }>;
  warnings: Array<{ stepId: string; field: string; status: "unknown"; source: string }>;
}

export interface RunView {
  /** Saved mode for restart forms, including finished runs. Absent in older server responses. */
  runMode?: { id: string; name: string; override: boolean } | null;
  workflow: {
    source: string;
    origin: "repo" | "default";
    /** The way the run goes; absent in a snapshot saved before modes existed. */
    mode?: { id: string; name: string; override: boolean };
    historyFile: string;
    steps: WorkflowStep[];
    /** The run follows the workflow as it was when it started, which has been edited since. */
    outdated: boolean;
  };
  run: RunState | null;
  /** Claude's questions at a gate or while it waits. */
  questions: Question[];
  /** At a gate before a dispatch step: the subtasks the plan's table gives. */
  assignments: ParsedAssignments | null;
  /** Questions of each waiting subtask, by subtask number. */
  subtaskQuestions: Record<number, Question[]>;
  usage?: MetricsSummary | null;
  subtaskUsage?: Record<number, MetricsSummary>;
}
