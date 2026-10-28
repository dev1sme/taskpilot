import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PROVIDER_LABELS, DEFAULT_PROVIDER, type ProviderId } from "../../core/providers.js";
import { TASKS_DIR } from "../tasks/index.js";
import { t } from "../../core/i18n.js";
import { resolveExecution } from "./execution.js";
import type { OutputBaseline, RunPhase, RunState, SubtaskPhase, WorkflowDef } from "./types.js";

/**
 * What the engine drives in one session: the run itself (the leader) or one of its subtasks. Both
 * hold the same fields, so delivering a prompt and reading a hook work the same way for either.
 */
export interface Lane {
  sessionId?: string;
  phase: RunPhase | SubtaskPhase;
  stepStartedAt?: number;
  promptId?: string;
  outputBaseline?: OutputBaseline;
  recoveryBlocked?: boolean;
  /** A subtask's first prompt; the run's own is set once when it begins. */
  startedAt?: number;
  pendingPrompt?: string;
  sentPrompt?: { stepIndex: number; text: string; at: number; sessionId?: string };
  lastMessage?: string;
  noHook?: boolean;
}

export const MTIME_SLACK_MS = 100;
export const ACTIVE_RUN_PHASES: ReadonlyArray<RunState["phase"]> = ["starting", "running", "waiting", "gate", "interrupted"];

/** The run itself when `sessionId` is its leader's session, else the subtask that session works on. */
export function laneOf(run: RunState, sessionId: string): Lane | undefined {
  return run.sessionId === sessionId ? run : run.subtasks?.find((s) => s.sessionId === sessionId);
}

/** The run is at its dispatch step: subtasks are being handed out and worked on. */
export function dispatching(run: RunState, def: WorkflowDef): boolean {
  return !!run.subtasks && !!def.steps[run.stepIndex]?.dispatch;
}

export function withoutSnapshot(run: RunState): Omit<RunState, "workflow" | "handoffPreviews"> {
  const { workflow: _workflow, handoffPreviews: _handoffPreviews, outputBaseline: _baseline, promptId: _promptId, ...rest } = run;
  if (rest.subtasks) rest.subtasks = rest.subtasks.map(({ outputBaseline: _baseline, promptId: _promptId, ...sub }) => sub);
  return rest;
}

/** Name of the agent that runs the run's current step, for run messages. */
export function agentLabel(run: RunState): string {
  if (run.workflow) return PROVIDER_LABELS[resolveExecution({ workflow: run.workflow, run, scope: { kind: "step", stepId: run.workflow.steps[run.stepIndex].id } }).agent];
  return PROVIDER_LABELS[DEFAULT_PROVIDER];
}

export function taskAbsoluteDir(run: RunState): string {
  return path.join(run.repo, TASKS_DIR, run.taskKey);
}

/** An agent with the model its session runs, for the decision log: "Claude (opus)", or "Claude" for its default. */
export function sessionLabel(agent: ProviderId, model?: string): string {
  return model ? `${PROVIDER_LABELS[agent]} (${model})` : PROVIDER_LABELS[agent];
}

/** The run's own phase and message while its subtasks work: the one needing attention first. */
export function syncDispatch(run: RunState): void {
  const subs = run.subtasks ?? [];
  const interrupted = subs.find((s) => s.phase === "interrupted");
  const waiting = subs.find((s) => s.phase === "waiting");
  const silent = subs.find((s) => s.noHook && (s.phase === "running" || s.phase === "starting"));
  const done = subs.filter((s) => s.phase === "done").length;
  if (interrupted) Object.assign(run, { phase: "interrupted", message: t("run.subtaskInterrupted", { n: interrupted.n }) });
  else if (waiting) Object.assign(run, { phase: "waiting", message: t("run.subtaskWaiting", { n: waiting.n, file: waiting.report }) });
  else if (silent) Object.assign(run, { phase: "running", message: t("run.subtaskNoHook", { n: silent.n, agent: PROVIDER_LABELS[silent.agent], file: silent.report }) });
  else Object.assign(run, { phase: "running", message: t("run.dispatching", { done, total: subs.length }) });
}

/** An unreadable baseline must block delivery, rather than treating the old report as absent. */
export async function outputBaseline(run: RunState, file: string): Promise<OutputBaseline> {
  try {
    const target = path.join(taskAbsoluteDir(run), file);
    const metadata = await stat(target);
    if (!metadata.isFile()) throw new Error(`Output is not a file: ${file}`);
    const digest = createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
    return { file, fingerprint: [metadata.dev, metadata.ino, metadata.size, metadata.mtimeMs, metadata.ctimeMs, digest].join(":") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { file, fingerprint: null };
    throw error;
  }
}

/** A blocked/unfinished transfer fences the lane even if its source has already been unlocked. */
export function laneBlocked(run: RunState, lane: Lane): boolean {
  if (lane.recoveryBlocked) return true;
  const stepId = run.workflow?.steps[run.stepIndex]?.id;
  return !!run.handoffs?.some(
    (operation) =>
      operation.scope.stepId === stepId &&
      (lane === run ? operation.scope.kind === "step" : operation.scope.kind === "subtask" && operation.scope.n === (lane as { n?: number }).n) &&
      (operation.cleanup === "blocked" || !["committed", "failed"].includes(operation.stage)),
  );
}

export async function writtenSince(run: RunState, file: string, since: number = run.stepStartedAt, lane: Lane = run): Promise<boolean> {
  try {
    const s = await stat(path.join(taskAbsoluteDir(run), file));
    if (lane.outputBaseline?.file === file) {
      const current = await outputBaseline(run, file);
      if (current.fingerprint === lane.outputBaseline.fingerprint) return false;
    }
    // File timestamps come from the kernel's coarse clock and can trail Date.now() by a few ms.
    return s.mtimeMs >= since - MTIME_SLACK_MS;
  } catch {
    return false;
  }
}
