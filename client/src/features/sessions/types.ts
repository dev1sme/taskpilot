import type { Agent } from "../../shared/agents";

/** Session key of the repo terminal (sessions without a task); mirrors server/src/modules/tasks/scan.ts. */
export const REPO_SESSION_KEY = "@repo";

export interface SessionView {
  transport: "pty" | "rpc";
  id: string;
  taskKey: string;
  title: string;
  agent: Agent;
  createdAt: number;
  status: "running" | "exited";
  exitCode: number | null;
  activity: "starting" | "idle" | "busy" | "permission" | null;
}

export interface ConversationItem {
  id: string;
  kind: "user" | "agent" | "tool" | "approval" | "error";
  text: string;
  detail?: string;
  status?: "running" | "done" | "failed" | "pending" | "accepted" | "declined" | "cancelled";
  requestId?: string;
  at: number;
}
