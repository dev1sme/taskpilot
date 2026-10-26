export interface LaunchOptions {
  resume: boolean;
  /** JSON with the hooks: claude takes it as --settings, codex turns it into -c hooks.*; other agents get their hooks from a file instead. */
  settings?: string;
  permissionMode?: string;
  /** --model; absent = the subagent's model, else the user's default. */
  model?: string;
  /** --agent: the whole session runs as this subagent (its prompt, tools and model). */
  subagent?: string;
  /** Working directory of the session; Codex reads its custom agents (`<repo>/.codex/agents`) from it. */
  repo?: string;
  /** The agent's own id of the conversation, when it names sessions itself (Codex: thread id); `resume` needs it. */
  nativeId?: string;
  /** Codex only: approval reviewer and sandbox network, from `codex:` in workflow.yml. */
  codex?: { approvalsReviewer?: "user" | "auto_review"; networkAccess?: boolean };
}

export interface LaunchSpec {
  file: string;
  args: string[];
  /** Variables for the child on top of the inherited ones. */
  env?: Record<string, string>;
}

/** Builds the command for a session; injectable so tests can run a plain shell instead of the agent CLI. */
export type Launcher = (sessionId: string, opts: LaunchOptions) => LaunchSpec;

/** --agent / --model, which claude and copilot spell the same way. */
export function agentArgs(opts: Pick<LaunchOptions, "model" | "subagent">): string[] {
  return [...(opts.subagent ? ["--agent", opts.subagent] : []), ...(opts.model ? ["--model", opts.model] : [])];
}

/**
 * Environment for the child. Inherited CLAUDE* variables (set when TaskPilot itself is started
 * from inside a Claude Code session) make claude run as a child session that never writes its
 * transcript; see docs/SPEC.md §7. The UI token and login must not reach sessions.
 */
const UI_SECRETS = new Set(["TASKPILOT_TOKEN", "TASKPILOT_AUTH_USER", "TASKPILOT_AUTH_PASSWORD"]);

export function childEnv(base: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !key.startsWith("CLAUDE") && !UI_SECRETS.has(key)) env[key] = value;
  }
  env.COLORTERM = "truecolor";
  return { ...env, ...extra };
}
