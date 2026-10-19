export type Stage = "new" | "investigated" | "planned" | "implementing" | "summarized";

export type RunPhase = "starting" | "running" | "waiting" | "gate" | "interrupted" | "done" | "cancelled";

export interface TaskFile {
  path: string;
  size: number;
  mtime: number;
}

export interface TaskSummary {
  key: string;
  title: string;
  stage: Stage;
  specFiles: TaskFile[];
  outputFiles: TaskFile[];
  updatedAt: number;
  run: { phase: RunPhase; stepIndex: number } | null;
  waitingPermission: boolean;
}

export interface RunState {
  taskKey: string;
  sessionId: string;
  stepIndex: number;
  phase: RunPhase;
  message: string;
  lastMessage?: string;
  stepStartedAt: number;
  startedAt: number;
  updatedAt: number;
}

export interface WorkflowStep {
  id: string;
  title: string;
  gate: "approve" | "none";
  doneFile: string | null;
}

export interface RunView {
  workflow: { source: string; steps: WorkflowStep[] };
  run: RunState | null;
}

export interface SessionView {
  id: string;
  taskKey: string;
  title: string;
  createdAt: number;
  status: "running" | "exited";
  exitCode: number | null;
  activity: "starting" | "idle" | "busy" | "permission" | null;
}

export interface RepoInfo {
  path: string | null;
  tasksDir: string | null;
  tasksDirExists: boolean;
}

export type ToolCategory = "read" | "write" | "run" | "search" | "web" | "agent" | "plan" | "other";

export interface ActivityItem {
  id: string;
  sessionId: string;
  taskKey: string;
  at: number;
  kind: "session" | "prompt" | "tool" | "permission" | "stop";
  summary: string;
  detail?: string;
  tool?: string;
  category?: ToolCategory;
  status?: "running" | "done" | "error";
  durationMs?: number;
}
