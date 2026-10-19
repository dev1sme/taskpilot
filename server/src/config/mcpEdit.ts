import { HttpError } from "../errors.js";
import { isObject, maskValue } from "./fs.js";
import { hideUrlCredentials } from "./mcp.js";

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
  type: "stdio" | "http" | "sse";
  command?: string;
  args: string[];
  url?: string;
  env: ValueInput[];
  headers: ValueInput[];
}

const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER = /^[A-Za-z0-9-]{1,100}$/;

export function validateEntry(body: unknown): McpEntryInput {
  if (!isObject(body)) throw new HttpError(400, "Body phải là object");
  const b = body;
  if (typeof b.name !== "string" || !NAME.test(b.name)) throw new HttpError(400, "Tên server chỉ gồm chữ, số, . _ - (tối đa 64 ký tự)");
  if (b.originalName !== undefined && (typeof b.originalName !== "string" || !NAME.test(b.originalName))) {
    throw new HttpError(400, "originalName không hợp lệ");
  }
  if (b.type !== "stdio" && b.type !== "http" && b.type !== "sse") throw new HttpError(400, "type phải là stdio, http hoặc sse");
  const args = b.args ?? [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || /[\r\n\0]/.test(a))) throw new HttpError(400, "args phải là danh sách chuỗi một dòng");
  if (b.type === "stdio" && (typeof b.command !== "string" || !b.command.trim() || /[\r\n\0]/.test(b.command))) {
    throw new HttpError(400, "Server stdio cần lệnh chạy");
  }
  if (b.type !== "stdio" && (typeof b.url !== "string" || !/^https?:\/\/\S+$/.test(b.url))) {
    throw new HttpError(400, "Server http/sse cần URL bắt đầu bằng http:// hoặc https://");
  }
  const values = (v: unknown, what: string, keyRe: RegExp): ValueInput[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new HttpError(400, `${what} phải là danh sách`);
    const seen = new Set<string>();
    return v.map((row) => {
      if (!isObject(row) || typeof row.key !== "string" || !keyRe.test(row.key)) throw new HttpError(400, `${what}: tên không hợp lệ`);
      if (seen.has(row.key)) throw new HttpError(400, `${what}: trùng ${row.key}`);
      seen.add(row.key);
      if (row.value !== null && (typeof row.value !== "string" || /[\r\n\0]/.test(row.value))) {
        throw new HttpError(400, `${what} ${row.key}: giá trị không hợp lệ`);
      }
      return { key: row.key, value: row.value as string | null, secret: row.secret === true };
    });
  };
  return {
    name: b.name,
    originalName: b.originalName as string | undefined,
    type: b.type,
    command: typeof b.command === "string" ? b.command.trim() : undefined,
    args: args as string[],
    url: typeof b.url === "string" ? b.url.trim() : undefined,
    env: b.type === "stdio" ? values(b.env, "env", KEY) : [],
    headers: b.type === "stdio" ? [] : values(b.headers, "header", HEADER),
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
        if (typeof kept !== "string") throw new HttpError(400, `${row.key} chưa có giá trị để giữ lại`);
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
  if (input.type === "stdio") {
    entry.command = input.command;
    if (input.args.length) entry.args = input.args.map((a) => restore(a, oldArgs));
    const env = resolve(input.env, existing?.env, (key) => key);
    if (Object.keys(env).length) entry.env = env;
  } else {
    entry.url = restore(input.url!, typeof existing?.url === "string" ? [existing.url] : []);
    const headers = resolve(input.headers, existing?.headers, (key) => `${prefix}_${key.toUpperCase().replace(/-/g, "_")}`);
    if (Object.keys(headers).length) entry.headers = headers;
  }
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
