import { HttpError } from "../errors.js";
import { isObject } from "./fs.js";

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

/** Command hooks of a settings file, in file order. Non-command hooks are left alone on save. */
export function readHookInputs(text: string | null): HookInput[] {
  const data = parse(text);
  const out: HookInput[] = [];
  if (!isObject(data.hooks)) return out;
  for (const [event, matchers] of Object.entries(data.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const m of matchers) {
      if (!isObject(m) || !Array.isArray(m.hooks)) continue;
      for (const h of m.hooks) {
        if (!isObject(h) || (h.type !== undefined && h.type !== "command") || typeof h.command !== "string") continue;
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
  if (!Array.isArray(list)) throw new HttpError(400, "hooks phải là danh sách");
  return list.map((h, i) => {
    if (!isObject(h)) throw new HttpError(400, `Hook #${i + 1} không hợp lệ`);
    const { event, matcher, command, timeout, extra } = h;
    if (typeof event !== "string" || !EVENT_NAME.test(event)) throw new HttpError(400, `Hook #${i + 1}: sự kiện không hợp lệ`);
    if (typeof command !== "string" || !command.trim()) throw new HttpError(400, `Hook #${i + 1}: thiếu lệnh`);
    if (/[\r\n\0]/.test(command)) throw new HttpError(400, `Hook #${i + 1}: lệnh phải nằm trên một dòng`);
    if (matcher !== undefined && typeof matcher !== "string") throw new HttpError(400, `Hook #${i + 1}: matcher phải là chuỗi`);
    if (timeout !== undefined && timeout !== null && (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 3600)) {
      throw new HttpError(400, `Hook #${i + 1}: timeout phải là số giây từ 1 đến 3600`);
    }
    if (extra !== undefined && extra !== null) {
      if (!isObject(extra) || Object.keys(extra).some((k) => EDITED_FIELDS.has(k))) {
        throw new HttpError(400, `Hook #${i + 1}: extra không hợp lệ`);
      }
      if (JSON.stringify(extra).length > MAX_EXTRA_BYTES) throw new HttpError(400, `Hook #${i + 1}: extra quá lớn`);
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
 * order. Hooks of other types (prompt…) and every other key are kept.
 */
export function applyHooks(text: string | null, hooks: HookInput[]): string {
  const data = parse(text);
  const kept: Record<string, unknown[]> = {};
  if (isObject(data.hooks)) {
    for (const [event, matchers] of Object.entries(data.hooks)) {
      if (!Array.isArray(matchers)) continue;
      for (const m of matchers) {
        if (!isObject(m) || !Array.isArray(m.hooks)) continue;
        const others = m.hooks.filter((h) => isObject(h) && h.type !== undefined && h.type !== "command");
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
    throw new HttpError(409, `File settings không phải JSON hợp lệ (${(e as Error).message})`);
  }
  if (!isObject(data)) throw new HttpError(409, "File settings phải là một object JSON");
  return data;
}
