import { readFile } from "node:fs/promises";
import path from "node:path";
import { isMap, parseDocument } from "yaml";
import { overrideDir } from "./definition.js";
import { ExecutionValidationError, parseExecution } from "./execution.js";
import type { ExecutionProblem, ExecutionSelection } from "./types.js";

/** The repo's own choice of workflow mode, next to its override: `<repo>/.taskpilot/settings.yml`. */
export const SETTINGS_FILE = "settings.yml";

export interface RepoSettings {
  mode?: string;
  executionVersion?: 1;
  execution?: ExecutionSelection;
  /** Invalid choices must be surfaced/blocked by callers, never treated as a valid default. */
  errors?: ExecutionProblem[];
}

export const settingsPath = (repo: string) => path.join(overrideDir(repo), SETTINGS_FILE);

/**
 * Legacy mode callers ignore invalid settings. Execution callers must request diagnostics
 * and block errors before selecting a default; missing files alone have no settings.
 */
export async function readRepoSettings(repo: string, options: { diagnostics?: boolean } = {}): Promise<RepoSettings> {
  const result = await readSettings(repo);
  if (options.diagnostics || !result.errors) return result;
  const { errors: _errors, ...settings } = result;
  return settings;
}

async function readSettings(repo: string): Promise<RepoSettings> {
  try {
    return parseRepoSettings(await readFile(settingsPath(repo), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return { errors: [{ field: "settings", message: "cannot read settings.yml" }] };
  }
}

export function parseRepoSettings(text: string): RepoSettings {
  try {
    const doc = settingsDocument(text);
    const data = doc.toJS() as Record<string, unknown> | null;
    const result: RepoSettings = {};
    const errors: ExecutionProblem[] = [];
    if (data?.mode !== undefined) {
      if (typeof data.mode === "string" && data.mode.trim()) result.mode = data.mode;
      else errors.push({ field: "mode", message: "must be a non-empty mode name" });
    }
    if (data?.executionVersion !== undefined && data.executionVersion !== 1) errors.push({ field: "executionVersion", message: "must be 1" });
    else if (data?.execution !== undefined) {
      try {
        result.execution = parseExecution(data.execution);
        result.executionVersion = 1;
      } catch (error) {
        if (!(error instanceof ExecutionValidationError)) throw error;
        errors.push(...error.problems);
      }
    }
    if (errors.length) result.errors = errors;
    return result;
  } catch (error) {
    return { errors: error instanceof ExecutionValidationError ? error.problems : [{ field: "settings", message: "invalid settings.yml" }] };
  }
}

export interface RepoSettingsPatch {
  mode?: string;
  /** null removes the execution default; workflow explicitly overrides a repo choice. */
  execution?: ExecutionSelection | null;
}

/** Pure AST patch: callers keep responsibility for baseHash, backup and durable write. */
export function patchRepoSettings(current: string | null, patch: RepoSettingsPatch): string {
  const doc = settingsDocument(current ?? SETTINGS_HEADER);
  if (patch.mode !== undefined) {
    if (typeof patch.mode !== "string" || !patch.mode.trim()) throw new ExecutionValidationError([{ field: "mode", message: "must be a non-empty mode name" }]);
    doc.set("mode", patch.mode);
  }
  if (patch.execution === null) {
    doc.delete("execution");
    doc.delete("executionVersion");
  } else if (patch.execution !== undefined) {
    const execution = parseExecution(patch.execution);
    const version = doc.get("executionVersion");
    if (version !== undefined && version !== 1) throw new ExecutionValidationError([{ field: "executionVersion", message: "unsupported version; cannot overwrite execution" }]);
    doc.set("executionVersion", 1);
    // Patch known children so unknown fields/comments survive unrelated edits.
    if (doc.has("execution") && !isMap(doc.get("execution", true))) throw new ExecutionValidationError([{ field: "execution", message: "must be a mapping" }]);
    doc.setIn(["execution", "agent"], execution.agent);
    if (execution.model === undefined) doc.deleteIn(["execution", "model"]);
    else doc.setIn(["execution", "model"], execution.model);
  }
  return doc.toString();
}

function settingsDocument(text: string) {
  const doc = parseDocument(text);
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) throw new ExecutionValidationError([{ field: "settings", message: "settings.yml must be a valid YAML mapping" }]);
  return doc;
}

const SETTINGS_HEADER = `# TaskPilot settings of this repo (commit it to share with the team).
# mode: the workflow mode the repo runs by default (a directory of TaskPilot's workflows/, or "custom").
`;

/** Compatible one-argument writer; pass current text to preserve all other settings. */
export const settingsText = (mode: string, current: string | null = null) => patchRepoSettings(current, { mode });
