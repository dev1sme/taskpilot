import { t } from "../../../core/i18n.js";
import { displayPath, isObject, maskValue, readJsonFile, strings } from "../shared/fs.js";
import type { ConfigScope } from "../shared/provider-capabilities.js";
import { settingsTarget } from "../shared/targets.js";
import { readCurrent } from "../shared/writer.js";
import { nativeKeys, readNativeFields, type NativeFields, type NativeSettings } from "./native.js";
import { configAdapter } from "../adapters/index.js";

export type SettingsScope = "project" | "local" | "user";

export interface SettingsFile {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  error?: string;
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode?: string;
  additionalDirectories: string[];
  env: Array<{ key: string; value: string; reference: boolean }>;
  /** Other top-level keys, so the page can say what else the file configures. */
  otherKeys: string[];
}

export interface NativeSettingsFile {
  scope: ConfigScope;
  path: string;
  exists: boolean;
  error?: string;
  fields: NativeFields;
  editableKeys: string[];
}

/** Only the validated native fields leave the server. Unknown fields and credentials stay on disk. */
export async function readNativeSettings(repo: string, native: NativeSettings): Promise<NativeSettingsFile[]> {
  return Promise.all(
    configAdapter(native.id).settings.scopes.map(async (scope) => {
      const target = settingsTarget(repo, scope, native.id);
      const content = await readCurrent(target.abs);
      try {
        return { scope, path: target.display, exists: content !== null, fields: readNativeFields(native, scope, content), editableKeys: nativeKeys(native, scope) };
      } catch {
        return { scope, path: target.display, exists: true, error: t("configMessages.settings_read_01"), fields: {}, editableKeys: nativeKeys(native, scope) };
      }
    }),
  );
}

export interface HookEntry {
  scope: SettingsScope;
  file: string;
  event: string;
  matcher: string;
  type: string;
  command: string;
  timeout?: number;
}

const KNOWN = new Set(["permissions", "env", "hooks"]);

/** Claude's settings files, by scope. */
export function settingsFiles(repo: string): Array<[SettingsScope, string]> {
  const settings = configAdapter("claude").settings;
  return settings.scopes.map((scope) => [scope, settings.file(repo, scope)]);
}

/** Permissions and env of each settings file. Env values are masked. */
export async function readSettings(repo: string): Promise<SettingsFile[]> {
  return Promise.all(
    settingsFiles(repo).map(async ([scope, file]): Promise<SettingsFile> => {
      const base: SettingsFile = {
        scope,
        path: displayPath(file, repo),
        exists: false,
        allow: [],
        ask: [],
        deny: [],
        additionalDirectories: [],
        env: [],
        otherKeys: [],
      };
      const json = await readJsonFile(file);
      if (!json.exists) return base;
      if ("error" in json) return { ...base, exists: true, error: json.error };
      const d = isObject(json.data) ? json.data : {};
      const p = isObject(d.permissions) ? d.permissions : {};
      return {
        ...base,
        exists: true,
        allow: strings(p.allow),
        ask: strings(p.ask),
        deny: strings(p.deny),
        defaultMode: typeof p.defaultMode === "string" ? p.defaultMode : undefined,
        additionalDirectories: strings(p.additionalDirectories),
        env: isObject(d.env) ? Object.entries(d.env).map(([key, v]) => ({ key, ...maskValue(v) })) : [],
        otherKeys: Object.keys(d).filter((k) => !KNOWN.has(k)),
      };
    }),
  );
}

/** The user's own status line command (local, then project, then user settings), or null. */
export async function statusLineCommand(repo: string): Promise<string | null> {
  const files = settingsFiles(repo);
  const byPriority = [files[1], files[0], files[2]];
  for (const [, file] of byPriority) {
    const json = await readJsonFile(file);
    if (!json.exists || "error" in json || !isObject(json.data)) continue;
    const line = json.data.statusLine;
    if (isObject(line) && line.type === "command" && typeof line.command === "string" && line.command.trim()) return line.command;
  }
  return null;
}

/** Every hook command configured in the settings files, flattened. */
export async function readHooks(repo: string): Promise<HookEntry[]> {
  const out: HookEntry[] = [];
  for (const [scope, file] of settingsFiles(repo)) {
    const json = await readJsonFile(file);
    if (!("data" in json) || !isObject(json.data) || !isObject(json.data.hooks)) continue;
    for (const [event, matchers] of Object.entries(json.data.hooks)) {
      if (!Array.isArray(matchers)) continue;
      for (const m of matchers) {
        if (!isObject(m) || !Array.isArray(m.hooks)) continue;
        for (const h of m.hooks) {
          if (!isObject(h)) continue;
          out.push({
            scope,
            file: displayPath(file, repo),
            event,
            matcher: typeof m.matcher === "string" && m.matcher ? m.matcher : "*",
            type: typeof h.type === "string" ? h.type : "command",
            command: typeof h.command === "string" ? h.command : typeof h.prompt === "string" ? h.prompt : "",
            timeout: typeof h.timeout === "number" ? h.timeout : undefined,
          });
        }
      }
    }
  }
  return out;
}
