import type { Stage, TaskSummary } from "../../api/types";

export type Tone = "attention" | "active" | "done" | "idle";

const STAGE_LABEL: Record<Stage, string> = {
  new: "Chưa chạy",
  investigated: "Đã điều tra",
  planned: "Có kế hoạch",
  implementing: "Đang code",
  summarized: "Có tóm tắt",
};

/** Status of a task: what needs the user first, then the run, then what the files say. */
export function statusOf(task: TaskSummary): { tone: Tone; label: string; glyph: string } {
  if (task.waitingPermission) return { tone: "attention", label: "Xin quyền", glyph: "✋" };
  switch (task.run?.phase) {
    case "gate":
      return { tone: "attention", label: "Chờ duyệt", glyph: "◆" };
    case "waiting":
      return { tone: "attention", label: "Chờ trả lời", glyph: "?" };
    case "interrupted":
      return { tone: "attention", label: "Gián đoạn", glyph: "!" };
    case "starting":
    case "running":
      return { tone: "active", label: "Đang chạy", glyph: "●" };
    case "done":
      return { tone: "done", label: "Hoàn tất", glyph: "✓" };
  }
  return task.stage === "summarized"
    ? { tone: "done", label: STAGE_LABEL[task.stage], glyph: "✓" }
    : { tone: "idle", label: STAGE_LABEL[task.stage], glyph: "○" };
}

export function urgency(task: TaskSummary): number {
  return { attention: 2, active: 1, done: 0, idle: 0 }[statusOf(task).tone];
}

/** Needs-you first, then running, then most recently touched. */
export function sortTasks(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort((a, b) => urgency(b) - urgency(a) || b.updatedAt - a.updatedAt);
}
