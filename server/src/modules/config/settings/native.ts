import { t } from "../../../core/i18n.js";
import { parse as parseToml } from "smol-toml";
import { findNodeAtLocation, getNodeValue, parseTree, type Node as JsonNode, type ParseError, type ParseOptions } from "jsonc-parser";
import { HttpError } from "../../../core/errors.js";

import type { ConfigScope } from "../shared/sections.js";
import { type ProviderId } from "../../../core/providers.js";
import { configAdapter } from "../adapters/index.js";
import { isObject } from "../../../core/values.js";

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

const JSONC: ParseOptions = { allowTrailingComma: true, disallowComments: false };

/** Copilot's settings as a tree with source offsets: comments and trailing commas are fine; any other syntax error, or a key given twice, is not. */
function jsoncTree(source: string): JsonNode {
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, JSONC);
  if (errors.length || tree?.type !== "object" || hasDuplicateKey(tree)) throw new Error("jsonc");
  return tree;
}

function hasDuplicateKey(node: JsonNode): boolean {
  if (node.type === "object") {
    const keys = (node.children ?? []).map((property) => property.children?.[0]?.value as string);
    if (new Set(keys).size !== keys.length) return true;
  }
  return (node.children ?? []).some(hasDuplicateKey);
}

function parsed(native: NativeSettings, text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === "") return {};
  try {
    const value: unknown = native.format === "toml" ? parseToml(text) : getNodeValue(jsoncTree(text));
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

/**
 * Sets or removes each field by editing only its own text, so comments, spacing and every other
 * key keep their bytes. The library parses; the edits are TaskPilot's, to keep the file's style.
 */
function patchJsonc(text: string | null, fields: NativeFields): string {
  let source = text?.trim() ? text : "{}\n";
  for (const [key, value] of Object.entries(fields)) {
    const path = key.split(".");
    let missing = false;
    for (let depth = 1; depth < path.length; depth++) {
      const tree = jsoncTree(source);
      const group = findNodeAtLocation(tree, path.slice(0, depth));
      if (group && group.type !== "object") throw new HttpError(409, t("configMessages.settings_native_06", { value0: path[depth - 1] }));
      if (group) continue;
      if (value === null) {
        missing = true;
        break;
      }
      source = insertProperty(source, depth === 1 ? tree : findNodeAtLocation(tree, path.slice(0, depth - 1))!, path[depth - 1], "{}");
    }
    if (missing) continue;
    const tree = jsoncTree(source);
    const parent = path.length === 1 ? tree : findNodeAtLocation(tree, path.slice(0, -1))!;
    const old = findNodeAtLocation(parent, [path[path.length - 1]]);
    if (old && value === null) source = removeProperty(source, parent, old.parent!, key);
    else if (old) source = source.slice(0, old.offset) + JSON.stringify(value) + source.slice(old.offset + old.length);
    else if (value !== null) source = insertProperty(source, parent, path[path.length - 1], JSON.stringify(value));
  }
  jsoncTree(source);
  return source;
}

const endOf = (node: JsonNode) => node.offset + node.length;

/** Removes a property with the comma that joins it to a neighbour; comments around it stay. */
function removeProperty(source: string, object: JsonNode, property: JsonNode, key: string): string {
  const siblings = object.children ?? [];
  const index = siblings.indexOf(property);
  const next = siblings[index + 1];
  const previous = siblings[index - 1];
  if (next) {
    const comma = source.indexOf(",", endOf(property));
    if (comma < 0 || comma >= next.offset) throw new HttpError(409, t("configMessages.settings_native_07", { value0: key }));
    return source.slice(0, property.offset) + source.slice(comma + 1);
  }
  if (previous) {
    const comma = source.indexOf(",", endOf(previous));
    if (comma < 0 || comma >= property.offset) throw new HttpError(409, t("configMessages.settings_native_08", { value0: key }));
    return source.slice(0, comma) + source.slice(endOf(property));
  }
  const close = endOf(object) - 1;
  const trailing = /^\s*,/.exec(source.slice(endOf(property), close));
  return source.slice(0, property.offset) + source.slice(endOf(property) + (trailing?.[0].length ?? 0));
}

/** Adds `"key": encoded` as the object's last property, after a trailing comma when the file has one. */
function insertProperty(source: string, object: JsonNode, key: string, encoded: string): string {
  if (object.type !== "object") throw new HttpError(409, t("configMessages.settings_native_09"));
  const close = endOf(object) - 1;
  const entries = object.children ?? [];
  if (!entries.length) return source.slice(0, close) + `${JSON.stringify(key)}: ${encoded}` + source.slice(close);
  const last = endOf(entries[entries.length - 1]);
  const trailing = /^(\s*,)/.exec(source.slice(last, close));
  if (trailing) {
    const at = last + trailing[1].length;
    return source.slice(0, at) + ` ${JSON.stringify(key)}: ${encoded}` + source.slice(at);
  }
  return source.slice(0, last) + `, ${JSON.stringify(key)}: ${encoded}` + source.slice(last);
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
