import path from "node:path";
import { claudeHome, displayPath, isObject, maskValue, readJsonFile, strings } from "./fs.js";

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

export function settingsFiles(repo: string): Array<[SettingsScope, string]> {
  return [
    ["project", path.join(repo, ".claude", "settings.json")],
    ["local", path.join(repo, ".claude", "settings.local.json")],
    ["user", path.join(claudeHome(), "settings.json")],
  ];
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
