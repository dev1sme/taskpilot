import type { RunPhase } from "../workflow/types";

export type Stage = "new" | "investigated" | "planned" | "implementing" | "summarized";

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
  run: { phase: RunPhase; stepIndex: number; stepStartedAt: number } | null;
  waitingPermission: boolean;
  sessionsRunning: number;
}

export interface Info {
  claudeVersion: string | null;
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
