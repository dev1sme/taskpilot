import type { HookEvent } from "../../hooks.js";
import type { HookState } from "../types.js";
import { CLAUDE_TOOL_NAMES } from "../../../../providers/copilot/tool-names.js";
import { copilotTranscript, lastAssistantMessage, transcriptTurnEnd } from "../../../../providers/copilot/transcript.js";

export async function normalizeCopilot(event: HookEvent, payload: Record<string, unknown>, state: HookState): Promise<Record<string, unknown> | null> {
  const out = { ...payload };
  // PermissionRequest still arrives in camelCase with runtime tool names (copilot 1.0.100).
  if (typeof out.session_id !== "string" && typeof out.sessionId === "string") out.session_id = out.sessionId;
  if (typeof out.tool_name !== "string" && typeof out.toolName === "string") out.tool_name = CLAUDE_TOOL_NAMES[out.toolName] ?? out.toolName;
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

/** A Stop read from the transcript, for a session whose own Stop hook never came. */
export async function copilotFinishedTurn(sessionId: string, since: number, idleMs: number, now = Date.now()): Promise<Record<string, unknown> | null> {
  const file = copilotTranscript(sessionId);
  const endedAt = await transcriptTurnEnd(file, since, idleMs, now);
  if (endedAt === null) return null;
  const payload = { session_id: sessionId, transcript_path: file, source: "transcript", timestamp: new Date(endedAt).toISOString() };
  return (await normalizeCopilot("Stop", payload, emptyState())) ?? payload;
}

function emptyState(): HookState {
  return { openTools: new Map(), nextToolId: 1, finishedAt: new Map(), heldPermissions: new Map() };
}
