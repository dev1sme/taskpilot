export interface LaunchOptions {
  resume: boolean;
  permissionMode?: string;
  /** --model; absent = the subagent's model, else the user's default. */
  model?: string;
  /** Custom agent for the whole session. */
  subagent?: string;
  /** Working directory of the session. */
  repo?: string;
  /** Directories outside the working directory the agent may use (`--add-dir`, which all three CLIs take). */
  extraDirs?: string[];
}

export interface LaunchSpec {
  file: string;
  args: string[];
  /** Variables for the child on top of the inherited ones. */
  env?: Record<string, string>;
}

/** Builds the command for a session; injectable so tests can run a plain shell instead of the agent CLI. */
export type Launcher<Options extends LaunchOptions = LaunchOptions> = (sessionId: string, opts: Options) => LaunchSpec;

/** --agent / --model, which claude and copilot spell the same way. */
export function agentArgs(opts: Pick<LaunchOptions, "model" | "subagent">): string[] {
  return [...(opts.subagent ? ["--agent", opts.subagent] : []), ...(opts.model ? ["--model", opts.model] : [])];
}

/** One `--add-dir <dir>` per extra directory. */
export function addDirArgs(opts: Pick<LaunchOptions, "extraDirs">): string[] {
  return (opts.extraDirs ?? []).flatMap((dir) => ["--add-dir", dir]);
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
