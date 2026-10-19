import type { Stage, TaskSummary } from "../../api/types";

export type Tone = "attention" | "active" | "done" | "idle";

const STAGE_LABEL: Record<Stage, string> = {
  new: "Chưa chạy",
  investigated: "Đã điều tra",
  planned: "Có kế hoạch",
  implementing: "Đang code",
  summarized: "Có tóm tắt",
};

/** What a task shows in the list: what needs the user first, then the run, then the files. */
export function statusOf(task: TaskSummary): { tone: Tone; label: string } {
  if (task.waitingPermission) return { tone: "attention", label: "Xin quyền" };
  switch (task.run?.phase) {
    case "gate":
      return { tone: "attention", label: "Chờ duyệt" };
    case "waiting":
      return { tone: "attention", label: "Chờ trả lời" };
    case "interrupted":
      return { tone: "attention", label: "Gián đoạn" };
    case "starting":
    case "running":
      return { tone: "active", label: "Đang chạy" };
    case "done":
      return { tone: "done", label: "Hoàn tất" };
  }
  return { tone: task.stage === "summarized" ? "done" : "idle", label: STAGE_LABEL[task.stage] };
}

export function urgency(task: TaskSummary): number {
  return { attention: 2, active: 1, done: 0, idle: 0 }[statusOf(task).tone];
}
