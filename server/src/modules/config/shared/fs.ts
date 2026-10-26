import os from "node:os";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { t } from "../../../core/i18n.js";

export async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

export async function fileInfo(file: string): Promise<{ bytes: number; mtime: number } | null> {
  try {
    const s = await stat(file);
    return s.isFile() ? { bytes: s.size, mtime: s.mtimeMs } : null;
  } catch {
    return null;
  }
}

export type JsonResult = { exists: false } | { exists: true; data: unknown } | { exists: true; error: string };

export async function readJsonFile(file: string): Promise<JsonResult> {
  const text = await readText(file);
  if (text === null) return { exists: false };
  try {
    return { exists: true, data: JSON.parse(text) };
  } catch (e) {
    return { exists: true, error: t("errors.invalidJson", { error: (e as Error).message }) };
  }
}

/** Splits "---\nyaml\n---\nbody". A file without frontmatter has an empty `meta`. */
export function frontmatter(text: string): { meta: Record<string, unknown>; body: string; error?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  try {
    const meta = parse(m[1]) as unknown;
    return { meta: isObject(meta) ? meta : {}, body: text.slice(m[0].length) };
  } catch (e) {
    return { meta: {}, body: text.slice(m[0].length), error: t("errors.frontmatter", { error: (e as Error).message }) };
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function strings(v: unknown): string[] {
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;

/**
 * Hides secret values. A value built from `${VAR}` references plus a short plain prefix such as
 * "Bearer " is shown as it is (the secret lives in the variable); anything else becomes "••••"
 * so the page never displays a token.
 */
export function maskValue(v: unknown): { value: string; reference: boolean } {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const rest = s.replace(ENV_REF, "");
  if (rest !== s && /^[A-Za-z ]{0,12}$/.test(rest)) return { value: s, reference: true };
  return { value: s === "" ? t("mcp.empty") : "••••", reference: false };
}

/** Variable names referenced as ${VAR} in a string. */
export function envRefs(s: string): string[] {
  return [...s.matchAll(ENV_REF)].map((m) => m[1]);
}

export function displayPath(file: string, repo: string): string {
  const home = os.homedir();
  const rel = path.relative(repo, file);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  if (file !== home && !file.startsWith(home + path.sep)) return file;
  return `~${file.slice(home.length)}`;
}
