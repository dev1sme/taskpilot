import type { ModeInfo, OverrideInfo, PROMPT_TEXT, RepoSettings } from "../../workflow/index.js";
import type { EffectiveExecution, ExecutionSelection, ExecutionSelectionSource } from "../../workflow/types.js";

/** The repo's default execution; absent is distinct from an explicit workflow choice, and invalid settings stay visible. */
export interface ExecutionDefaults {
  execution: NonNullable<RepoSettings["execution"]> | null;
  executionVersion: NonNullable<RepoSettings["executionVersion"]> | null;
  errors: NonNullable<RepoSettings["errors"]>;
  hash: string;
  settingsPath: string;
}

/** The modes a repo can run and the one it chose (`.taskpilot/settings.yml`). */
export interface WorkflowModes {
  modes: ModeInfo[];
  selected: string;
  override: { kind: OverrideInfo["kind"]; extends: string | null };
  hash: string;
  settingsPath: string;
}

/** One file of the repo's override, with the file it replaces (the mode's) for comparison. */
export interface WorkflowFileView {
  path: string;
  exists: boolean;
  content: string;
  hash: string;
  defaultContent: string | null;
}

export interface WorkflowChecks {
  errors: string[];
  warnings: string[];
}

export interface WorkflowSavePreview extends Pick<WorkflowChecks, "warnings"> {
  diff: string;
  changed: boolean;
  stale: boolean;
}

/** Turning a complete (legacy) override into `extends`: the diff, and the errors that stop it. */
export interface MigrationPreview {
  base: string;
  errors: string[];
  diff: string;
  remove: string[];
  applied: boolean;
}

/** The prompt a step would send, for a sample task. */
export interface RenderedPrompt {
  task: typeof PROMPT_TEXT.sampleTask;
  execution: ExecutionSelection;
  source: ExecutionSelectionSource;
  effective: EffectiveExecution;
  text: string;
}
