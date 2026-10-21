export interface LaunchOptions {
  resume: boolean;
  /** JSON for --settings (hooks); agents without such a flag get their hooks from a file instead. */
  settings?: string;
  permissionMode?: string;
}

export interface LaunchSpec {
  file: string;
  args: string[];
  /** Variables for the child on top of the inherited ones. */
  env?: Record<string, string>;
}

/** Builds the command for a session; injectable so tests can run a plain shell instead of claude. */
export type Launcher = (sessionId: string, opts: LaunchOptions) => LaunchSpec;

export const claudeLauncher: Launcher = (sessionId, opts) => ({
  file: process.env.TASKPILOT_CLAUDE ?? "claude",
  args: [
    // --resume keeps the original session id unless --fork-session is given (claude 2.1.x).
    ...(opts.resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
    ...(opts.settings ? ["--settings", opts.settings] : []),
    ...(opts.permissionMode ? ["--permission-mode", opts.permissionMode] : []),
  ],
});

/**
 * Environment for the child. Inherited CLAUDE* variables (set when TaskPilot itself is started
 * from inside a Claude Code session) make claude run as a child session that never writes its
 * transcript; see docs/SPEC.md §7. The UI token and login must not reach sessions.
 */
const UI_SECRETS = new Set(["TASKPILOT_TOKEN", "TASKPILOT_AUTH_USER", "TASKPILOT_AUTH_PASSWORD"]);

export function childEnv(
  base: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !key.startsWith("CLAUDE") && !UI_SECRETS.has(key)) env[key] = value;
  }
  env.COLORTERM = "truecolor";
  return { ...env, ...extra };
}
