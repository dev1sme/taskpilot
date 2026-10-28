import { stringify } from "smol-toml";

/**
 * Hook events TaskPilot asks Codex for. Codex has no PostToolUseFailure; Esc fires `Interrupt`
 * instead of `Stop` (checked on codex 0.163.0, docs/SPEC.md §7).
 */
export const CODEX_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "Interrupt"] as const;

/** A string or boolean as a TOML value, as `-c key=value` takes it; quotes, backslashes and newlines are escaped. */
export function tomlValue(value: string | boolean): string {
  return stringify({ v: value }).replace(/^v = /, "").trimEnd();
}

/**
 * `-c hooks.<Event>=[{hooks=[{type="command",command="…"}]}]` for each event in `settings`, a JSON
 * object of event name → shell command. The hooks apply to this run only, next to the user's own
 * (`~/.codex/hooks.json`), which keep running. Codex runs them only after the user trusted them once.
 */
export function codexHookArgs(settings: string | undefined): string[] {
  if (!settings) return [];
  const commands = JSON.parse(settings) as Record<string, unknown>;
  const args: string[] = [];
  for (const event of CODEX_HOOK_EVENTS) {
    const command = commands[event];
    if (typeof command === "string") args.push("-c", `hooks.${event}=[{hooks=[{type="command",command=${tomlValue(command)}}]}]`);
  }
  return args;
}
