import type { RunPhase } from "../workspace";

export interface RunState {
  taskKey: string;
  sessionId: string;
  stepIndex: number;
  phase: RunPhase;
  message: string;
  lastMessage?: string;
  stepStartedAt: number;
  startedAt: number;
  updatedAt: number;
}

export interface WorkflowStep {
  id: string;
  title: string;
  gate: "approve" | "none";
  doneFile: string | null;
}

export interface RunView {
  workflow: { source: string; steps: WorkflowStep[] };
  run: RunState | null;
}
