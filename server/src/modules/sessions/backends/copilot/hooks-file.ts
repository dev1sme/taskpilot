import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { HOOK_EVENTS, copilotHookCommand } from "../../hooks.js";
import { copilotHome } from "../../../../providers/copilot/home.js";

/**
 * Repo-local Copilot settings: where TaskPilot put its hooks before TPL-017. They are removed from
 * there now; Copilot 1.0.101 drops repo hooks on a plugin reload when it does not trust the folder.
 */
export const COPILOT_SETTINGS = path.join(".github", "copilot", "settings.local.json");
/** Marks the hook entries TaskPilot owns in that file; everything else in it is the user's. */
const MARK = "TASKPILOT_HOOK_URL";
const locks = new Map<string, Promise<unknown>>();

/** The user-level hooks file TaskPilot owns (no one else writes taskpilot.json). */
export function copilotHooksFile(): string {
  return path.join(copilotHome(), "hooks", "taskpilot.json");
}

/**
 * Installs TaskPilot's hooks as a user-level hooks file, hooks/taskpilot.json under COPILOT_HOME
 * (default ~/.copilot), and removes the entries older versions put into the repo's
 * .github/copilot/settings.local.json. Checked on copilot 1.0.101: user hooks survive the plugin
 * reload that drops repo hooks while the folder is untrusted (docs/SPEC.md §7). The per-session
 * URL and token come from the child's environment; the guard in the command makes the hooks do
 * nothing in a Copilot TaskPilot did not start. Files are rewritten only when their content changes.
 */
export async function ensureCopilotHooks(repo: string): Promise<void> {
  await serialized(copilotHooksFile(), () => writeIfChanged(copilotHooksFile(), (before) => (before === userHooksText() ? before : userHooksText())));
  const file = path.join(repo, COPILOT_SETTINGS);
  await serialized(file, () => writeIfChanged(file, (before) => (before === null ? before : withoutTaskPilotHooks(before))));
}

function serialized(key: string, task: () => Promise<void>): Promise<void> {
  const next = (locks.get(key) ?? Promise.resolve()).then(task);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** `change` returns the new text, or null to delete the file. */
async function writeIfChanged(file: string, change: (before: string | null) => string | null): Promise<void> {
  let before: string | null = null;
  try {
    before = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const after = change(before);
  if (after === before) return;
  if (after === null) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.taskpilot-${process.pid}.tmp`;
  await writeFile(tmp, after);
  await rename(tmp, file);
}

/** The hooks file in Copilot's flat schema ({type, bash, timeoutSec}) with TaskPilot's guard. */
export function userHooksText(): string {
  const hooks: Record<string, unknown> = {};
  for (const event of HOOK_EVENTS) hooks[event] = [{ type: "command", bash: copilotHookCommand(event), timeoutSec: 10 }];
  return `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`;
}

/**
 * Settings text without TaskPilot's hook entries; the same text when it has none, and null when
 * nothing but empty hooks is left (the file then only existed for TaskPilot).
 */
export function withoutTaskPilotHooks(text: string): string | null {
  const data = parseJsonc(text);
  if (!isObject(data.hooks)) return text;
  const hooks: Record<string, unknown> = { ...data.hooks };
  let changed = false;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((h) => !isOwn(h));
    if (kept.length === entries.length) continue;
    changed = true;
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!changed) return text;
  const { hooks: _old, ...rest } = data;
  const next = Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
  return Object.keys(next).length > 0 ? `${JSON.stringify(next, null, 2)}\n` : null;
}

function isOwn(entry: unknown): boolean {
  return isObject(entry) && [entry.bash, entry.command].some((c) => typeof c === "string" && c.includes(MARK));
}

/** Copilot settings files are JSONC; comments are dropped when TaskPilot rewrites the file. */
function parseJsonc(text: string | null): Record<string, unknown> {
  if (text === null || !text.trim()) return {};
  const data: unknown = JSON.parse(stripComments(text));
  if (!isObject(data)) throw new Error(`${COPILOT_SETTINGS} must hold a JSON object`);
  return data;
}

/** Removes // and /* *\/ comments outside strings. */
export function stripComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
