import { HttpError } from "../../../core/errors.js";
import { isObject } from "../shared/fs.js";
import { t } from "../../../core/i18n.js";

export interface HookInput {
  event: string;
  matcher: string;
  command: string;
  timeout?: number;
  /**
   * The handler's other fields (if, args, async, shell, onFailure, statusMessage…), passed through
   * untouched so that saving never drops what TaskPilot does not edit.
   */
  extra?: Record<string, unknown>;
}

/** Editable Copilot command hook fields. Other hook types and fields remain in the file. */
export interface CopilotHookInput {
  event: string;
  matcher?: string;
  command?: string;
  bash?: string;
  powershell?: string;
  exec?: string;
  args?: string[];
  cwd?: string;
  timeoutSec?: number;
}

const COPILOT_EVENTS = new Set([
  "agentStop",
  "errorOccurred",
  "notification",
  "permissionRequest",
  "postToolUse",
  "postToolUseFailure",
  "preCompact",
  "preToolUse",
  "sessionEnd",
  "sessionStart",
  "subagentStart",
  "subagentStop",
  "userPromptSubmitted",
  "userPromptTransformed",
]);
const COPILOT_EVENT_ALIASES = new Set(["Stop", "UserPromptSubmit"]);
const COPILOT_MATCHER_EVENTS = new Set(["notification", "permissionRequest", "postToolUse", "preCompact", "preToolUse", "subagentStart"]);
const COPILOT_FIELDS = new Set(["event", "matcher", "command", "bash", "powershell", "exec", "args", "cwd", "timeoutSec"]);

export function isCopilotEvent(event: string): boolean {
  const canonical = event[0]?.toLowerCase() + event.slice(1);
  return COPILOT_EVENTS.has(canonical) || COPILOT_EVENT_ALIASES.has(event);
}

export function validateCopilotHooks(body: unknown): CopilotHookInput[] {
  const list = isObject(body) ? body.hooks : undefined;
  if (!Array.isArray(list)) throw new HttpError(400, t("configMessages.hooks_edit_01"));
  return list.map((item, index) => {
    if (!isObject(item) || Object.keys(item).some((key) => !COPILOT_FIELDS.has(key))) throw new HttpError(400, t("configMessages.hooks_edit_02", { value0: index + 1 }));
    const event = item.event;
    const canonical = typeof event === "string" ? event[0]?.toLowerCase() + event.slice(1) : "";
    if (typeof event !== "string" || !isCopilotEvent(event)) throw new HttpError(400, t("configMessages.hooks_edit_03", { value0: index + 1 }));
    const hasExec = typeof item.exec === "string" && item.exec.trim().length > 0;
    const commands = [item.command, item.bash, item.powershell].filter((v) => typeof v === "string" && v.trim().length > 0);
    if (hasExec === commands.length > 0) throw new HttpError(400, t("configMessages.hooks_edit_04", { value0: index + 1 }));
    if (item.args !== undefined && (!hasExec || !Array.isArray(item.args) || item.args.some((v: unknown) => typeof v !== "string")))
      throw new HttpError(400, t("configMessages.hooks_edit_05", { value0: index + 1 }));
    for (const key of ["command", "bash", "powershell", "exec", "cwd"] as const) {
      const value = item[key];
      if (value !== undefined && (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)))
        throw new HttpError(400, t("configMessages.hooks_edit_06", { value0: key, value1: index + 1 }));
    }
    if (item.matcher !== undefined) {
      if (typeof item.matcher !== "string" || !COPILOT_MATCHER_EVENTS.has(canonical)) throw new HttpError(400, t("configMessages.hooks_edit_07", { value0: index + 1 }));
      try {
        new RegExp(item.matcher);
      } catch {
        throw new HttpError(400, t("configMessages.hooks_edit_08", { value0: index + 1 }));
      }
    }
    if (item.timeoutSec !== undefined && (typeof item.timeoutSec !== "number" || !Number.isInteger(item.timeoutSec) || item.timeoutSec < 1 || item.timeoutSec > 3600)) {
      throw new HttpError(400, t("configMessages.hooks_edit_09", { value0: index + 1 }));
    }
    return item as unknown as CopilotHookInput;
  });
}

/** Hook events in the Claude Code hooks reference (code.claude.com/docs/en/hooks). */
export const HOOK_EVENTS = [
  "SessionStart",
  "Setup",
  "InstructionsLoaded",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "MessageDisplay",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PermissionDenied",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "ConfigChange",
  "CwdChanged",
  "DirectoryAdded",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "PreModelSwitch",
  "PostModelSwitch",
  "SessionEnd",
  "Elicitation",
  "ElicitationResult",
];

/** Claude Code adds events often; a well-formed name TaskPilot does not know yet is kept as is. */
const EVENT_NAME = /^[A-Z][A-Za-z]{1,63}$/;
const EDITED_FIELDS = new Set(["type", "command", "timeout"]);
const MAX_EXTRA_BYTES = 16 * 1024;

