import { parse, stringify } from "yaml";
import { WORKFLOW_FILE } from "./modes.js";

export type StepProvenance = { id: string; status: "builtin" | "patched" | "added"; keys: string[] };
export type FileProvenance = "builtin" | "replaced" | "added";

export interface Provenance {
  /** Top-level keys the override wrote. */
  keys: string[];
  /** Steps in merged order. */
  steps: StepProvenance[];
  /** Every file of the merged workflow. */
  files: Record<string, FileProvenance>;
}

export interface MergeResult {
  files: Map<string, string>;
  errors: string[];
  provenance: Provenance;
}

const TOP_KEYS = ["agent", "model", "permission-mode", "language", "rules", "history", "restart"];
const STEP_KEYS = ["title", "agent", "model", "prompt", "on-reject", "gate", "done-when"];
/** What an override may change of the dispatch step; the rest (`from`, `report`) is the engine's. */
const DISPATCH_KEYS = ["prompt", "format", "parallel"];

type Doc = Record<string, unknown>;

const isObject = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Lays an `extends` override over its base workflow, at the level of YAML and files, so the usual
 * parser and all its rules then run on the merged result:
 * - top-level keys the override writes replace the base's;
 * - a step with a base step's id patches it (only the keys written; outputs by output id);
 * - any other step is new and says `before` or `after` which step it goes next to;
 * - a file of the override replaces the base's file of the same name.
 * The dispatch step is the engine's: it only takes a patch of `title` and `dispatch.prompt|format|parallel`,
 * and no step goes right next to it.
 */
export function mergeOverride(base: Map<string, string>, override: Map<string, string>): MergeResult {
  const errors: string[] = [];
  const provenance: Provenance = { keys: [], steps: [], files: {} };
  const files = new Map(base);
  for (const [name, text] of override) {
    if (name === WORKFLOW_FILE) continue;
    provenance.files[name] = base.has(name) ? "replaced" : "added";
    files.set(name, text);
  }
  for (const name of base.keys()) provenance.files[name] ??= "builtin";

  const read = (text: string | undefined, where: string): Doc | null => {
    if (text === undefined) return (errors.push(`${where}: missing ${WORKFLOW_FILE}`), null);
    try {
      const doc: unknown = parse(text);
      if (isObject(doc)) return doc;
      errors.push(`${where}: must be a mapping`);
    } catch (e) {
      errors.push(`${where}: invalid YAML: ${(e as Error).message}`);
    }
    return null;
  };
  const baseDoc = read(base.get(WORKFLOW_FILE), "base");
  const ovDoc = read(override.get(WORKFLOW_FILE), "override");
  if (!baseDoc || !ovDoc) return { files, errors, provenance };

  const merged: Doc = { ...baseDoc, version: 2 };
  delete merged.name;
  delete merged.description;
  for (const key of TOP_KEYS) {
    if (ovDoc[key] === undefined) continue;
    merged[key] = ovDoc[key];
    provenance.keys.push(key);
  }

  const baseSteps = Array.isArray(baseDoc.steps) ? baseDoc.steps.filter(isObject) : [];
  const steps: Doc[] = baseSteps.map((s) => structuredClone(s));
  const status = new Map<string, StepProvenance>(baseSteps.map((s) => [String(s.id), { id: String(s.id), status: "builtin", keys: [] }]));
  const ovSteps = ovDoc.steps;
  if (ovSteps !== undefined && !Array.isArray(ovSteps)) errors.push("override: steps must be a list");

  for (const [i, raw] of (Array.isArray(ovSteps) ? ovSteps : []).entries()) {
    const at = `steps[${i}]`;
    if (!isObject(raw)) {
      errors.push(`${at} must be a mapping`);
      continue;
    }
    const id = raw.id;
    if (typeof id !== "string") {
      errors.push(`${at}.id must be a string`);
      continue;
    }
    const target = steps.find((s) => s.id === id);
    if (target) patchStep(target, raw, at, status.get(id)!, errors);
    else addStep(steps, raw, at, status, errors);
  }

  provenance.steps = steps.map((s) => status.get(String(s.id)) ?? { id: String(s.id), status: "builtin", keys: [] });
  merged.steps = steps;
  files.set(WORKFLOW_FILE, stringify(merged));
  return { files, errors, provenance };
}

