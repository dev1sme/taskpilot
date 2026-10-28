import { t } from "../../../core/i18n.js";
import { parse as parseToml } from "smol-toml";
import { HttpError } from "../../../core/errors.js";
import { isObject } from "../shared/fs.js";
import type { ConfigScope } from "../shared/sections.js";
import { type ProviderId } from "../../../core/providers.js";
import { configAdapter } from "../adapters/index.js";

/** A CLI whose settings TaskPilot edits as a few native fields. */
export interface NativeSettings {
  id: ProviderId;
  format: "toml" | "jsonc";
  keys(scope: ConfigScope): readonly string[];
}
type NativeValue = string | boolean | null;
export type NativeFields = Record<string, NativeValue>;

/** The native settings of a CLI, or null when its settings are not edited as native fields. */
export function nativeSettingsOf(cli: ProviderId): NativeSettings | null {
  const settings = configAdapter(cli).settings;
  return settings.kind === "native" ? { id: cli, format: settings.format, keys: settings.keys } : null;
}

export function nativeKeys(native: NativeSettings, scope: ConfigScope): string[] {
  return [...native.keys(scope)];
}

function invalidFile(native: NativeSettings): never {
  throw new HttpError(409, t("configMessages.settings_native_01", { value0: native.id }));
}

/** JSONC parser with source offsets, used to replace only the selected property values. */
interface Node {
  value: unknown;
  start: number;
  end: number;
  keyStart?: number;
  close?: number;
  properties?: Map<string, Node>;
}

function parseJsonc(source: string): Node {
  let i = 0;
  const skip = () => {
    while (i < source.length) {
      if (/\s/.test(source[i])) i++;
      else if (source.startsWith("//", i)) {
        i = source.indexOf("\n", i + 2);
        if (i < 0) i = source.length;
      } else if (source.startsWith("/*", i)) {
        const end = source.indexOf("*/", i + 2);
        if (end < 0) throw new Error("comment");
        i = end + 2;
      } else break;
    }
  };
  const string = (): string => {
    const start = i++;
    while (i < source.length) {
      if (source[i] === "\\") i += 2;
      else if (source[i++] === '"') return JSON.parse(source.slice(start, i)) as string;
    }
    throw new Error("string");
  };
  const parse = (): Node => {
    skip();
    const start = i;
    if (source[i] === "{") {
      i++;
      const value: Record<string, unknown> = {};
      const properties = new Map<string, Node>();
      skip();
      while (source[i] !== "}") {
        if (source[i] !== '"') throw new Error("key");
        const keyStart = i;
        const key = string();
        if (properties.has(key)) throw new Error("duplicate key");
        skip();
        if (source[i++] !== ":") throw new Error("colon");
        const child = parse();
        child.keyStart = keyStart;
        value[key] = child.value;
        properties.set(key, child);
        skip();
        if (source[i] !== ",") break;
        i++;
        skip();
      }
      if (source[i] !== "}") throw new Error("object");
      const close = i++;
      return { value, start, end: i, close, properties };
    }
    if (source[i] === "[") {
      i++;
      const value: unknown[] = [];
      skip();
      while (source[i] !== "]") {
        value.push(parse().value);
        skip();
        if (source[i] !== ",") break;
        i++;
        skip();
      }
      if (source[i++] !== "]") throw new Error("array");
      return { value, start, end: i };
    }
    if (source[i] === '"') return { value: string(), start, end: i };
    while (i < source.length && !/[\s,}\]]/.test(source[i])) i++;
    const literal = source.slice(start, i);
    if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(literal)) throw new Error("literal");
    return { value: JSON.parse(literal) as unknown, start, end: i };
  };
  const root = parse();
  skip();
  if (i !== source.length || !isObject(root.value)) throw new Error("root");
  return root;
}

function parsed(native: NativeSettings, text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === "") return {};
  try {
    const value: unknown = native.format === "toml" ? parseToml(text) : parseJsonc(text).value;
    if (!isObject(value)) invalidFile(native);
    return value;
  } catch {
    return invalidFile(native);
  }
}

function field(data: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => (isObject(value) ? value[part] : undefined), data);
}

export function readNativeFields(native: NativeSettings, scope: ConfigScope, text: string | null): NativeFields {
  const data = parsed(native, text);
  return Object.fromEntries(
    nativeKeys(native, scope).map((key) => {
      const value = field(data, key);
      const safe =
        key === "approval_policy"
          ? value === "on-request" || value === "never"
          : key === "sandbox_mode"
            ? value === "read-only" || value === "workspace-write" || value === "danger-full-access"
            : key === "permissions.disableBypassPermissionsMode"
              ? value === "disable" || value === "allow-auto-only"
              : typeof value === "boolean";
      return [key, safe ? (value as NativeValue) : null];
    }),
  );
}

