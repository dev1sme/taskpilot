import { createCliVersionReader } from "../cli-version.js";

/** `claude --version` once per server run; null when the command is missing or fails. */
export const claudeVersion = createCliVersionReader(
  () => process.env.TASKPILOT_CLAUDE ?? "claude",
  (stdout) => stdout.trim().split(/\s+/)[0] ?? null,
);
