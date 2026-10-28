import os from "node:os";
import path from "node:path";

/** An env value counts only when it is non-empty: an empty string means "not set". */
function envPath(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** The home the Codex CLI itself uses: CODEX_HOME, else ~/.codex. */
export function codexHome(): string {
  return envPath("CODEX_HOME") ?? path.join(os.homedir(), ".codex");
}

/** Where TaskPilot reads Codex config: TASKPILOT_CODEX_HOME (isolates tests), else the CLI home. */
export function codexConfigHome(): string {
  return envPath("TASKPILOT_CODEX_HOME") ?? codexHome();
}

/** Codex discovers personal skills under ~/.agents/skills, separate from CODEX_HOME. */
export function codexSkillsHome(): string {
  return envPath("TASKPILOT_CODEX_SKILLS_HOME") ?? path.join(os.homedir(), ".agents", "skills");
}
