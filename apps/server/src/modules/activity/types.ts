import type { ToolCategory } from "./describe.js";

export type ActivityKind = "session" | "prompt" | "tool" | "permission" | "stop";

export interface ActivityItem {
  id: string;
  sessionId: string;
  taskKey: string;
  at: number;
  kind: ActivityKind;
  summary: string;
  /** permission: what Claude asks to do, the summary without its "asks for permission" prefix. */
  action?: string;
  detail?: string;
  tool?: string;
  category?: ToolCategory;
  status?: "running" | "done" | "error";
  durationMs?: number;
}
