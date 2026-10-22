import type { Agent } from "../../core/agents.js";
import type { SessionView } from "../sessions/index.js";
import type { WorkflowDef } from "./types.js";
import type { SubagentInfo } from "./vars.js";

/** Loads the workflow for a new run: `mode` when given, else the repo's own choice. */
export type LoadDef = (repo: string, mode?: string) => Promise<WorkflowDef>;

/** The repo's and the user's Claude subagents with their checks; handed in so workflow does not import config. */
export type SubagentsOf = (repo: string) => Promise<SubagentInfo[]>;

/** The parts of SessionManager the engine uses. */
export interface SessionPort {
  create(repo: string, taskKey: string, opts: { permissionMode?: string; agent?: Agent; title?: string; model?: string; subagent?: string }): Promise<SessionView>;
  resume(id: string): Promise<SessionView>;
  stop(id: string): Promise<void>;
  get(id: string): Promise<SessionView>;
  paste(id: string, text: string): void;
  /** Whether the session's running process has sent a hook of its own yet. */
  hookSeen(id: string): boolean;
}
