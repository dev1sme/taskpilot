import i18n from "../../i18n";
import type { TaskSummary } from "../workspace";
import { ACTIVE_PHASES } from "../workflow";

export type Tone = "attention" | "active" | "done" | "idle";

/** What the status is about, independent of the language it is shown in. */
export type AttentionKind = "permission" | "gate" | "waiting" | "interrupted";
/** What the documents say when no run needs attention: no step done yet, some, or all. */
type StageKind = "new" | "progress" | "complete";
export type StatusKind = AttentionKind | "running" | "done" | StageKind;

const ATTENTION: readonly StatusKind[] = ["permission", "gate", "waiting", "interrupted"];

export function isAttention(kind: StatusKind): kind is AttentionKind {
  return ATTENTION.includes(kind);
}

const GLYPH: Record<Exclude<StatusKind, StageKind>, string> = {
  permission: "✋",
  gate: "◆",
  waiting: "?",
  interrupted: "!",
  running: "●",
  done: "✓",
};

/** Status of a task: what needs the user first, then the run, then whether it was marked done, then the files. */
export function statusOf(task: TaskSummary): { kind: StatusKind; tone: Tone; label: string; glyph: string; title?: string } {
  const label = (kind: StatusKind) => i18n.t(`status.${kind}`, { ns: "tasks", ...task.stage });
  const run = (kind: Exclude<StatusKind, StageKind>, tone: Tone) => ({ kind, tone, label: label(kind), glyph: GLYPH[kind] });
  if (task.waitingPermission) return run("permission", "attention");
  switch (task.run?.phase) {
    case "gate":
      return run("gate", "attention");
    case "waiting":
      return run("waiting", "attention");
    case "interrupted":
      return run("interrupted", "attention");
    case "starting":
    case "running":
      return run("running", "active");
  }
  // The server already falls back to a finished run when task.yml is missing.
  if (task.done) return run("done", "done");
  // Every document is there, but nobody confirmed the task is done: not the done tone.
  const { done, total } = task.stage;
  const kind = total > 0 && done >= total ? "complete" : done > 0 ? "progress" : "new";
  // The short label fits a chip; the title says what is still missing.
  const title = kind === "complete" ? i18n.t("status.completeTitle", { ns: "tasks", total }) : undefined;
  return { kind, tone: "idle", label: label(kind), glyph: "○", title };
}

/** A run between start and its end: the task can be neither marked done nor reopened. */
export function runActive(task: TaskSummary): boolean {
  return task.run !== null && ACTIVE_PHASES.includes(task.run.phase);
}

export function urgency(task: TaskSummary): number {
  return { attention: 2, active: 1, idle: 0, done: -1 }[statusOf(task).tone];
}

/** Needs-you first, then running, then most recently touched; done tasks last. */
export function sortTasks(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort((a, b) => urgency(b) - urgency(a) || b.updatedAt - a.updatedAt);
}

export type TaskFilter = "open" | "done" | "all";

export function matchesFilter(task: TaskSummary, filter: TaskFilter): boolean {
  if (filter === "all") return true;
  return (statusOf(task).kind === "done") === (filter === "done");
}
