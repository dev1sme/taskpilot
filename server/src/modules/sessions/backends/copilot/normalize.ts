import type { HookEvent } from "../../hooks.js";
import type { HookState } from "../types.js";
import { copilotTranscript, lastAssistantMessage, readTail } from "./transcript.js";

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
