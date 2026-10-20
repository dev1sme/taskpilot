export type ToolCategory = "read" | "write" | "run" | "search" | "web" | "agent" | "plan" | "other";

export interface ActivityItem {
  id: string;
  sessionId: string;
  taskKey: string;
  at: number;
  kind: "session" | "prompt" | "tool" | "permission" | "stop";
  summary: string;
  /** permission: what Claude asks to do, without the summary's prefix. */
  action?: string;
  detail?: string;
  tool?: string;
  category?: ToolCategory;
  status?: "running" | "done" | "error";
  durationMs?: number;
}
