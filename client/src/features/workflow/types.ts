import type { Agent } from "../../shared/agents";
import type { RunPhase } from "../workspace";

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
  startedAt: number;
  updatedAt: number;
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
  gate: "approve" | "none";
  doneFile: string | null;
  /** Documents the step writes, from the workflow. */
  outputs: Array<{ id: string; file: string }>;
}

export interface RunView {
  workflow: {
    source: string;
    origin: "repo" | "default";
    historyFile: string;
    steps: WorkflowStep[];
    /** The run follows the workflow as it was when it started, which has been edited since. */
    outdated: boolean;
  };
  run: RunState | null;
  /** Claude's questions at a gate or while it waits. */
  questions: Question[];
}
