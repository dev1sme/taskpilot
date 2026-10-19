import { HttpError } from "../errors.js";
import { isObject } from "./fs.js";

export interface HookInput {
  event: string;
  matcher: string;
  command: string;
  timeout?: number;
}

/** Events a user hook can listen to (Claude Code 2.1.x). */
export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
];

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
        out.push({
          event,
          matcher: typeof m.matcher === "string" ? m.matcher : "",
          command: h.command,
          ...(typeof h.timeout === "number" ? { timeout: h.timeout } : {}),
        });
      }
    }
  }
  return out;
}

export function validateHooks(body: unknown): HookInput[] {
  const list = isObject(body) ? body.hooks : undefined;
  if (!Array.isArray(list)) throw new HttpError(400, "hooks phải là danh sách");
  return list.map((h, i) => {
    if (!isObject(h)) throw new HttpError(400, `Hook #${i + 1} không hợp lệ`);
    const { event, matcher, command, timeout } = h;
    if (typeof event !== "string" || !HOOK_EVENTS.includes(event)) throw new HttpError(400, `Hook #${i + 1}: sự kiện không hợp lệ`);
    if (typeof command !== "string" || !command.trim()) throw new HttpError(400, `Hook #${i + 1}: thiếu lệnh`);
    if (/[\r\n\0]/.test(command)) throw new HttpError(400, `Hook #${i + 1}: lệnh phải nằm trên một dòng`);
    if (matcher !== undefined && typeof matcher !== "string") throw new HttpError(400, `Hook #${i + 1}: matcher phải là chuỗi`);
    if (timeout !== undefined && timeout !== null && (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 3600)) {
      throw new HttpError(400, `Hook #${i + 1}: timeout phải là số giây từ 1 đến 3600`);
    }
    return {
      event,
      matcher: (matcher ?? "").trim(),
      command: command.trim(),
      ...(typeof timeout === "number" ? { timeout } : {}),
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
    group.hooks.push({ type: "command", command: h.command, ...(h.timeout ? { timeout: h.timeout } : {}) });
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
