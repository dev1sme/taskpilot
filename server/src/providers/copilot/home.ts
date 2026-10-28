import os from "node:os";
import path from "node:path";
import { envPath } from "../../core/values.js";

/** The home the Copilot CLI itself uses (hooks, session-state, agents): COPILOT_HOME, else ~/.copilot. */
export function copilotHome(): string {
  return envPath("COPILOT_HOME") ?? path.join(os.homedir(), ".copilot");
}

/** Where TaskPilot reads Copilot config: TASKPILOT_COPILOT_HOME (isolates tests), else the CLI home. */
export function copilotConfigHome(): string {
  return envPath("TASKPILOT_COPILOT_HOME") ?? copilotHome();
}
