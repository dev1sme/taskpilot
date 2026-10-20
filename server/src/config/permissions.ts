import { HttpError } from "../core/errors.js";
import { isObject, maskValue, strings } from "./fs.js";
import { t } from "../core/i18n.js";

export interface PermissionsInput {
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode: string | null;
}

/** bypassPermissions is not offered: it turns off every check, and TaskPilot drives sessions unattended. */
export const EDITABLE_MODES = ["default", "acceptEdits", "plan", "auto"];

export function validatePermissions(body: unknown): PermissionsInput {
  if (!isObject(body)) throw new HttpError(400, t("errors.bodyObject"));
  const list = (key: "allow" | "ask" | "deny") => {
    const v = body[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new HttpError(400, t("permissions.notList", { key }));
    const rules = [...new Set((v as string[]).map((r) => r.trim()).filter(Boolean))];
    for (const r of rules) {
      if (r.length > 500 || /[\n\r]/.test(r)) throw new HttpError(400, t("permissions.invalidRule", { rule: r.slice(0, 60) }));
      if (!/^[A-Za-z_][\w-]*(\(.*\))?$/.test(r) && !r.startsWith("mcp__")) {
        throw new HttpError(400, t("permissions.ruleShape", { rule: r }));
      }
    }
    return rules;
  };
  const mode = body.defaultMode;
  if (mode !== null && mode !== undefined && (typeof mode !== "string" || !EDITABLE_MODES.includes(mode))) {
    throw new HttpError(400, t("permissions.mode", { modes: EDITABLE_MODES.join(", ") }));
  }
  return { allow: list("allow"), ask: list("ask"), deny: list("deny"), defaultMode: (mode as string | null | undefined) ?? null };
}

/** Current permissions of a settings file, for the editor. */
export function readPermissions(text: string | null): PermissionsInput {
  const data = parseSettings(text);
  const p = isObject(data.permissions) ? data.permissions : {};
  return {
    allow: strings(p.allow),
    ask: strings(p.ask),
    deny: strings(p.deny),
    defaultMode: typeof p.defaultMode === "string" ? p.defaultMode : null,
  };
}

/**
 * New file text with the permissions replaced; every other key (env, hooks, model, other
 * permission fields such as additionalDirectories) is kept as it was.
 */
export function applyPermissions(text: string | null, input: PermissionsInput): string {
  const data = parseSettings(text);
  const previous = isObject(data.permissions) ? data.permissions : {};
  const next: Record<string, unknown> = { ...previous };
  for (const key of ["allow", "ask", "deny"] as const) {
    if (input[key].length) next[key] = input[key];
    else delete next[key];
  }
  if (input.defaultMode) next.defaultMode = input.defaultMode;
  else delete next.defaultMode;

  const out = { ...data };
  if (Object.keys(next).length) out.permissions = next;
  else delete out.permissions;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The same JSON with env values masked, so a diff shown in the browser never carries secrets. */
export function maskSettingsText(text: string | null): string | null {
  if (text === null) return null;
  let data: Record<string, unknown>;
  try {
    data = parseSettings(text);
  } catch {
    return t("errors.invalidJsonShort");
  }
  if (isObject(data.env)) {
    data = { ...data, env: Object.fromEntries(Object.entries(data.env).map(([k, v]) => [k, maskValue(v).value])) };
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

function parseSettings(text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === "") return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new HttpError(409, t("errors.settingsNotJsonPermissions", { error: (e as Error).message }));
  }
  if (!isObject(data)) throw new HttpError(409, t("errors.settingsNotObject"));
  return data;
}
