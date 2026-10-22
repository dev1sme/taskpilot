import { HttpError } from "../../../core/errors.js";
import { isObject, maskValue } from "../shared/fs.js";
import { hideUrlCredentials } from "./read.js";
import { t } from "../../../core/i18n.js";

export interface ValueInput {
  key: string;
  /** null = keep the value already configured for this key. */
  value: string | null;
  /** Project servers: store the value in TaskPilot's env store and write `${VAR}` in .mcp.json. */
  secret?: boolean;
}

export interface McpEntryInput {
  name: string;
  /** The server's current name when renaming; omitted when adding. */
  originalName?: string;
  type: McpType;
  command?: string;
  args: string[];
  url?: string;
  env: ValueInput[];
  headers: ValueInput[];
}

/** `streamable-http` is Claude Code's alias for `http`; `ws` is a WebSocket server. */
export const MCP_TYPES = ["stdio", "http", "sse", "ws", "streamable-http"] as const;
export type McpType = (typeof MCP_TYPES)[number];

/** Fields the form edits. Everything else in an entry (timeout, alwaysLoad, headersHelper…) is kept. */
const EDITED = ["type", "command", "args", "env", "url", "headers"];
/** Transport fields the form does not edit, dropped when an entry moves between stdio and remote. */
const STDIO_ONLY = ["cwd"];
const REMOTE_ONLY = ["headersHelper", "oauth"];

/** Server names: also checked by the routes, so `__proto__` and the like never reach a lookup. */
export const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER = /^[A-Za-z0-9-]{1,100}$/;

export function validateEntry(body: unknown): McpEntryInput {
  if (!isObject(body)) throw new HttpError(400, t("errors.bodyObject"));
  const b = body;
  if (typeof b.name !== "string" || !NAME.test(b.name)) throw new HttpError(400, t("mcp.name"));
  if (b.originalName !== undefined && (typeof b.originalName !== "string" || !NAME.test(b.originalName))) {
    throw new HttpError(400, t("mcp.originalName"));
  }
  if (typeof b.type !== "string" || !(MCP_TYPES as readonly string[]).includes(b.type)) {
    throw new HttpError(400, t("mcp.type", { types: MCP_TYPES.join(", ") }));
  }
  const type = b.type as McpType;
  const args = b.args ?? [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || /[\r\n\0]/.test(a))) throw new HttpError(400, t("mcp.args"));
  if (type === "stdio" && (typeof b.command !== "string" || !b.command.trim() || /[\r\n\0]/.test(b.command))) {
    throw new HttpError(400, t("mcp.stdioCommand"));
  }
  if (type === "ws" && (typeof b.url !== "string" || !/^wss?:\/\/\S+$/.test(b.url))) {
    throw new HttpError(400, t("mcp.wsUrl"));
  }
  if (type !== "stdio" && type !== "ws" && (typeof b.url !== "string" || !/^https?:\/\/\S+$/.test(b.url))) {
    throw new HttpError(400, t("mcp.httpUrl"));
  }
  const values = (v: unknown, what: string, keyRe: RegExp): ValueInput[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new HttpError(400, t("mcp.notList", { what }));
    const seen = new Set<string>();
    return v.map((row) => {
      if (!isObject(row) || typeof row.key !== "string" || !keyRe.test(row.key)) throw new HttpError(400, t("mcp.badKey", { what }));
      if (seen.has(row.key)) throw new HttpError(400, t("mcp.duplicate", { what, key: row.key }));
      seen.add(row.key);
      if (row.value !== null && (typeof row.value !== "string" || /[\r\n\0]/.test(row.value))) {
        throw new HttpError(400, t("mcp.badValue", { what, key: row.key }));
      }
      return { key: row.key, value: row.value as string | null, secret: row.secret === true };
    });
  };
  return {
    name: b.name,
    originalName: b.originalName as string | undefined,
    type,
    command: typeof b.command === "string" ? b.command.trim() : undefined,
    args: args as string[],
    url: typeof b.url === "string" ? b.url.trim() : undefined,
    env: type === "stdio" ? values(b.env, "env", KEY) : [],
    headers: type === "stdio" ? [] : values(b.headers, "header", HEADER),
  };
}

/**
 * The JSON entry to store, built from the form and the server's current entry. Values left
 * unchanged (null) keep their configured value; masked credentials in args/url are restored.
 * For project scope, secret values become `${VAR}` and are returned in `secrets` so the caller
 * can put them in TaskPilot's env store; for local/user scope (a private file) they stay inline.
 */
export function buildEntry(
  input: McpEntryInput,
  existing: Record<string, unknown> | null,
  scope: "project" | "local" | "user",
): { entry: Record<string, unknown>; secrets: Record<string, string> } {
  const secrets: Record<string, string> = {};
  const oldArgs = existing && Array.isArray(existing.args) ? existing.args.filter((a): a is string => typeof a === "string") : [];
  const restore = (s: string, olds: string[]) => olds.find((o) => hideUrlCredentials(o) === s && o !== s) ?? s;

  const resolve = (rows: ValueInput[], old: unknown, varName: (key: string) => string) => {
    const previous = isObject(old) ? old : {};
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (row.value === null) {
        const kept = previous[row.key];
        if (typeof kept !== "string") throw new HttpError(400, t("mcp.nothingToKeep", { key: row.key }));
        out[row.key] = kept;
      } else if (row.secret && scope === "project" && !maskValue(row.value).reference) {
        const name = varName(row.key);
        secrets[name] = row.value;
        out[row.key] = `\${${name}}`;
      } else {
        out[row.key] = row.value;
      }
    }
    return out;
  };

  const prefix = input.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const entry: Record<string, unknown> = { type: input.type };
  const wasStdio = existing ? existing.type === "stdio" || (existing.type === undefined && typeof existing.command === "string") : input.type === "stdio";
  const dropped = new Set([...EDITED, ...(wasStdio === (input.type === "stdio") ? [] : wasStdio ? STDIO_ONLY : REMOTE_ONLY)]);
  const kept = Object.entries(existing ?? {}).filter(([k]) => !dropped.has(k));
  if (input.type === "stdio") {
    entry.command = input.command;
    if (input.args.length) entry.args = input.args.map((a) => restore(a, oldArgs));
    const env = resolve(input.env, existing?.env, (key) => `${prefix}_${key}`);
    if (Object.keys(env).length) entry.env = env;
  } else {
    entry.url = restore(input.url!, typeof existing?.url === "string" ? [existing.url] : []);
    const headers = resolve(input.headers, existing?.headers, (key) => `${prefix}_${key.toUpperCase().replace(/-/g, "_")}`);
    if (Object.keys(headers).length) entry.headers = headers;
  }
  for (const [k, v] of kept) entry[k] = v;
  return { entry, secrets };
}

/** Entry with env/header values masked and URL credentials hidden, for diffs and the edit form. */
export function maskEntry(entry: unknown): Record<string, unknown> | null {
  if (!isObject(entry)) return null;
  const out: Record<string, unknown> = { ...entry };
  for (const key of ["env", "headers"]) {
    if (isObject(entry[key])) out[key] = Object.fromEntries(Object.entries(entry[key]).map(([k, v]) => [k, maskValue(v).value]));
  }
  if (Array.isArray(entry.args)) out.args = entry.args.map((a) => (typeof a === "string" ? hideUrlCredentials(a) : a));
  if (typeof entry.url === "string") out.url = hideUrlCredentials(entry.url);
  return out;
}
