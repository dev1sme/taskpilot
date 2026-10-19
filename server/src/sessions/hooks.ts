/** Claude Code hook events TaskPilot listens to. */
export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PostToolUse", "Stop"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** What the session is doing, as far as hooks tell. */
export type Activity = "starting" | "idle" | "busy" | "permission";

export function isHookEvent(name: string): name is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(name);
}

/**
 * Settings passed to claude with --settings. They merge with the user's own settings (verified,
 * docs/SPEC.md §7). The hook URL and per-session token come from the child's environment so the
 * JSON stays the same for every session.
 */
export function hookSettings(): string {
  const command = (event: HookEvent) =>
    `curl -sS -m 5 -o /dev/null -X POST -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" ` +
    `-H "content-type: application/json" --data-binary @- "$TASKPILOT_HOOK_URL/${event}" >/dev/null 2>&1 || true`;
  const hooks: Record<string, unknown> = {};
  for (const event of HOOK_EVENTS) hooks[event] = [{ hooks: [{ type: "command", command: command(event) }] }];
  return JSON.stringify({ hooks });
}

/** Next activity after a hook event. A permission prompt is cleared once a tool runs or the turn ends. */
export function nextActivity(event: HookEvent): Activity {
  switch (event) {
    case "SessionStart":
    case "Stop":
      return "idle";
    case "PermissionRequest":
      return "permission";
    case "UserPromptSubmit":
    case "PostToolUse":
      return "busy";
  }
}
