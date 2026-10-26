import { agentArgs, type Launcher } from "../launch.js";

/** Copilot flags for each workflow permission-mode; "default" keeps Copilot's own manual approval. */
const PERMISSION_FLAGS: Record<string, string[]> = {
  default: [],
  acceptEdits: ["--allow-tool=write"],
  plan: ["--mode", "plan"],
  // auto sets COPILOT_ALLOW_ALL instead (see below).
  auto: [],
};

/**
 * Checked on copilot 1.0.101: COPILOT_ALLOW_ALL=true allows every tool without a prompt; any other
 * value ("1", "yes") does not. Deliberately not --yolo/--allow-all, which also open every path and URL.
 */
const PERMISSION_ENV: Record<string, Record<string, string>> = {
  auto: { COPILOT_ALLOW_ALL: "true" },
};

/** Tells the user-level hooks (hooks/taskpilot.json) that TaskPilot, not a hand-started Copilot, runs this one. */
const HOOK_AGENT_ENV = { TASKPILOT_HOOK_AGENT: "copilot" };

/**
 * GitHub Copilot CLI (`copilot`, npm @github/copilot). --session-id both creates a session with
 * that id and resumes it (copilot 1.0.100), so `resume` needs no flag of its own. Hooks come from
 * the user-level hooks/taskpilot.json, not from the command line.
 */
export const copilotLauncher: Launcher = (sessionId, opts) => {
  const mode = opts.permissionMode;
  const env = { ...HOOK_AGENT_ENV, ...(mode ? PERMISSION_ENV[mode] : undefined) };
  return {
    file: process.env.TASKPILOT_COPILOT ?? "copilot",
    args: ["--session-id", sessionId, ...(mode ? (PERMISSION_FLAGS[mode] ?? []) : []), ...agentArgs(opts)],
    env,
  };
};