function patchStep(target: Doc, patch: Doc, at: string, info: StepProvenance, errors: string[]) {
  const id = String(target.id);
  info.status = "patched";
  const note = (key: string) => {
    if (!info.keys.includes(key)) info.keys.push(key);
  };
  for (const key of Object.keys(patch)) {
    if (key === "id") continue;
    if (key === "before" || key === "after") {
      errors.push(`${at}: step ${id} is already in the workflow; \`${key}\` is only for a new step`);
    } else if (target.dispatch !== undefined) {
      if (key === "title") (target.title = patch.title, note(key));
      else if (key === "dispatch") patchDispatch(target, patch.dispatch, at, errors, note);
      else errors.push(`${at}: step ${id} is the dispatch step; it only takes \`title\` and \`dispatch.${DISPATCH_KEYS.join("|")}\``);
    } else if (key === "dispatch") {
      errors.push(`${at}: a dispatch step cannot be added or turned on from an override`);
    } else if (key === "outputs") {
      patchOutputs(target, patch.outputs, at, errors);
      note(key);
    } else if (STEP_KEYS.includes(key)) {
      target[key] = patch[key];
      note(key);
    } else {
      errors.push(`${at}: unknown key \`${key}\``);
    }
  }
}

function patchDispatch(target: Doc, patch: unknown, at: string, errors: string[], note: (key: string) => void) {
  if (!isObject(patch)) return void errors.push(`${at}.dispatch must be a mapping`);
  const dispatch = isObject(target.dispatch) ? target.dispatch : {};
  for (const key of Object.keys(patch)) {
    if (!DISPATCH_KEYS.includes(key)) errors.push(`${at}.dispatch.${key}: the engine owns it; an override may only change ${DISPATCH_KEYS.join(", ")}`);
    else {
      dispatch[key] = patch[key];
      note(`dispatch.${key}`);
    }
  }
  target.dispatch = dispatch;
}

function patchOutputs(target: Doc, patch: unknown, at: string, errors: string[]) {
  if (!Array.isArray(patch)) return void errors.push(`${at}.outputs must be a list`);
  const outputs = Array.isArray(target.outputs) ? (target.outputs as Doc[]) : [];
  for (const [j, o] of patch.entries()) {
    if (!isObject(o) || typeof o.id !== "string") {
      errors.push(`${at}.outputs[${j}] must be a mapping with an id`);
      continue;
    }
    const existing = outputs.find((x) => x.id === o.id);
    if (existing) Object.assign(existing, o);
    else outputs.push({ ...o });
  }
  target.outputs = outputs;
}

function addStep(steps: Doc[], raw: Doc, at: string, status: Map<string, StepProvenance>, errors: string[]) {
  const id = String(raw.id);
  const { before, after, ...step } = raw;
  if ((before === undefined) === (after === undefined)) {
    return void errors.push(`${at}: step ${id} is not in the workflow; give exactly one of \`before\` or \`after\` (the id of a step) to place it`);
  }
  if (step.dispatch !== undefined) return void errors.push(`${at}: a dispatch step cannot be added from an override`);
  const anchorKey = before === undefined ? "after" : "before";
  const anchor = String(before ?? after);
  const at0 = steps.findIndex((s) => s.id === anchor);
  if (at0 < 0) return void errors.push(`${at}.${anchorKey}: no step ${anchor}`);
  const index = anchorKey === "before" ? at0 : at0 + 1;
  if (steps[index]?.dispatch !== undefined || steps[index - 1]?.dispatch !== undefined) {
    return void errors.push(`${at}: step ${id} cannot go right next to the dispatch step; put it before the step that precedes it, or after the review step`);
  }
  steps.splice(index, 0, step);
  status.set(id, { id, status: "added", keys: [] });
}
