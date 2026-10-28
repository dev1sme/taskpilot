import type { TaskListItem } from "@server/api-types";
import i18n from "@/i18n";

export type RunPhase = NonNullable<TaskListItem["run"]>["phase"];

/** Phases between a run's start and its end: the task can be neither marked done nor reopened. */
export const ACTIVE_PHASES = ["starting", "running", "waiting", "gate", "interrupted"] as const satisfies readonly RunPhase[];

export type Tone = "attention" | "active" | "done" | "idle";
/** What needs the user: a permission prompt, a gate to approve, a question, an interrupted run. */
export type AttentionKind = "permission" | "gate" | "waiting" | "interrupted";
/** What the documents say when no run needs attention: no step done yet, some, or all. */
type StageKind = "new" | "progress" | "complete";
export type StatusKind = AttentionKind | "running" | "done" | StageKind;

export interface TaskStatusView {
  kind: StatusKind;
  tone: Tone;
  label: string;
  /** Why a complete-looking task is not done yet. */
  title?: string;
}

/** Status of a task: what needs the user first, then the run, then whether it was marked done, then the files. */
export function statusOf(task: TaskListItem): TaskStatusView {
  const label = (kind: StatusKind) => i18n.t(`status.${kind}`, { ns: "tasks", ...task.stage });
  const run = (kind: StatusKind, tone: Tone): TaskStatusView => ({ kind, tone, label: label(kind) });
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
  const title = kind === "complete" ? i18n.t("status.completeTitle", { ns: "tasks", total }) : undefined;
  return { ...run(kind, "idle"), title };
}

export function runActive(task: TaskListItem): boolean {
  return task.run !== null && (ACTIVE_PHASES as readonly string[]).includes(task.run.phase);
}

const URGENCY: Record<Tone, number> = { attention: 2, active: 1, idle: 0, done: -1 };

/** Needs-you first, then running, then most recently touched; done tasks last. */
export function sortTasks(tasks: TaskListItem[]): TaskListItem[] {
  return [...tasks].sort((a, b) => URGENCY[statusOf(b).tone] - URGENCY[statusOf(a).tone] || b.updatedAt - a.updatedAt);
}

export type TaskFilter = "open" | "attention" | "running" | "done" | "all";

export function matchesFilter(task: TaskListItem, filter: TaskFilter): boolean {
  const status = statusOf(task);
  if (filter === "all") return true;
  if (filter === "attention") return status.tone === "attention";
  if (filter === "running") return status.tone === "active";
  return (status.kind === "done") === (filter === "done");
}

/** Lowercase without Vietnamese diacritics, so "chờ duyệt" matches "cho duyet". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}
