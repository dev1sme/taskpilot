import { agentArgs, type LaunchOptions, type Launcher } from "../../core/launch.js";

export interface ClaudeCliOptions extends LaunchOptions {
  /** Per-session hook configuration passed through --settings. */
  settings?: string;
}

export const claudeLauncher: Launcher<ClaudeCliOptions> = (sessionId, opts) => ({
  file: process.env.TASKPILOT_CLAUDE ?? "claude",
  args: [
    // --resume keeps the original session id unless --fork-session is given (claude 2.1.x).
    ...(opts.resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
    ...(opts.settings ? ["--settings", opts.settings] : []),
    ...(opts.permissionMode ? ["--permission-mode", opts.permissionMode] : []),
    // Both again on resume: claude keeps the agent of a resumed session but not its --model (SPEC §7).
    ...agentArgs(opts),
  ],
});
