import { expect, it } from "vitest";
import { nextActivity, sessionEventFromHook } from "../../../src/modules/sessions/events.js";
import { isHookEvent } from "../../../src/modules/sessions/hooks.js";
it("keeps native lifecycle outside the control contract until verified", () => {
  for (const event of ["SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "SessionEnd"]) expect(isHookEvent(event)).toBe(false);
  const context = { sessionId: "root", provider: "codex" as const };
  expect(nextActivity(sessionEventFromHook(context, "Stop", { interrupted: true }))).toBe("idle");
  expect(sessionEventFromHook(context, "Stop", { interrupted: true, failed: true }).type).toBe("turn.interrupted");
  expect(sessionEventFromHook(context, "SessionStart", { source: "resume" })).toMatchObject({ type: "session.started", resumed: true });
});
it("preserves other providers' failure/permission/tool behavior", () => {
  for (const provider of ["claude", "copilot"] as const) {
    const context = { sessionId: "s", provider };
    expect(nextActivity(sessionEventFromHook(context, "PermissionRequest", {}))).toBe("permission");
    expect(sessionEventFromHook(context, "PostToolUseFailure", { tool_use_id: "call", error: "failed" })).toMatchObject({ type: "tool.failed", tool: { callId: "call" }, error: "failed" });
    expect(nextActivity(sessionEventFromHook(context, "PostToolUse", {}))).toBe("busy");
  }
});
