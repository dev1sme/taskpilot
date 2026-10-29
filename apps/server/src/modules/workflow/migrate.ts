import { parse, stringify } from "yaml";
import { t } from "../../core/i18n.js";
import { parseWorkflowFiles } from "./definition.js";
import { mergeOverride } from "./merge.js";
import { SOLO_MODE, WORKFLOW_FILE } from "./modes.js";

type Doc = Record<string, unknown>;

const TOP_KEYS = ["agent", "permission-mode", "language", "rules", "history", "restart"];
const STEP_KEYS = ["title", "agent", "prompt", "on-reject", "gate", "done-when"];
const DISPATCH_KEYS = ["prompt", "format", "parallel"];

const isObject = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface Migration {
  /** The new override: workflow.yml with `extends`, plus the legacy files that differ from the base. */
  files: Map<string, string>;
  /** Legacy files identical to the base's: no longer kept, so the base's own (and its fixes) apply. */
  remove: string[];
  errors: string[];
}

/** Which mode a legacy workflow is closest to: `leader` when it has a dispatch step, else `solo`. */
export function guessBase(legacy: Map<string, string>): string {
  try {
    const doc: unknown = parse(legacy.get(WORKFLOW_FILE) ?? "");
    if (isObject(doc) && Array.isArray(doc.steps) && doc.steps.some((s) => isObject(s) && s.dispatch !== undefined)) return "leader";
  } catch {
    // Left to the parser's own error.
  }
  return SOLO_MODE;
}

/**
 * Rewrites a complete (legacy) override as an `extends` override of `baseId`: only what differs from
 * the base. The result is merged back and compared with the legacy workflow; any difference (a removed
 * or moved step, a changed `dispatch.from`) is an error and nothing should be written.
 */
export function migrateLegacy(legacy: Map<string, string>, base: Map<string, string>, baseId: string): Migration {
  const errors: string[] = [];
  const read = (files: Map<string, string>): Doc | null => {
    try {
      const doc: unknown = parse(files.get(WORKFLOW_FILE) ?? "");
      return isObject(doc) ? doc : null;
    } catch {
      return null;
    }
  };
  const legacyDoc = read(legacy);
  const baseDoc = read(base);
  if (!legacyDoc || !baseDoc) return { files: legacy, remove: [], errors: [t("errors.migrateUnreadable")] };

  const out: Doc = { version: 2, extends: baseId };
  for (const key of TOP_KEYS) {
    if (same(legacyDoc[key], baseDoc[key])) continue;
    if (legacyDoc[key] === undefined) errors.push(t("errors.migrateRemoves", { what: key }));
    else out[key] = legacyDoc[key];
  }

  const legacySteps = (Array.isArray(legacyDoc.steps) ? legacyDoc.steps : []).filter(isObject);
  const baseSteps = (Array.isArray(baseDoc.steps) ? baseDoc.steps : []).filter(isObject);
  for (const b of baseSteps) {
    if (!legacySteps.some((l) => l.id === b.id)) errors.push(t("errors.migrateRemoves", { what: `step ${String(b.id)}` }));
  }
  const steps: Doc[] = [];
  legacySteps.forEach((l, i) => {
    const b = baseSteps.find((x) => x.id === l.id);
    if (!b) {
      const anchor = i > 0 ? { after: legacySteps[i - 1].id } : { before: legacySteps[1]?.id };
      steps.push({ ...anchor, ...l });
      return;
    }
    const patch = patchOf(l, b, errors);
    if (Object.keys(patch).length) steps.push({ id: l.id, ...patch });
  });
  if (steps.length) out.steps = steps;

  const remove = [...legacy.keys()].filter((name) => name !== WORKFLOW_FILE && base.get(name) === legacy.get(name));
  const files = new Map<string, string>([[WORKFLOW_FILE, stringify(out)]]);
  for (const [name, text] of legacy) if (name !== WORKFLOW_FILE && !remove.includes(name)) files.set(name, text);

  if (!errors.length) {
    const merged = mergeOverride(base, files);
    errors.push(...merged.errors);
    if (!errors.length && !equivalent(legacy, merged.files)) errors.push(t("errors.migrateMismatch"));
  }
  return { files, remove, errors };
}

/** What `l` changes of `b`, in the keys an `extends` override can write. */
function patchOf(l: Doc, b: Doc, errors: string[]): Doc {
  const patch: Doc = {};
  const id = String(l.id);
  if (b.dispatch !== undefined || l.dispatch !== undefined) {
    if (!same(l.title, b.title)) patch.title = l.title;
    const ld = isObject(l.dispatch) ? l.dispatch : {};
    const bd = isObject(b.dispatch) ? b.dispatch : {};
    const dispatch: Doc = {};
    for (const key of new Set([...Object.keys(ld), ...Object.keys(bd)])) {
      if (same(ld[key], bd[key])) continue;
      if (DISPATCH_KEYS.includes(key) && ld[key] !== undefined) dispatch[key] = ld[key];
      else errors.push(t("errors.migrateEngine", { what: `${id}.dispatch.${key}` }));
    }
    if (Object.keys(dispatch).length) patch.dispatch = dispatch;
    return patch;
  }
  for (const key of STEP_KEYS) {
    if (same(l[key], b[key])) continue;
    if (l[key] === undefined) errors.push(t("errors.migrateRemoves", { what: `${id}.${key}` }));
    else patch[key] = l[key];
  }
  const lo = (Array.isArray(l.outputs) ? l.outputs : []).filter(isObject);
  const bo = (Array.isArray(b.outputs) ? b.outputs : []).filter(isObject);
  for (const o of bo) {
    if (!lo.some((x) => x.id === o.id)) errors.push(t("errors.migrateRemoves", { what: `${id}.outputs.${String(o.id)}` }));
  }
  const outputs: Doc[] = [];
  for (const o of lo) {
    const base = bo.find((x) => x.id === o.id);
    if (!base) {
      outputs.push(o);
      continue;
    }
    const diff: Doc = {};
    for (const key of Object.keys(o)) if (!same(o[key], base[key])) diff[key] = o[key];
    for (const key of Object.keys(base)) if (o[key] === undefined) errors.push(t("errors.migrateRemoves", { what: `${id}.outputs.${String(o.id)}.${key}` }));
    if (Object.keys(diff).length) outputs.push({ id: o.id, ...diff });
  }
  if (outputs.length) patch.outputs = outputs;
  return patch;
}

/** Whether both file sets parse to the same workflow (where it is stored is not compared). */
function equivalent(a: Map<string, string>, b: Map<string, string>): boolean {
  const strip = (files: Map<string, string>) => {
    const { def } = parseWorkflowFiles(files, { dir: "", origin: "repo" });
    if (!def) return null;
    const { source: _s, dir: _d, mode: _m, ...rest } = def;
    return JSON.stringify(rest);
  };
  const left = strip(a);
  return left !== null && left === strip(b);
}
