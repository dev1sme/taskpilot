import { createCliVersionReader } from "../../core/cli-version.js";

/** `copilot --version` once per server run ("GitHub Copilot CLI 1.0.100."); null when missing. */
export const copilotVersion = createCliVersionReader(
  () => process.env.TASKPILOT_COPILOT ?? "copilot",
  (stdout) => /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? null,
);
