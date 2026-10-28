import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { SessionEvent } from "../sessions/index.js";
import type { SessionMeta } from "../../core/state.js";
import { describeTool, firstLine, type ToolCategory } from "./describe.js";
import { t } from "../../core/i18n.js";
import { PROVIDER_LABELS, DEFAULT_PROVIDER } from "@taskpilot/shared";
import { SerialQueue } from "../../core/serial.js";

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
  private readonly queue = new SerialQueue();

  constructor(private readonly dir: string) {
    super();
  }

  async list(sessionIds: string[], limit = 200): Promise<ActivityItem[]> {
    const all = (await Promise.all(sessionIds.map((id) => this.load(id)))).flat();
    return all.sort((a, b) => a.at - b.at).slice(-limit);
  }

  /** Hooks arrive in quick succession (PreToolUse, PostToolUse…); apply them one at a time. */
  record(meta: SessionMeta, event: SessionEvent): Promise<void> {
    return this.queue.run(() => this.apply(meta, event));
  }

  private async apply(meta: SessionMeta, event: SessionEvent): Promise<void> {
    const items = await this.load(meta.id);
    const now = Date.now();
    const base = { sessionId: meta.id, taskKey: meta.taskKey, at: now };
    const toolData = "tool" in event ? event.tool : {};
    const toolUseId = toolData.callId ?? "";
    const tool = toolData.name ?? "";
    const input = (typeof toolData.input === "object" && toolData.input ? toolData.input : {}) as Record<string, unknown>;

    switch (event.type) {
      case "session.started":
        return this.put(items, {
          ...base,
          id: this.newId(),
          kind: "session",
          summary: event.resumed === true ? t("activity.sessionResume") : t("activity.sessionStart"),
        });
      case "prompt.submitted":
        return this.put(items, {
          ...base,
          id: this.newId(),
          kind: "prompt",
          summary: t("activity.prompt", { text: firstLine(event.prompt ?? "", 100) }),
          detail: event.prompt ?? "",
        });
      case "tool.started":
        return this.put(items, {
          ...base,
          id: toolUseId || this.newId(),
          kind: "tool",
          tool,
          ...describeTool(tool, input, meta.repo),
          status: "running",
        });
      case "permission.requested": {
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
      case "tool.completed":
      case "tool.failed": {
        const running = items.find((i) => i.id === toolUseId);
        const failed = event.type === "tool.failed";
        const durationMs = event.durationMs;
        const finished: ActivityItem = running
          ? { ...running, status: failed ? "error" : "done", durationMs }
          : { ...base, id: toolUseId || this.newId(), kind: "tool", tool, ...describeTool(tool, input, meta.repo), status: failed ? "error" : "done", durationMs };
        if (event.type === "tool.failed" && typeof event.error === "string") finished.detail = clipBlock(event.error);
        return this.put(items, finished);
      }
      case "turn.interrupted":
      case "turn.failed":
      case "turn.completed": {
        const agent = PROVIDER_LABELS[meta.agent ?? DEFAULT_PROVIDER];
        // A Stop TaskPilot read from the agent's transcript, not one the agent sent: say so.
        const summary = event.source === "transcript" ? t("activity.stopFromTranscript", { agent }) : firstLine(event.message ?? "", 140) || t("activity.stop", { agent });
        return this.put(items, { ...base, id: this.newId(), kind: "stop", summary, detail: event.message ?? "" });
      }
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
