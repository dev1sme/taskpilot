/** Claude Code hook events TaskPilot listens to. */
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  // A failed tool call (e.g. a command exiting non-zero) fires this instead of PostToolUse.
  "PostToolUseFailure",
  "Stop",
] as const;
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
  return JSON.stringify({ hooks, statusLine: { type: "command", command: STATUS_LINE_COMMAND } });
}

/**
 * Status line of every session: posts its input (plan usage) to TaskPilot in the background, then
 * runs the user's own status line, which --settings would otherwise replace (verified on claude
 * 2.1.304). The user's command comes from the child's environment, so it needs no escaping here.
 */
const STATUS_LINE_COMMAND =
  `input=$(cat); printf '%s' "$input" | curl -sS -m 2 -o /dev/null -X POST -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" ` +
  `-H "content-type: application/json" --data-binary @- "$TASKPILOT_HOOK_URL/statusline" >/dev/null 2>&1 & ` +
  `if [ -n "$TASKPILOT_STATUSLINE_CMD" ]; then printf '%s' "$input" | sh -c "$TASKPILOT_STATUSLINE_CMD"; fi`;

/** Next activity after a hook event. A permission prompt is cleared once a tool runs or the turn ends. */
export function nextActivity(event: HookEvent): Activity {
  switch (event) {
    case "SessionStart":
    case "Stop":
      return "idle";
    case "PermissionRequest":
      return "permission";
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
      return "busy";
  }
}
