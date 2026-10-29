import type { ProviderId } from "@taskpilot/shared";
import type { MetricSample, ObservationAvailability } from "../../core/observation-types.js";

/** A complete choice: absent model means no model flag, never inheritance from the workflow. */
export type AgentExecution = { agent: ProviderId; model?: string };
export type ExecutionSelection = { agent: "workflow"; model?: never } | AgentExecution;
export type ExecutionSelectionSource = "request" | "repo" | "workflow";
export type ExecutionSource = "workflow" | "assignment" | "execution" | "lane-override";

export interface SelectedExecution {
  execution: ExecutionSelection;
  source: ExecutionSelectionSource;
}

/** Codex permission options from `codex:` in workflow.yml; absent = Codex's own configuration. */
export interface CodexOptions {
  approvalsReviewer?: "user" | "auto_review";
  networkAccess?: boolean;
}

/** Requested launch configuration; this does not claim account/model availability. */
export interface EffectiveExecution extends AgentExecution {
  subagent?: string;
  permissionMode?: string;
  /** Only set for a Codex lane, and only when the workflow asks for it. */
  codex?: CodexOptions;
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
  /** Session/thread cumulative snapshot, not usage attributable to this attempt alone. */
  metrics?: SubtaskMetrics;
  metricsSource?: MetricsSource;
  metricsObservedAt?: number;
  nativeId?: string;
}

export type MetricsSource = "claude-statusline" | "codex-thread" | "legacy";
export type UsageTotals = Pick<SubtaskMetrics, "inputTokens" | "outputTokens" | "costUsd">;

/** One cumulative observation per session and source, never an event delta. */
export interface SessionMetricSnapshot {
  availability?: ObservationAvailability;
  sample?: MetricSample;
  sessionId: string;
  nativeId?: string;
  agent?: ProviderId;
  generation?: number;
  source: MetricsSource;
  basis: "session" | "thread" | "unknown";
  observedAt?: number;
  metrics: SubtaskMetrics;
}

export interface SessionUsage {
  sessionId: string;
  nativeId?: string;
  agent?: ProviderId;
  attemptIds: string[];
  scopes: LaneScope[];
  actualModels: string[];
  measurements: SessionMetricSnapshot[];
  metrics: UsageTotals;
}

