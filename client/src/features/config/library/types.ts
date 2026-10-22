export type LibraryKind = "agents" | "commands" | "skills";

/** How a subagent can serve a TaskPilot workflow: `leader` calls it through the Task tool, `member` runs a whole subtask as it. */
export type AgentRole = "leader" | "member";

/** What TaskPilot found when it checked an agent file; problems are already in the UI language. */
export interface AgentCheck {
  status: "ok" | "warn" | "error";
  roles: AgentRole[];
  problems: string[];
  /** Same name as a TaskPilot template: whether the file still matches it. */
  template?: "same" | "modified";
}

export interface LibraryItem {
  kind: LibraryKind;
  scope: "project" | "user";
  name: string;
  path: string;
  rel: string;
  description: string;
  fields: Array<{ key: string; value: string }>;
  body: string;
  mtime: number | null;
  error?: string;
  files?: string[];
  /** Agents only. */
  check?: AgentCheck;
}

/** A subagent TaskPilot ships and how it compares with the repo's .claude/agents/<name>.md. */
export interface AgentTemplate {
  name: string;
  rel: string;
  description: string;
  path: string;
  exists: boolean;
  same: boolean;
  /** Hash of the repo's file, sent back when overwriting it. */
  hash: string;
}

export interface TemplateInstallResult {
  files: string[];
  skipped: string[];
}
