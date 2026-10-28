import { describe, expect, it } from "vitest";
import { backendOf } from "../../../src/modules/sessions/backends/index.js";
import type { HookState } from "../../../src/modules/sessions/backends/types.js";
import { HOOK_EVENTS } from "../../../src/modules/sessions/hooks.js";
import { sessionEventFromHook } from "../../../src/modules/sessions/events.js";

const context = { sessionId: "taskpilot-id", provider: "claude" as const };
const state = (): HookState => ({ openTools: new Map(), nextToolId: 1, finishedAt: new Map(), heldPermissions: new Map() });

describe("TaskPilot session event contract", () => {
  it("covers every accepted hook with neutral vocabulary", () => {
    expect(HOOK_EVENTS.map((hook) => sessionEventFromHook(context, hook, {}).type)).toEqual([
      "session.started",
      "prompt.submitted",
      "tool.started",
      "permission.requested",
      "tool.completed",
      "tool.failed",
      "turn.completed",
    ]);
  });

  it("uses trusted TaskPilot identity and ignores unrelated native payload fields", () => {
    expect(sessionEventFromHook(context, "SessionStart", { session_id: "native-thread", token: "secret" })).toEqual({ ...context, type: "session.started" });
    expect(sessionEventFromHook(context, "PreToolUse", { tool_name: 42, tool_use_id: false })).toEqual({ ...context, type: "tool.started", tool: {} });
  });

  it("preserves tool results and errors without treating an empty value as missing", () => {
    expect(sessionEventFromHook(context, "PostToolUse", { tool_use_id: "call", tool_name: "Read", tool_input: { file_path: "a" }, tool_response: "" })).toEqual({
      ...context,
      type: "tool.completed",
      tool: { callId: "call", name: "Read", input: { file_path: "a" } },
      output: "",
    });
    expect(sessionEventFromHook(context, "PostToolUseFailure", { error: { message: "failed" } })).toMatchObject({ type: "tool.failed", error: { message: "failed" } });
  });

  it.each(["claude", "codex", "copilot"] as const)("maps %s tools after its actual adapter, preserving call correlation", async (provider) => {
    const backend = backendOf(provider);
    const hooks = state();
    const raw = provider === "copilot" ? { toolName: "bash", toolArgs: { command: "pwd" } } : { tool_name: "Bash", tool_use_id: "native-call", tool_input: { command: "pwd" } };
    const normalized = backend.normalize ? await backend.normalize("PreToolUse", raw, hooks) : raw;
    expect(normalized).not.toBeNull();
    const started = sessionEventFromHook({ ...context, provider }, "PreToolUse", normalized!);
    expect(started).toMatchObject({ provider, type: "tool.started", tool: { name: "Bash", input: { command: "pwd" } } });
    const completed = backend.normalize ? await backend.normalize("PostToolUse", raw, hooks) : raw;
    const ended = sessionEventFromHook({ ...context, provider }, "PostToolUse", completed!);
    expect("tool" in ended && "tool" in started && ended.tool.callId === started.tool.callId).toBe(true);
  });

  it("distinguishes Codex Interrupt from a completed answer after normalization", async () => {
    const normalized = await backendOf("codex").normalize!("Stop", { hook_event_name: "Interrupt" }, state());
    expect(sessionEventFromHook({ ...context, provider: "codex" }, "Stop", normalized!)).toMatchObject({ type: "turn.interrupted" });
    expect(sessionEventFromHook(context, "Stop", { interrupted: "true", last_assistant_message: "answer" })).toMatchObject({ type: "turn.completed", message: "answer" });
  });

  it.each(["codex", "copilot"] as const)("leaves suppressed %s SessionStart hooks suppressed", async (provider) => {
    expect(await backendOf(provider).normalize!("SessionStart", {}, state())).toBeNull();
  });
});
