import { claudeLauncher } from "../../../core/claude/launch.js";
import { hookSettings } from "../hooks.js";
import type { AgentBackend } from "./types.js";

/** Claude Code: hooks and status line go in with --settings; payloads are already in the shape TaskPilot reads. */
export const claudeBackend: AgentBackend = {
  id: "claude",
  launcher: claudeLauncher,
  launchSettings: hookSettings,
};
