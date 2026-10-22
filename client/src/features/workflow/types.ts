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
  /** The step's agent sent no hook for a while, so TaskPilot cannot tell when it is done. */
  noHook?: boolean;
  startedAt: number;
  updatedAt: number;
  /** Set while a dispatch step runs (and after it): one entry per row of the plan's assignment table. */
  subtasks?: SubtaskRun[];
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
}

export interface RunView {
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
}
