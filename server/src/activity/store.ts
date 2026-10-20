import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { HookEvent } from "../sessions/hooks.js";
import type { SessionMeta } from "../core/state.js";
import { describeTool, firstLine, type ToolCategory } from "./describe.js";
import { t } from "../core/i18n.js";

export type ActivityKind = "session" | "prompt" | "tool" | "permission" | "stop";

export interface ActivityItem {
  id: string;
  sessionId: string;
  taskKey: string;
  at: number;
  kind: ActivityKind;
  summary: string;
  /** permission: what Claude asks to do, the summary without its "asks for permission" prefix. */
  action?: string;
  detail?: string;
  tool?: string;
  category?: ToolCategory;
  status?: "running" | "done" | "error";
  durationMs?: number;
}

/** Items kept per session in memory (and returned by the API). */
const KEEP = 400;

/**
 * Turns hook callbacks into a per-session activity feed. Stored as JSONL under
 * <state dir>/activity/<session id>.jsonl; an item can appear several times (a tool call
 * first as running, then done) and the last line for an id wins.
 */
export class ActivityStore extends EventEmitter<{ item: [item: ActivityItem] }> {
  private readonly cache = new Map<string, ActivityItem[]>();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {
    super();
  }

  async list(sessionIds: string[], limit = 200): Promise<ActivityItem[]> {
    const all = (await Promise.all(sessionIds.map((id) => this.load(id)))).flat();
    return all.sort((a, b) => a.at - b.at).slice(-limit);
  }

  /** Hooks arrive in quick succession (PreToolUse, PostToolUse…); apply them one at a time. */
  record(meta: SessionMeta, event: HookEvent, payload: Record<string, unknown>): Promise<void> {
    const next = this.queue.then(() => this.apply(meta, event, payload));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async apply(meta: SessionMeta, event: HookEvent, payload: Record<string, unknown>): Promise<void> {
    const items = await this.load(meta.id);
    const now = Date.now();
    const base = { sessionId: meta.id, taskKey: meta.taskKey, at: now };
    const str = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : "");
    const toolUseId = str("tool_use_id");
    const tool = str("tool_name");
    const input = (typeof payload.tool_input === "object" && payload.tool_input ? payload.tool_input : {}) as Record<
      string,
      unknown
    >;

    switch (event) {
      case "SessionStart":
        return this.put(items, {
          ...base,
          id: this.newId(),
          kind: "session",
          summary: str("source") === "resume" ? t("activity.sessionResume") : t("activity.sessionStart"),
        });
      case "UserPromptSubmit":
        return this.put(items, {
          ...base,
          id: this.newId(),
          kind: "prompt",
          summary: t("activity.prompt", { text: firstLine(str("prompt"), 100) }),
          detail: str("prompt"),
        });
      case "PreToolUse":
        return this.put(items, {
          ...base,
          id: toolUseId || this.newId(),
          kind: "tool",
          tool,
          ...describeTool(tool, input, meta.repo),
          status: "running",
        });
      case "PermissionRequest": {
        const action = describeTool(tool, input, meta.repo).summary;
        return this.put(items, {
          ...base,
          id: this.newId(),
          kind: "permission",
          tool,
          summary: t("activity.permission", { action }),
          action,
        });
      }
      case "PostToolUse":
      case "PostToolUseFailure": {
        const running = items.find((i) => i.id === toolUseId);
        const failed = event === "PostToolUseFailure";
        const durationMs = typeof payload.duration_ms === "number" ? payload.duration_ms : undefined;
        const finished: ActivityItem = running
          ? { ...running, status: failed ? "error" : "done", durationMs }
          : { ...base, id: toolUseId || this.newId(), kind: "tool", tool, ...describeTool(tool, input, meta.repo), status: failed ? "error" : "done", durationMs };
        if (failed && typeof payload.error === "string") finished.detail = clipBlock(payload.error);
        return this.put(items, finished);
      }
      case "Stop":
        return this.put(items, {
          ...base,
          id: this.newId(),
          kind: "stop",
          summary: firstLine(str("last_assistant_message"), 140) || t("activity.stop"),
          detail: str("last_assistant_message"),
        });
    }
  }

  private async put(items: ActivityItem[], item: ActivityItem): Promise<void> {
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) items[i] = item;
    else items.push(item);
    if (items.length > KEEP) items.splice(0, items.length - KEEP);
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file(item.sessionId), `${JSON.stringify(item)}\n`);
    this.emit("item", item);
  }

  private async load(sessionId: string): Promise<ActivityItem[]> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;
    const byId = new Map<string, ActivityItem>();
    try {
      for (const line of (await readFile(this.file(sessionId), "utf8")).split("\n")) {
        if (!line) continue;
        try {
          const item = JSON.parse(line) as ActivityItem;
          byId.set(item.id, item);
        } catch {
          // Skip a torn last line.
        }
      }
    } catch {
      // No activity yet.
    }
    const items = [...byId.values()].slice(-KEEP);
    this.cache.set(sessionId, items);
    return items;
  }

  private file(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.jsonl`);
  }

  private newId(): string {
    return `a${Date.now().toString(36)}${(this.seq++).toString(36)}`;
  }
}

function clipBlock(s: string, max = 2000): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
