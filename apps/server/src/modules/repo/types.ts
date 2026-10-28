import type { ProviderId } from "@taskpilot/shared";

/** The repo the UI works on; nulls before one is chosen. */
export interface RepoInfo {
  path: string | null;
  tasksDir: string | null;
  tasksDirExists: boolean;
}

/** Version of each agent's command; null when it is not installed. */
export interface ServerInfo {
  claudeVersion: string | null;
  versions: Record<ProviderId, string | null>;
}

/** Read-only summary of the repo's Claude Code configuration, for the overview page. */
export interface Inventory {
  claudeMd: { exists: boolean; lines: number; bytes: number; mtime: number | null; headings: string[] };
  claudeLocalMd: boolean;
  mcp: { exists: boolean; servers: Array<{ name: string; type: string }>; error?: string };
  claudeDir: { agents: number; commands: number; skills: number; hooks: number; allow: number; deny: number };
}
