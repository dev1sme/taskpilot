export interface LaunchSpec {
  file: string;
  args: string[];
}

/** Builds the command for a session; injectable so tests can run a plain shell instead of claude. */
export type Launcher = (sessionId: string, resume: boolean) => LaunchSpec;

export const claudeLauncher: Launcher = (sessionId, resume) => ({
  file: process.env.TASKPILOT_CLAUDE ?? "claude",
  // --resume keeps the original session id unless --fork-session is given (claude 2.1.x).
  args: resume ? ["--resume", sessionId] : ["--session-id", sessionId],
});

/**
 * Environment for the child. Inherited CLAUDE* variables (set when TaskPilot itself is started
 * from inside a Claude Code session) make claude run as a child session that never writes its
 * transcript; see docs/SPEC.md §7.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !key.startsWith("CLAUDE")) env[key] = value;
  }
  env.COLORTERM = "truecolor";
  return env;
}
