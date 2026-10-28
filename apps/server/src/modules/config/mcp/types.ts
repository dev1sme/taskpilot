export type McpScope = "project" | "local" | "user";

export interface McpServer {
  name: string;
  scope: McpScope;
  type: string;
  command?: string;
  args: string[];
  url?: string;
  env: Array<{ key: string; value: string; reference: boolean }>;
  headers: Array<{ key: string; value: string; reference: boolean }>;
  /** ${VAR} references set neither in TaskPilot's environment nor in its env store. */
  missingEnv: string[];
  /** ${VAR} references TaskPilot provides to its sessions from its env store. */
  fromTaskPilot: string[];
  /** Why Claude Code skips this entry, e.g. a `url` without a `type`. */
  error?: string;
  source?: string;
  editable?: boolean;
  effective?: boolean;
}

export interface McpConfig {
  sources: Array<{ scope: McpScope; path: string; exists: boolean; error?: string }>;
  servers: McpServer[];
}
