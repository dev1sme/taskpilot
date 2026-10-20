import type { WorkflowDef } from "./types.js";

/** How far a task got, read from the documents the workflow declares. */
export interface Stage {
  /** Steps done, counting up to the furthest step whose documents exist. */
  done: number;
  total: number;
  /** Title of that furthest step; null when none is done. */
  step: string | null;
}

/**
 * A step counts as done when its done-when file exists, or, without done-when, when all its outputs
 * exist. Steps before the furthest done one count as done too: a later step builds on them.
 */
export function stageOf(def: WorkflowDef, files: string[]): Stage {
  const has = new Set(files);
  let done = 0;
  def.steps.forEach((s, i) => {
    const needed = s.doneWhen ? [s.doneWhen.file] : s.outputs.map((o) => o.file);
    if (needed.length > 0 && needed.every((f) => has.has(f))) done = i + 1;
  });
  return { done, total: def.steps.length, step: done > 0 ? def.steps[done - 1].title : null };
}
