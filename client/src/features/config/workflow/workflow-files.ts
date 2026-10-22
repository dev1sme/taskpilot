import { getDraft } from "../shared/drafts";
import type { WorkflowConfig } from "./types";

export const WORKFLOW_FILE = "workflow.yml";
export const PROMPT_FILE = /^[a-z0-9][a-z0-9-]*\.md$/;
export const DRAFT_PREFIX = "workflow:";
export const draftKey = (name: string) => `workflow:${name}`;

/** Override files with an open draft (the picked one always counts, so its tab stays while it is open). */
export function openDraftNames(dirty: string[], picked: string): string[] {
  const names = new Set(dirty.filter((k) => k.startsWith(DRAFT_PREFIX)).map((k) => k.slice(DRAFT_PREFIX.length)));
  if (getDraft(draftKey(picked))) names.add(picked);
  return [...names];
}

/** Which documents a skeleton file shapes, for its label in the file list. */
export function formatUse(config: WorkflowConfig, name: string): string {
  const files = (config.def?.steps ?? [])
    .flatMap((s) => s.outputs)
    .filter((o) => o.format === name)
    .map((o) => o.file);
  if (config.def?.history.format === name) files.push(config.def.history.file);
  return files.join(", ");
}