export interface MetricsSummary {
  sessions: SessionUsage[];
  /** A total is present only when every session supplies that measurement. */
  totals: UsageTotals;
  /** Number of sessions with each measured counter; absent measurements are never zero-filled. */
  coverage: Record<keyof UsageTotals, number>;
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
  /** Hash of the complete commit request; an operation id cannot be reused for another request. */
  requestHash?: string;
  /** No automatic replay when delivery was started but not durably acknowledged. */
  promptState?: "pending" | "sending" | "sent";
  cleanup?: "complete" | "blocked";
  /** Recovery never replays a possibly delivered prompt. */
  recovery?: "interrupted" | "blocked";
  text: string;
  reason?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** A document a step writes into the task directory. */
export interface OutputDef {
  id: string;
  /** File name inside the task directory. */
  file: string;
  /** What the document must contain; listed in the prompt through {{outputs}}. */
  content: string;
  /** Skeleton file (next to workflow.yml) the document must follow, and its text; shown in {{outputs}}. */
  format?: string;
  formatText?: string;
}

/** A "giao việc" step: after the plan is approved, each row of its assignment table becomes a subtask. */
export interface DispatchDef {
  /** Id of the earlier step output that holds the "Phân công" table. */
  from: string;
  /** Subtask prompt template text, already loaded. */
  prompt: string;
  promptFile: string;
  /** Report file name, `{{n}}` standing for the subtask number. */
  report: string;
  /** Skeleton file (next to workflow.yml) the report must follow, and its text. */
  format?: string;
  formatText?: string;
  /** Subtasks allowed to run at the same time, 1..MAX_PARALLEL. */
  parallel: number;
  /** Most subtasks the whole table may hold; absent = no limit (also for a run whose snapshot predates the key). */
  maxSubtasks?: number;
}

/** One row of the assignment table. */
export interface Assignment {
  n: number;
  title: string;
  agent: ProviderId;
  /** Subagent the whole session runs as (--agent); absent = the agent itself. */
  subagent?: string;
  /** Model as written in the table; `default`/`inherit` pass no --model. Absent = the subagent's or the user's default. */
  model?: string;
  /** Files or directories the subtask may change; used to keep parallel subtasks apart. */
  files: string[];
  output: string;
  /** Numbers of the subtasks that must be done first. */
  deps: number[];
}

/** pending: not started; starting/running/waiting/interrupted/done as for a run (done: its report was written). */
export type SubtaskPhase = "pending" | "starting" | "running" | "waiting" | "done" | "interrupted";

/**
 * What a subtask's session reported, for the leader's review. Claude supplies model and cost;
 * Codex supplies the hook's model and cumulative thread tokens from its rollout file (source `codex-thread`). Missing measurements stay absent.
 */
export interface SubtaskMetrics {
  inputTokens?: number;
  outputTokens?: number;
  /** Compatibility display value: backend model, or the requested model on older paths. See attempt.actualModel for evidence. */
  model?: string;
  /** Cost of the whole session in USD (Claude only). */
  costUsd?: number;
  /** From the first prompt to the report, answers to the subtask's questions included. */
  durationMs?: number;
}

/** Metadata and content digest captured before input, after the previous writer exited on transfer. */
export interface OutputBaseline {
  file: string;
  fingerprint: string | null;
}

export interface SubtaskRun extends Assignment {
  phase: SubtaskPhase;
  sessionId?: string;
  stepStartedAt?: number;
  promptId?: string;
  outputBaseline?: OutputBaseline;
  recoveryBlocked?: boolean;
  /** When the subtask's first prompt was sent. */
  startedAt?: number;
  /** When the subtask was done (its report written). */
  finishedAt?: number;
  metrics?: SubtaskMetrics;
  pendingPrompt?: string;
  sentPrompt?: { stepIndex: number; text: string; at: number; sessionId?: string };
  lastMessage?: string;
  /** The agent sent no hook for a while after the prompt, so nothing tells TaskPilot when it is done. */
  noHook?: boolean;
  /** Report file name inside the task directory. */
  report: string;
}

export interface StepDef {
  id: string;
  title: string;
  /** The agent that runs this step: the step's own `agent`, else the workflow's. */
  agent: ProviderId;
  /** Passed as --model to the step's session: the step's own `model`, else the workflow's; absent for the agent's default. */
  model?: string;
  /** The step's `codex` options merged over the workflow's. */
  codex?: CodexOptions;
  /** Prompt template text, already loaded. */
  prompt: string;
  /** Prompt file name, inside the workflow directory. */
  promptFile: string;
  outputs: OutputDef[];
  /** The step is complete when this output (relative to the task dir) was written during the step. */
  doneWhen?: { output: string; file: string };
  gate: "approve" | "none";
  /** Template sent with the reviewer's feedback when a gate is rejected. */
  onReject?: string;
  onRejectFile?: string;
  /** Set on a dispatch step, which has no prompt, outputs or gate of its own. */
  dispatch?: DispatchDef;
}

export interface WorkflowDef {
  /** Absolute path of workflow.yml, for display. */
  source: string;
  /** The repo's override in .taskpilot/, or TaskPilot's built-in workflow. */
  origin: "repo" | "default";
  /** Directory holding workflow.yml and its prompt files. */
  dir: string;
  /** The mode it was built for; absent in a snapshot saved before modes existed. `override`: the repo's override is merged in (or is the whole workflow, for "custom"). */
  mode?: { id: string; name: string; override: boolean };
  /** Default agent of the steps (`agent` at the top of workflow.yml); claude when absent. */
  agent: ProviderId;
  /** Default model of the steps (`model` at the top of workflow.yml), as written; absent = the agent's default. */
  model?: string;
  permissionMode?: string;
  /** `codex` at the top of workflow.yml: default permission options of the Codex steps. */
  codex?: CodexOptions;
  /**
   * The task's decision log: file name in the task dir, the heading Claude uses for its entries, and
   * an optional skeleton file for a whole entry ({{historyFormat}}).
   */
  history: { file: string; entry: string; format?: string; formatText?: string };
  /** Sentence about the documents' language, available as {{language}}. */
  language: string;
  /** Rules shared by every prompt, available as {{rules}}. */
  rules: string[];
  /** Output ids Claude must read from the archive after "Chạy lại từ đầu"; all archived files when absent. */
  restart?: { read: string[] };
  steps: StepDef[];
}

/**
 * starting     session spawned, waiting for SessionStart before sending the step prompt
 * running      prompt sent, Claude working
 * waiting      Claude ended its turn but done-when is not met (it may be asking the user)
 * gate         step done, waiting for approve / feedback
 * interrupted  session exited mid-step
 */
export type RunPhase = "starting" | "running" | "waiting" | "gate" | "interrupted" | "done" | "cancelled";

export interface RunState {
  repo: string;
  taskKey: string;
  sessionId: string;
  stepIndex: number;
  phase: RunPhase;
  /** Start of the current prompt; done-when files must be written after it. */
  stepStartedAt: number;
  promptId?: string;
  outputBaseline?: OutputBaseline;
  recoveryBlocked?: boolean;
  message: string;
  /** Claude's last message of the latest turn (Stop hook), shown at gates. */
  lastMessage?: string;
  /** The latest prompt pasted into the session, as sent: a real task's prompt, not a preview. */
  sentPrompt?: { stepIndex: number; text: string; at: number; sessionId?: string };
  /** Prompt to send once the session reports SessionStart. */
  pendingPrompt?: string;
  /** The step's agent sent no hook for a while after the prompt (a subtask has its own flag). */
  noHook?: boolean;
  /** The workflow as it was when the run started; later edits apply to new runs only. */
  workflow?: WorkflowDef;
  /** Absent on legacy runs: always follow the workflow, ignoring current repo defaults. */
  execution?: ExecutionSelection;
  executionSnapshot?: ExecutionSnapshot;
  /** Keys are produced by laneKey(); an override affects only this step or member. */
  laneOverrides?: Record<string, LaneOverride>;
  attempts?: ExecutionAttempt[];
  /** Session cumulative counters survive lane changes independently of compatibility metrics. */
  sessionMetrics?: SessionMetricSnapshot[];
  handoffs?: HandoffJournal[];
  /** Sanitized snapshots only; excluded from the ordinary run view. */
  handoffPreviews?: HandoffPreview[];
  /** The subtasks of a dispatch step, once the run reached it. Absent for a static workflow. */
  subtasks?: SubtaskRun[];
  /** Documents archived by "Chạy lại từ đầu" right before this run; `dir` is relative to the task dir. */
  previous?: { dir: string; files: string[] };
  startedAt: number;
  updatedAt: number;
}

export interface RunView {
  /** The saved run's mode, including after done/cancelled; independent of new-run repo defaults. */
  runMode: NonNullable<WorkflowDef["mode"]> | null;
  workflow: {
    source: string;
    origin: WorkflowDef["origin"];
    /** The mode the run follows; `override`: the repo's override is part of it. */
    mode: NonNullable<WorkflowDef["mode"]>;
    historyFile: string;
    steps: Array<{
      id: string;
      title: string;
      agent: ProviderId;
      model?: string;
      effective: EffectiveExecution;
      gate: StepDef["gate"];
      doneFile: string | null;
      outputs: Array<{ id: string; file: string }>;
      /** Set on a dispatch step. */
      dispatch: { from: string; report: string; parallel: number; maxSubtasks?: number } | null;
    }>;
    /** The run follows the workflow as it was when it started, which has been edited since. */
    outdated: boolean;
  };
  /** Without the workflow/preview snapshots and internal prompt/output fences. Recovery errors remain visible. */
  run: Omit<RunState, "workflow" | "handoffPreviews"> | null;
  /** Claude's numbered questions for the reviewer, at a gate or while it waits for an answer. */
  questions: Question[];
  /** At a gate whose next step is a dispatch step: the subtasks the plan's table gives, or why it is not usable. */
  assignments: ParsedAssignments | null;
  /** Questions of each subtask that waits for an answer, by subtask number. */
  subtaskQuestions: Record<number, Question[]>;
  /** Session cumulative counters, deduplicated across steps and resume attempts. */
  usage: MetricsSummary | null;
  subtaskUsage: Record<number, MetricsSummary>;
}

/** A question Claude left for the reviewer, with the answer it proposes. */
export interface Question {
  /** The number Claude gave it. */
  n: number;
  text: string;
  proposal?: string;
}

export interface ParsedAssignments {
  items: Assignment[];
  /** Why the table cannot be run, in English; empty when `items` is usable. */
  errors: string[];
}

export interface HandoffDocument {
  kind: "spec" | "history" | "approved-plan" | "input" | "dependency-report" | "output";
  /** Omitted if the path is unsafe or itself contains a secret. Never read by this builder. */
  path?: string;
  status: "present" | "missing" | "unknown" | "omitted";
  /** An existing output is still required; existence does not prove completion for this attempt. */
  required: boolean;
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
  /** Explicit consent to stop a live source and cancel its pending approvals. */
  confirmStop?: boolean;
}

export interface HandoffPreview {
  version: 1;
  id: string;
  /** Lane revision, independent of preview time, reason, target, or unrelated lanes' progress. */
  fingerprint: string;
  createdAt: number;
  scope: LaneScope;
  sourceSessionId: string;
  expectedGeneration: number;
  source: EffectiveExecution;
  target: EffectiveExecution;
  documents: HandoffDocument[];
  reason?: string;
  /** All copies (API, journal, history, target prompt) must use these already filtered strings. */
  text: string;
  prompt: string;
}

export interface ModeInfo {
  id: string;
  name: string;
  description: string;
}
