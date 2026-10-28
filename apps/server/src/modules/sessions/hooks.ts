import type { ProviderId } from "@taskpilot/shared";
import { CODEX_HOOK_EVENTS } from "../../providers/codex/hooks.js";

/** Hook events TaskPilot listens to, by their Claude Code names (Copilot accepts the same names). */
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
  const hooks: Record<string, unknown> = {};
  for (const event of HOOK_EVENTS) hooks[event] = [{ hooks: [{ type: "command", command: hookCommand(event) }] }];
  return JSON.stringify({ hooks, statusLine: { type: "command", command: STATUS_LINE_COMMAND } });
}

/** Shell command a hook runs: posts its JSON input to TaskPilot, never failing the agent's turn. */
export function hookCommand(event: HookEvent): string {
  return (
    `curl -sS -m 5 -o /dev/null -X POST -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" ` +
    `-H "content-type: application/json" --data-binary @- "$TASKPILOT_HOOK_URL/${event}" >/dev/null 2>&1 || true`
  );
}

/**
 * A hook command for an agent whose hooks every session on the machine can read (Copilot's user-level
 * hooks file) or that may be started by hand: it does nothing unless TaskPilot started that agent
 * (the launcher sets both variables).
 */
export function guardedHookCommand(agent: ProviderId, event: HookEvent): string {
  return `[ "$TASKPILOT_HOOK_AGENT" = ${agent} ] && [ -n "$TASKPILOT_HOOK_TOKEN" ] || exit 0; ${hookCommand(event)}`;
}

export function copilotHookCommand(event: HookEvent): string {
  return guardedHookCommand("copilot", event);
}

export function codexHookCommand(event: HookEvent): string {
  return guardedHookCommand("codex", event);
}

/**
 * Hooks for the Codex launcher (`CodexCliOptions.settings`): Codex event name → command. Codex's
 * `Interrupt` (Esc, no `Stop` follows) is posted as `Stop`; its payload keeps `hook_event_name`, which
 * `normalizeCodex` reads to tell the two apart.
 */
export function codexHookSettings(): string {
  const commands: Record<string, string> = {};
  for (const event of CODEX_HOOK_EVENTS) commands[event] = codexHookCommand(event === "Interrupt" ? "Stop" : event);
  return JSON.stringify(commands);
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
