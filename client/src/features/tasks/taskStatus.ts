import i18n from "../../i18n";
import type { TaskSummary } from "../workspace";

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

/** Status of a task: what needs the user first, then the run, then what the files say. */
export function statusOf(task: TaskSummary): { kind: StatusKind; tone: Tone; label: string; glyph: string } {
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
    case "done":
      return run("done", "done");
  }
  const { done, total } = task.stage;
  if (total > 0 && done >= total) return { kind: "complete", tone: "done", label: label("complete"), glyph: "✓" };
  const kind = done > 0 ? "progress" : "new";
  return { kind, tone: "idle", label: label(kind), glyph: "○" };
}

export function urgency(task: TaskSummary): number {
  return { attention: 2, active: 1, done: 0, idle: 0 }[statusOf(task).tone];
}

/** Needs-you first, then running, then most recently touched. */
export function sortTasks(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort((a, b) => urgency(b) - urgency(a) || b.updatedAt - a.updatedAt);
}