/** A hook parseHookInputs reads: a command hook, with or without `type`. Anything else is kept as is on save. */
function isCommandHook(h: unknown): h is Record<string, unknown> & { command: string } {
  return isObject(h) && (h.type === undefined || h.type === "command") && typeof h.command === "string";
}

/** Command hooks of a settings file, in file order. Hooks that are not command hooks are left alone on save. */
export function parseHookInputs(text: string | null): HookInput[] {
  const data = parse(text);
  const out: HookInput[] = [];
  if (!isObject(data.hooks)) return out;
  for (const [event, matchers] of Object.entries(data.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const m of matchers) {
      if (!isObject(m) || !Array.isArray(m.hooks)) continue;
      for (const h of m.hooks) {
        if (!isCommandHook(h)) continue;
        const extra = Object.fromEntries(Object.entries(h).filter(([k]) => !EDITED_FIELDS.has(k)));
        out.push({
          event,
          matcher: typeof m.matcher === "string" ? m.matcher : "",
          command: h.command,
          ...(typeof h.timeout === "number" ? { timeout: h.timeout } : {}),
          ...(Object.keys(extra).length ? { extra } : {}),
        });
      }
    }
  }
  return out;
}

/** The file's "hooks" value as written (every hook type), for showing it as is; null when absent. */
export function readHooksBlock(text: string | null): unknown {
  return parse(text).hooks ?? null;
}

export function validateHooks(body: unknown): HookInput[] {
  const list = isObject(body) ? body.hooks : undefined;
  if (!Array.isArray(list)) throw new HttpError(400, t("hooks.notList"));
  return list.map((h, i) => {
    if (!isObject(h)) throw new HttpError(400, t("hooks.invalid", { n: i + 1 }));
    const { event, matcher, command, timeout, extra } = h;
    if (typeof event !== "string" || !EVENT_NAME.test(event)) throw new HttpError(400, t("hooks.event", { n: i + 1 }));
    if (typeof command !== "string" || !command.trim()) throw new HttpError(400, t("hooks.noCommand", { n: i + 1 }));
    if (/[\r\n\0]/.test(command)) throw new HttpError(400, t("hooks.multiline", { n: i + 1 }));
    if (matcher !== undefined && typeof matcher !== "string") throw new HttpError(400, t("hooks.matcher", { n: i + 1 }));
    if (timeout !== undefined && timeout !== null && (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 3600)) {
      throw new HttpError(400, t("hooks.timeout", { n: i + 1 }));
    }
    if (extra !== undefined && extra !== null) {
      if (!isObject(extra) || Object.keys(extra).some((k) => EDITED_FIELDS.has(k))) {
        throw new HttpError(400, t("hooks.extra", { n: i + 1 }));
      }
      if (JSON.stringify(extra).length > MAX_EXTRA_BYTES) throw new HttpError(400, t("hooks.extraTooBig", { n: i + 1 }));
    }
    return {
      event,
      matcher: (matcher ?? "").trim(),
      command: command.trim(),
      ...(typeof timeout === "number" ? { timeout } : {}),
      ...(isObject(extra) && Object.keys(extra).length ? { extra } : {}),
    };
  });
}

/**
 * Settings text with its command hooks replaced by `hooks`, grouped event → matcher in input
 * order. Every hook that parseHookInputs does not read (prompt…, or no command) and every other key are kept.
 */
export function applyHooks(text: string | null, hooks: HookInput[]): string {
  const data = parse(text);
  const kept: Record<string, unknown[]> = {};
  if (isObject(data.hooks)) {
    for (const [event, matchers] of Object.entries(data.hooks)) {
      if (!Array.isArray(matchers)) continue;
      for (const m of matchers) {
        if (!isObject(m) || !Array.isArray(m.hooks)) continue;
        const others = m.hooks.filter((h) => !isCommandHook(h));
        if (others.length) (kept[event] ??= []).push({ ...m, hooks: others });
      }
    }
  }

  const grouped: Record<string, Array<{ matcher?: string; hooks: unknown[] }>> = {};
  for (const h of hooks) {
    const list = (grouped[h.event] ??= []);
    let group = list.find((g) => (g.matcher ?? "") === h.matcher);
    if (!group) {
      group = h.matcher ? { matcher: h.matcher, hooks: [] } : { hooks: [] };
      list.push(group);
    }
    group.hooks.push({ type: "command", command: h.command, ...h.extra, ...(h.timeout ? { timeout: h.timeout } : {}) });
  }

  const merged: Record<string, unknown[]> = {};
  for (const event of new Set([...Object.keys(grouped), ...Object.keys(kept)])) {
    merged[event] = [...(grouped[event] ?? []), ...(kept[event] ?? [])];
  }
  const out = { ...data };
  if (Object.keys(merged).length) out.hooks = merged;
  else delete out.hooks;
  return `${JSON.stringify(out, null, 2)}\n`;
}

function parse(text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === "") return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new HttpError(409, t("errors.settingsNotJson", { error: (e as Error).message }));
  }
  if (!isObject(data)) throw new HttpError(409, t("errors.settingsNotObject"));
  return data;
}
