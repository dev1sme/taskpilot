export type LibraryScope = "project" | "user";

export type LibraryKind = "agents" | "commands" | "skills";

export interface LibraryItem {
  kind: LibraryKind;
  scope: LibraryScope;
  /** agents: frontmatter name or file stem; commands: path-based (git:pr); skills: directory or name. */
  name: string;
  path: string;
  /** Path inside the kind's folder (reviewer.md, git/pr.md, deploy/SKILL.md); identifies the item for edits. */
  rel: string;
  description: string;
  /** Selected frontmatter fields worth showing (tools, model, argument-hint…). */
  fields: Array<{ key: string; value: string }>;
  body: string;
  mtime: number | null;
  error?: string;
  /** skills: other files in the skill directory. */
  files?: string[];
  /** agents: whether TaskPilot can use it, and as what. */
  check?: AgentCheck;
  /** A Copilot agent in .claude/agents is visible to the CLI but cannot be edited as Copilot config. */
  editable?: boolean;
}

/**
 * How a subagent can serve a TaskPilot workflow. `leader`: called by the leader through the Task
 * tool. `member`: runs a whole subtask session (`claude --agent`), so it must write its report.
 */
export type AgentRole = "leader" | "member";

export interface AgentCheck {
  status: "ok" | "warn" | "error";
  roles: AgentRole[];
  problems: string[];
  /** Same name as a TaskPilot template: whether the file still matches it. */
  template?: "same" | "modified";
}
