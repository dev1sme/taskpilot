import type { ProviderId } from "../../core/providers.js";
import type { HookEvent } from "./hooks.js";

/** TaskPilot vocabulary; independent of provider hook names and wire payload keys. */
interface EventContext {
  /** TaskPilot session id, never the provider's conversation id. */
  sessionId: string;
  provider: ProviderId;
}

interface ToolContext {
  callId?: string;
  name?: string;
  input?: unknown;
}

export type SessionEvent = EventContext &
  (
    | { type: "session.started" }
    | { type: "prompt.submitted"; prompt?: string }
    | { type: "tool.started"; tool: ToolContext }
    | { type: "permission.requested"; tool: ToolContext }
    | { type: "tool.completed"; tool: ToolContext; output?: unknown }
    | { type: "tool.failed"; tool: ToolContext; error?: unknown }
    | { type: "turn.completed"; message?: string }
    | { type: "turn.interrupted"; message?: string }
  );

/**
 * Compatibility bridge AFTER backend normalization and session identity validation.
 * Native adapters keep ownership of correlation, suppressed hooks and interruption detection.
 * No consumer is migrated yet: the HTTP hook and existing session events remain unchanged.
 */
export function sessionEventFromHook(context: EventContext, event: HookEvent, payload: Record<string, unknown>): SessionEvent {
  const text = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : undefined);
  const tool = (): ToolContext => ({
    ...(text("tool_use_id") !== undefined ? { callId: text("tool_use_id") } : {}),
    ...(text("tool_name") !== undefined ? { name: text("tool_name") } : {}),
    ...(payload.tool_input !== undefined ? { input: payload.tool_input } : {}),
  });
  switch (event) {
    case "SessionStart":
      return { ...context, type: "session.started" };
    case "UserPromptSubmit":
      return { ...context, type: "prompt.submitted", ...(text("prompt") !== undefined ? { prompt: text("prompt") } : {}) };
    case "PreToolUse":
      return { ...context, type: "tool.started", tool: tool() };
    case "PermissionRequest":
      return { ...context, type: "permission.requested", tool: tool() };
    case "PostToolUse":
      return { ...context, type: "tool.completed", tool: tool(), ...(payload.tool_response !== undefined ? { output: payload.tool_response } : {}) };
    case "PostToolUseFailure":
      return { ...context, type: "tool.failed", tool: tool(), ...(payload.error !== undefined ? { error: payload.error } : {}) };
    case "Stop":
      return {
        ...context,
        type: payload.interrupted === true ? "turn.interrupted" : "turn.completed",
        ...(text("last_assistant_message") !== undefined ? { message: text("last_assistant_message") } : {}),
      };
  }
}
