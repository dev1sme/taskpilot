import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { overrideDir } from "./definition.js";

/** The repo's own choice of workflow mode, next to its override: `<repo>/.taskpilot/settings.yml`. */
export const SETTINGS_FILE = "settings.yml";

export interface RepoSettings {
  mode?: string;
}

export const settingsPath = (repo: string) => path.join(overrideDir(repo), SETTINGS_FILE);

/** The repo's settings; a missing, unreadable or malformed file is "no settings". */
export async function readRepoSettings(repo: string): Promise<RepoSettings> {
  try {
    const data: unknown = parse(await readFile(settingsPath(repo), "utf8"));
    const mode = data && typeof data === "object" ? (data as { mode?: unknown }).mode : undefined;
    return typeof mode === "string" && mode ? { mode } : {};
  } catch {
    return {};
  }
}

/** The text of settings.yml for `mode`. */
export const settingsText = (mode: string) => `# TaskPilot settings of this repo (commit it to share with the team).
# mode: the workflow mode the repo runs by default (a directory of TaskPilot's workflows/, or "custom").
mode: ${mode}
`;
