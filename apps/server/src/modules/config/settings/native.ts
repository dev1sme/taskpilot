import { t } from "../../../core/i18n.js";
import { parse as parseToml } from "smol-toml";
import { getNodeValue, parseTree, type Node as JsonNode, type ParseError, type ParseOptions } from "jsonc-parser";
import { HttpError } from "../../../core/errors.js";

import type { ConfigScope } from "../shared/sections.js";
import { type ProviderId } from "@taskpilot/shared";
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
