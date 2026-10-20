/** Session key of the repo terminal (sessions without a task); mirrors server/src/modules/tasks/scan.ts. */
export const REPO_SESSION_KEY = "@repo";

export interface SessionView {
  id: string;
  taskKey: string;
  title: string;
  createdAt: number;
  status: "running" | "exited";
  exitCode: number | null;
  activity: "starting" | "idle" | "busy" | "permission" | null;
}
