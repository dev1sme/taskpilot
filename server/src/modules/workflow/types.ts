import type { Agent } from "../../core/agents.js";

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
}

/** One row of the assignment table. */
export interface Assignment {
  n: number;
  title: string;
  agent: Agent;
  /** Files or directories the subtask may change; used to keep parallel subtasks apart. */
  files: string[];
  output: string;
  /** Numbers of the subtasks that must be done first. */
  deps: number[];
}

/** pending: not started; starting/running/waiting/interrupted/done as for a run (done: its report was written). */
export type SubtaskPhase = "pending" | "starting" | "running" | "waiting" | "done" | "interrupted";

export interface SubtaskRun extends Assignment {
  phase: SubtaskPhase;
  sessionId?: string;
  stepStartedAt?: number;
  pendingPrompt?: string;
  sentPrompt?: { stepIndex: number; text: string; at: number };
  lastMessage?: string;
  /** Report file name inside the task directory. */
  report: string;
}

export interface StepDef {
  id: string;
  title: string;
  /** The agent that runs this step: the step's own `agent`, else the workflow's. */
  agent: Agent;
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
  /** The repo's override in .claude/taskpilot/, or TaskPilot's built-in workflow. */
  origin: "repo" | "default";
  /** Directory holding workflow.yml and its prompt files. */
  dir: string;
  /** Default agent of the steps (`agent` at the top of workflow.yml); claude when absent. */
  agent: Agent;
  permissionMode?: string;
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
  message: string;
  /** Claude's last message of the latest turn (Stop hook), shown at gates. */
  lastMessage?: string;
  /** The latest prompt pasted into the session, as sent: a real task's prompt, not a preview. */
  sentPrompt?: { stepIndex: number; text: string; at: number };
  /** Prompt to send once the session reports SessionStart. */
  pendingPrompt?: string;
  /** The workflow as it was when the run started; later edits apply to new runs only. */
  workflow?: WorkflowDef;
  /** The subtasks of a dispatch step, once the run reached it. Absent for a static workflow. */
  subtasks?: SubtaskRun[];
  /** Documents archived by "Chạy lại từ đầu" right before this run; `dir` is relative to the task dir. */
  previous?: { dir: string; files: string[] };
  startedAt: number;
  updatedAt: number;
}
