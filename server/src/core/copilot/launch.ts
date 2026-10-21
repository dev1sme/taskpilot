import type { Launcher } from "../claude/launch.js";

/** Copilot flags for each workflow permission-mode; "default" keeps Copilot's own manual approval. */
const PERMISSION_FLAGS: Record<string, string[]> = {
  default: [],
  acceptEdits: ["--allow-tool=write"],
  plan: ["--mode", "plan"],
  // auto sets COPILOT_ALLOW_ALL instead (see below).
  auto: [],
};

/**
 * Checked on copilot 1.0.101: a repo's hooks load only once its folder is trusted, and without them
 * TaskPilot never hears of a finished turn. COPILOT_ALLOW_ALL=true allows every tool and trusts the
 * folder without a prompt; any other value ("1", "yes") does not trust it, so no hook loads.
 * Deliberately not --yolo/--allow-all, which also open every path and URL.
 */
const PERMISSION_ENV: Record<string, Record<string, string>> = {
  auto: { COPILOT_ALLOW_ALL: "true" },
};

/**
 * GitHub Copilot CLI (`copilot`, npm @github/copilot). --session-id both creates a session with
 * that id and resumes it (copilot 1.0.100), so `resume` needs no flag of its own. Hooks come from
 * .github/copilot/settings.local.json, not from the command line.
 */
export const copilotLauncher: Launcher = (sessionId, opts) => {
  const mode = opts.permissionMode;
  const env = mode ? PERMISSION_ENV[mode] : undefined;
  return {
    file: process.env.TASKPILOT_COPILOT ?? "copilot",
    args: ["--session-id", sessionId, ...(mode ? (PERMISSION_FLAGS[mode] ?? []) : [])],
    ...(env ? { env } : {}),
  };
};
