import type { Agent } from "../../../shared/agents";

export interface WorkflowOutput {
  id: string;
  file: string;
  content: string;
  /** Skeleton file the document must follow. */
  format: string | null;
}

export interface WorkflowStepView {
  id: string;
  title: string;
  agent: Agent;
  gate: "approve" | "none";
  doneWhen: string | null;
  outputs: WorkflowOutput[];
  promptFile: string;
  onRejectFile: string | null;
  /** Set on a dispatch step: its subtask prompt and report. */
  dispatch: { from: string; promptFile: string; report: string; format: string | null; parallel: number } | null;
}

export interface WorkflowFile {
  name: string;
  path: string;
  content: string;
  hash: string;
  /** Steps whose prompt or on-reject this file is, documents whose skeleton it is, or the history file. */
  usedBy: string[];
  /** null when the built-in workflow has no file of that name. */
  sameAsDefault: boolean | null;
  /** Of an `extends` override: whether the file replaces the mode's or is new. */
  provenance: "builtin" | "replaced" | "added" | null;
}

export interface Provenance {
  keys: string[];
  steps: Array<{ id: string; status: "builtin" | "patched" | "added"; keys: string[] }>;
  files: Record<string, "builtin" | "replaced" | "added">;
}

export interface MigrationPreview {
  base: string;
  errors: string[];
  diff: string;
  remove: string[];
  applied: boolean;
}

export interface ModeInfo {
  id: string;
  name: string;
  description: string;
}

/** The workflow of a mode: TaskPilot's built-in one, or with the repo's override in .claude/taskpilot/ when that applies to it. */
export interface WorkflowConfig {
  origin: "repo" | "default";
  mode: { id: string; name: string; override: boolean };
  modes: ModeInfo[];
  /** The mode the repo runs by default. */
  selected: string;
  overrideKind: "none" | "legacy" | "extends";
  overrideExtends: string | null;
  provenance: Provenance | null;
  /** Every file as the workflow runs it. */
  resolved: Record<string, string>;
  overrideDir: string;
  dir: string;
  errors: string[];
  warnings: string[];
  variables: string[];
  /** Starting text of a new prompt file. */
  newPrompt: string;
  def: {
    agent: Agent;
    permissionMode: string | null;
    history: { file: string; entry: string; format: string | null };
    language: string;
    rules: string[];
    restart: { read: string[] } | null;
    steps: WorkflowStepView[];
  } | null;
  files: WorkflowFile[];
}

export interface WorkflowRawFile {
  path: string;
  exists: boolean;
  content: string;
  hash: string;
  defaultContent: string | null;
}

/** An open edit of one override file; drafts are keyed `workflow:<name>`. */
export interface WorkflowDraft {
  name: string;
  path: string;
  content: string;
  baseHash: string;
  isNew: boolean;
}
