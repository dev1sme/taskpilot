import type { Agent } from "../../shared/agents";

/** How far a task got, read by the server from the documents its workflow declares. */
export interface Stage {
  done: number;
  total: number;
  /** Title of the furthest step done; null when none is. */
  step: string | null;
}

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
  /** The decision log's file name, from the workflow. */
  historyFile: string;
  specFiles: TaskFile[];
  outputFiles: TaskFile[];
  updatedAt: number;
  run: { phase: RunPhase; stepIndex: number; stepStartedAt: number } | null;
  waitingPermission: boolean;
  sessionsRunning: number;
  /** Marked done: task.yml says so, or (without the file) the run finished; `at` is unknown in that case. */
  done: { at: number | null } | null;
}

export interface Info {
  claudeVersion: string | null;
  /** Version of each agent's command; null when it is not installed. */
  versions?: Partial<Record<Agent, string | null>>;
}

/** Read-only summary of the repo's Claude Code configuration. */
export interface Inventory {
  claudeMd: { exists: boolean; lines: number; bytes: number; mtime: number | null; headings: string[] };
  claudeLocalMd: boolean;
  mcp: { exists: boolean; servers: Array<{ name: string; type: string }>; error?: string };
  claudeDir: { agents: number; commands: number; skills: number; hooks: number; allow: number; deny: number };
}

export interface RepoInfo {
  path: string | null;
  tasksDir: string | null;
  tasksDirExists: boolean;
}