export function validateNativeFields(native: NativeSettings, scope: ConfigScope, body: unknown): NativeFields {
  if (!isObject(body) || !isObject(body.fields)) throw new HttpError(400, t("configMessages.settings_native_02"));
  const allowed = new Set(nativeKeys(native, scope));
  const fields: NativeFields = {};
  for (const [key, value] of Object.entries(body.fields)) {
    if (!allowed.has(key)) throw new HttpError(400, t("configMessages.settings_native_03", { value0: key }));
    const valid =
      key === "approval_policy"
        ? value === null || value === "on-request" || value === "never"
        : key === "sandbox_mode"
          ? value === null || ["read-only", "workspace-write", "danger-full-access"].includes(value as string)
          : key === "permissions.disableBypassPermissionsMode"
            ? value === null || value === "disable" || value === "allow-auto-only"
            : value === null || typeof value === "boolean";
    if (!valid || (key === "respectGitignore" && scope !== "user" && value === false)) throw new HttpError(400, t("configMessages.settings_native_04", { value0: key }));
    fields[key] = value as NativeValue;
  }
  if (!Object.keys(fields).length) throw new HttpError(400, t("configMessages.settings_native_05"));
  return fields;
}

function patchJsonc(text: string | null, fields: NativeFields): string {
  let source = text?.trim() ? text : "{}\n";
  for (const [path, value] of Object.entries(fields)) {
    const parts = path.split(".");
    const root = parseJsonc(source);
    let parent = root;
    const traversed: string[] = [];
    for (const part of parts.slice(0, -1)) {
      const child = parent.properties?.get(part);
      if (!child) {
        if (value === null) return source;
        source = insertProperty(source, parent, part, "{}");
        parent = parseJsonc(source);
        for (const segment of [...traversed, part]) parent = parent.properties?.get(segment) ?? parent;
      } else {
        if (!child.properties) throw new HttpError(409, t("configMessages.settings_native_06", { value0: part }));
        parent = child;
      }
      traversed.push(part);
    }
    const key = parts[parts.length - 1];
    const old = parent.properties?.get(key);
    if (old) {
      if (value === null) {
        const siblings = [...(parent.properties?.values() ?? [])];
        const index = siblings.indexOf(old);
        const next = siblings[index + 1];
        const previous = siblings[index - 1];
        if (next) {
          const comma = source.indexOf(",", old.end);
          if (comma < 0 || comma >= (next.keyStart ?? 0)) throw new HttpError(409, t("configMessages.settings_native_07", { value0: path }));
          source = source.slice(0, old.keyStart) + source.slice(comma + 1);
        } else if (previous) {
          const comma = source.indexOf(",", previous.end);
          if (comma < 0 || comma >= (old.keyStart ?? 0)) throw new HttpError(409, t("configMessages.settings_native_08", { value0: path }));
          source = source.slice(0, comma) + source.slice(old.end);
        } else {
          const gap = source.slice(old.end, parent.close);
          const trailing = /^\s*,/.exec(gap);
          source = source.slice(0, old.keyStart) + source.slice(old.end + (trailing?.[0].length ?? 0));
        }
        continue;
      }
      source = source.slice(0, old.start) + JSON.stringify(value) + source.slice(old.end);
    } else if (value !== null) source = insertProperty(source, parent, key, JSON.stringify(value));
  }
  parseJsonc(source);
  return source;
}

function insertProperty(source: string, object: Node, key: string, encoded: string): string {
  if (object.close === undefined || !object.properties) throw new HttpError(409, t("configMessages.settings_native_09"));
  const entries = [...object.properties.values()];
  if (!entries.length) return source.slice(0, object.close) + `${JSON.stringify(key)}: ${encoded}` + source.slice(object.close);
  const last = entries[entries.length - 1];
  const gap = source.slice(last.end, object.close);
  const trailing = /^(\s*,)/.exec(gap);
  if (trailing) {
    const at = last.end + trailing[1].length;
    return source.slice(0, at) + ` ${JSON.stringify(key)}: ${encoded}` + source.slice(at);
  }
  return source.slice(0, last.end) + `, ${JSON.stringify(key)}: ${encoded}` + source.slice(last.end);
}

function patchToml(native: NativeSettings, text: string | null, fields: NativeFields): string {
  let source = text ?? "";
  for (const [key, value] of Object.entries(fields)) {
    const current = parsed(native, source);
    if (current[key] !== undefined && typeof current[key] !== "string") throw new HttpError(409, t("configMessages.settings_native_10", { value0: key }));
    const lines = source.split("\n");
    const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
    const limit = firstTable < 0 ? lines.length : firstTable;
    const index = lines.findIndex((line, i) => i < limit && new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index >= 0 && value === null) lines.splice(index, 1);
    else if (index >= 0) {
      const match = /^(\s*[^=]+?\s*=\s*)(?:"(?:\\.|[^"\\])*"|'[^']*')(\s*(?:#.*)?)$/.exec(lines[index]);
      if (!match) throw new HttpError(409, t("configMessages.settings_native_11", { value0: key }));
      lines[index] = `${match[1]}${JSON.stringify(value)}${match[2]}`;
    } else if (value !== null) lines.splice(limit, 0, `${key} = ${JSON.stringify(value)}`);
    source = lines.join("\n");
  }
  parsed(native, source);
  return source.endsWith("\n") ? source : `${source}\n`;
}

export function applyNativeFields(native: NativeSettings, text: string | null, fields: NativeFields): string {
  parsed(native, text);
  try {
    return native.format === "toml" ? patchToml(native, text, fields) : patchJsonc(text, fields);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return invalidFile(native);
  }
}

/** Diff only the editable projection: unrelated keys may contain credentials. */
export function nativeDiffView(fields: NativeFields): string {
  return `${JSON.stringify(fields, null, 2)}\n`;
}
