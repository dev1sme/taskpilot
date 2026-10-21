import type { Launcher } from "../claude/launch.js";

/** Copilot flags for each workflow permission-mode; "default" keeps Copilot's own manual approval. */
const PERMISSION_FLAGS: Record<string, string[]> = {
  default: [],
  acceptEdits: ["--allow-tool=write"],
  plan: ["--mode", "plan"],
  // Not --yolo/--allow-all: those also open every path and URL, wider than Claude's auto mode.
  auto: ["--allow-all-tools"],
};

/**
 * GitHub Copilot CLI (`copilot`, npm @github/copilot). --session-id both creates a session with
 * that id and resumes it (copilot 1.0.100), so `resume` needs no flag of its own. Hooks come from
 * .github/copilot/settings.local.json, not from the command line.
 */
export const copilotLauncher: Launcher = (sessionId, opts) => ({
  file: process.env.TASKPILOT_COPILOT ?? "copilot",
  args: ["--session-id", sessionId, ...(opts.permissionMode ? (PERMISSION_FLAGS[opts.permissionMode] ?? []) : [])],
});
