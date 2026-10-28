import os from "node:os";
import path from "node:path";

/** An env value counts only when it is non-empty: an empty string means "not set". */
function envPath(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** The user's Claude Code home; TASKPILOT_CLAUDE_HOME overrides where TaskPilot reads config (tests). */
export function claudeHome(): string {
  return envPath("TASKPILOT_CLAUDE_HOME") ?? path.join(os.homedir(), ".claude");
}

/** ~/.claude.json (user and local MCP servers live there). */
export function claudeJson(): string {
  return envPath("TASKPILOT_CLAUDE_JSON") ?? path.join(os.homedir(), ".claude.json");
}
