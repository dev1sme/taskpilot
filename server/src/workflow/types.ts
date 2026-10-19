export interface StepDef {
  id: string;
  title: string;
  /** Prompt template text, already loaded. */
  prompt: string;
  /** The step is complete when this file (relative to the task dir) was written during the step. */
  doneWhen?: { file: string };
  gate: "approve" | "none";
  /** Template sent with the reviewer's feedback when a gate is rejected. */
  onReject?: string;
}

export interface WorkflowDef {
  /** Where it was loaded from, for display. */
  source: string;
  permissionMode?: string;
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
  /** Prompt to send once the session reports SessionStart. */
  pendingPrompt?: string;
  startedAt: number;
  updatedAt: number;
}
