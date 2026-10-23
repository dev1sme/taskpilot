import { open, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copilotLauncher } from "../../../core/copilot/launch.js";
import { CopilotError } from "../../../core/copilot/acp.js";
import { copilotModels } from "../../../core/copilot/models.js";
import { HOOK_EVENTS, copilotHookCommand, type HookEvent } from "../hooks.js";
import type { AgentBackend, HookState } from "./types.js";
import { probeError, probePty, problem } from "./probe.js";
import type { AgentCapability, BackendProbeContext } from "./types.js";

/**
 * Repo-local Copilot settings: where TaskPilot put its hooks before TPL-017. They are removed from
 * there now; Copilot 1.0.101 drops repo hooks on a plugin reload when it does not trust the folder.
 */
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
  permissionModes: ["default", "acceptEdits", "plan", "auto"],
  supportsSubagents: true,
  probe: probeCopilot,
  launcher: copilotLauncher,
  prepare: ensureCopilotHooks,
  // Copilot fires SessionStart only together with the first prompt, so the engine cannot wait for it.
  readyMarker: READY_MARKER,
  // PermissionRequest fires for every tool call, also the ones Copilot then allows on its own.
  permissionGraceMs: 1500,
  normalize: normalizeCopilot,
  finishedTurn: copilotFinishedTurn,
};

/** `--version`, then the account's model list through `copilot --acp`. Login stays unknown; a list that cannot be read is unknown, never blocking. */
async function probeCopilot(context: BackendProbeContext): Promise<AgentCapability> {
  const capability = await probePty(copilotBackend, context);
  if (capability.cli.status !== "supported") return capability;
  let timer: NodeJS.Timeout | undefined;
  try {
    const models = await Promise.race([
      copilotModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), context.timeoutMs);
      }),
    ]);
    capability.models = { status: "supported", source: "model/list", items: models.map((m) => ({ id: m.model, model: m.model, displayName: m.displayName, isDefault: m.isDefault })) };
  } catch (error) {
    const code = error instanceof CopilotError ? error.code : (error as { code?: string }).code;
    const issue =
      code === "timeout" ? problem("copilot", "timeout", "model") : code === "protocol" ? problem("copilot", "protocol", "model") : code === "missing" || code === "ENOENT" ? problem("copilot", "missing_cli", "model") : probeError("copilot", error, "model");
    capability.models = { status: "unknown", source: "model/list", items: [], error: issue };
  } finally {
    clearTimeout(timer);
  }
  return capability;
}

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
      const message = typeof out.transcript_path === "string" ? await lastAssistantMessage(out.transcript_path, Number.isNaN(stoppedAt) ? undefined : stoppedAt) : null;
      return message ? { ...out, last_assistant_message: message } : out;
    }
    default:
      return out;
  }
}

/** events.jsonl of a Copilot session. */
export function copilotTranscript(sessionId: string): string {
  return path.join(copilotHome(), "session-state", sessionId, "events.jsonl");
}

/**
 * Stop as seen from the transcript: the last assistant/tool/user line is an `assistant.turn_end`
 * written after `since`, and nothing at all was written for `idleMs` (a turn_end also
 * ends each round of tool calls, but those rounds go on within seconds).
 */
export async function copilotFinishedTurn(sessionId: string, since: number, idleMs: number, now = Date.now()): Promise<Record<string, unknown> | null> {
  const file = copilotTranscript(sessionId);
  const text = await readTail(file);
  if (text === null) return null;
  let last: { type: string; at: number } | null = null;
  let lastWork: { type: string; at: number } | null = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: { type?: unknown; timestamp?: unknown };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (typeof event.type !== "string" || typeof event.timestamp !== "string") continue;
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) continue;
    last = { type: event.type, at };
    if (/^(assistant|tool)\.|^user\.message$/.test(event.type)) lastWork = last;
  }
  if (!last || lastWork?.type !== "assistant.turn_end" || lastWork.at < since || now - last.at < idleMs) return null;
  const payload = { session_id: sessionId, transcript_path: file, source: "transcript", timestamp: new Date(lastWork.at).toISOString() };
  return (await normalizeCopilot("Stop", payload, emptyState())) ?? payload;
}

function emptyState(): HookState {
  return { openTools: new Map(), nextToolId: 1, finishedAt: new Map(), heldPermissions: new Map() };
}

function copilotHome(): string {
  return process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
}

async function readTail(file: string): Promise<string | null> {
  try {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await handle.read(buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
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
  const text = await readTail(file);
  if (text === null) return null;
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
