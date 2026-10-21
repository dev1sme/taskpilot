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
  /** Documents archived by "Chạy lại từ đầu" right before this run; `dir` is relative to the task dir. */
  previous?: { dir: string; files: string[] };
  startedAt: number;
  updatedAt: number;
}
