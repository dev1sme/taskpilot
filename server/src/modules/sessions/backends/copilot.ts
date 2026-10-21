import { open, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { copilotLauncher } from "../../../core/copilot/launch.js";
import { HOOK_EVENTS, hookCommand, type HookEvent } from "../hooks.js";
import type { AgentBackend, HookState } from "./types.js";

/** Repo-local Copilot settings (docs: personal overrides, meant to be gitignored by the user). */
export const COPILOT_SETTINGS = path.join(".github", "copilot", "settings.local.json");
/** Marks the hook entries TaskPilot owns in that file; everything else in it is the user's. */
const MARK = "TASKPILOT_HOOK_URL";
/**
 * Footer of copilot's input box; absent while the folder trust prompt is shown. Checked on copilot
 * 1.0.101: check it again after every Copilot upgrade (docs/SPEC.md §7).
 */
const READY_MARKER = "/ commands";
/** Enough of events.jsonl to find the last assistant message of a turn. */
const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;
/**
 * Copilot fires Stop before events.jsonl has the turn's last lines (copilot 1.0.101): wait this long
 * at most for an `assistant.turn_end` from around the Stop.
 */
const TRANSCRIPT_WAIT_MS = 3000;
const TRANSCRIPT_POLL_MS = 100;
/** A turn_end this close before the Stop belongs to the turn that stopped. */
const TURN_END_SLACK_MS = 500;

/**
 * Copilot runtime tool names → Claude's, as Copilot itself maps them for hooks declared with
 * PascalCase names (docs.github.com/en/copilot/reference/hooks-reference).
 */
const CLAUDE_TOOL: Record<string, string> = {
  bash: "Bash",
  powershell: "Bash",
  view: "Read",
  create: "Write",
  edit: "Edit",
  str_replace_editor: "Edit",
  apply_patch: "Edit",
  grep: "Grep",
  rg: "Grep",
  glob: "Glob",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  ask_user: "AskUserQuestion",
  update_todo: "TodoWrite",
  task: "Agent",
};

/**
 * GitHub Copilot CLI. Its hooks are declared with Claude's PascalCase event names, so Copilot
 * sends Claude-style snake_case payloads with Claude tool names; `normalize` fills the rest.
 */
export const copilotBackend: AgentBackend = {
  id: "copilot",
  launcher: copilotLauncher,
  prepare: ensureCopilotHooks,
  // Copilot fires SessionStart only together with the first prompt, so the engine cannot wait for it.
  readyMarker: READY_MARKER,
  // PermissionRequest fires for every tool call, also the ones Copilot then allows on its own.
  permissionGraceMs: 1500,
  normalize: normalizeCopilot,
};

export async function normalizeCopilot(event: HookEvent, payload: Record<string, unknown>, state: HookState): Promise<Record<string, unknown> | null> {
  const out = { ...payload };
  // PermissionRequest still arrives in camelCase with runtime tool names (copilot 1.0.100).
  if (typeof out.session_id !== "string" && typeof out.sessionId === "string") out.session_id = out.sessionId;
  if (typeof out.tool_name !== "string" && typeof out.toolName === "string") out.tool_name = CLAUDE_TOOL[out.toolName] ?? out.toolName;
  if (out.tool_input === undefined) out.tool_input = out.toolInput ?? out.toolArgs;
  const tool = typeof out.tool_name === "string" ? out.tool_name : "";

  switch (event) {
    case "SessionStart":
      // Arrives with the first prompt, after the session already reported itself ready.
      return null;
    case "PreToolUse": {
      // No tool_use_id: hand one out so PostToolUse finds the running item in the feed.
      const id = `copilot-${state.nextToolId++}`;
      state.openTools.set(tool, [...(state.openTools.get(tool) ?? []), id]);
      return { ...out, tool_use_id: id };
    }
    case "PostToolUse":
    case "PostToolUseFailure": {
      const open = state.openTools.get(tool) ?? [];
      const id = open.shift();
      if (open.length === 0) state.openTools.delete(tool);
      return id ? { ...out, tool_use_id: id } : out;
    }
    case "Stop": {
      const stoppedAt = typeof out.timestamp === "string" ? Date.parse(out.timestamp) : NaN;
      const message =
        typeof out.transcript_path === "string" ? await lastAssistantMessage(out.transcript_path, Number.isNaN(stoppedAt) ? undefined : stoppedAt) : null;
      return message ? { ...out, last_assistant_message: message } : out;
    }
    default:
      return out;
  }
}

/**
 * The last non-empty `assistant.message` of a Copilot events.jsonl; null when unreadable. With
 * `stoppedAt` (the Stop hook's time), waits until the file has that turn's end.
 */
export async function lastAssistantMessage(file: string, stoppedAt?: number): Promise<string | null> {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  for (;;) {
    const found = await readLastMessage(file);
    const complete = stoppedAt === undefined || (found?.turnEndedAt ?? 0) >= stoppedAt - TURN_END_SLACK_MS;
    if (!found || complete || Date.now() >= deadline) return found?.message ?? null;
    await new Promise((r) => setTimeout(r, TRANSCRIPT_POLL_MS));
  }
}

async function readLastMessage(file: string): Promise<{ message: string | null; turnEndedAt: number } | null> {
  let text: string;
  try {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await handle.read(buf, 0, buf.length, start);
      text = buf.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
  const lines = text.split("\n");
  let turnEndedAt = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant.')) continue;
    let event: { type?: unknown; timestamp?: unknown; data?: { content?: unknown } };
    try {
      event = JSON.parse(lines[i]) as typeof event;
    } catch {
      // The first line of the tail may be cut in half.
      continue;
    }
    if (event.type === "assistant.turn_end" && !turnEndedAt && typeof event.timestamp === "string") {
      turnEndedAt = Date.parse(event.timestamp) || 0;
    } else if (event.type === "assistant.message" && typeof event.data?.content === "string" && event.data.content.trim()) {
      return { message: event.data.content, turnEndedAt };
    }
  }
  return { message: null, turnEndedAt };
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Puts TaskPilot's hooks into the repo's .github/copilot/settings.local.json: entries that post
 * to $TASKPILOT_HOOK_URL are replaced, every other key and hook is kept. Copilot reads hooks only
 * from disk (no --settings flag); the per-session URL and token come from the child's environment,
 * and without them (copilot started by hand) the hooks exit at once. The file is rewritten only
 * when this changes it; .gitignore is left to the user.
 */
export function ensureCopilotHooks(repo: string): Promise<void> {
  const file = path.join(repo, COPILOT_SETTINGS);
  const next = (locks.get(file) ?? Promise.resolve()).then(() => writeHooks(file));
  locks.set(file, next.catch(() => undefined));
  return next;
}

async function writeHooks(file: string): Promise<void> {
  let before: string | null = null;
  try {
    before = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const after = withTaskPilotHooks(before);
  if (after === before) return;
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.taskpilot-${process.pid}.tmp`;
  await writeFile(tmp, after);
  await rename(tmp, file);
}

/** Settings text with TaskPilot's hook entries in Copilot's flat schema ({type, bash, timeoutSec}). */
export function withTaskPilotHooks(text: string | null): string {
  const data = parseJsonc(text);
  const hooks: Record<string, unknown> = isObject(data.hooks) ? { ...data.hooks } : {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((h) => !isOwn(h));
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  for (const event of HOOK_EVENTS) {
    const own = { type: "command", bash: `[ -n "$TASKPILOT_HOOK_TOKEN" ] || exit 0; ${hookCommand(event)}`, timeoutSec: 10 };
    const current = hooks[event];
    hooks[event] = [...(Array.isArray(current) ? current : []), own];
  }
  return `${JSON.stringify({ ...data, hooks }, null, 2)}\n`;
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
