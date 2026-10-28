import { open } from "node:fs/promises";
import path from "node:path";
import { copilotHome } from "./home.js";

/** Enough of events.jsonl to find the last assistant message of a turn. */
const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;
/**
 * Copilot fires Stop before events.jsonl has the turn's last lines (copilot 1.0.101): wait this long
 * at most for an `assistant.turn_end` from around the Stop.
 */
const TRANSCRIPT_WAIT_MS = 3000;
const TRANSCRIPT_POLL_MS = 100;
/** A turn_end this close before the Stop belongs to the turn that stopped. */
const TURN_END_SLACK_MS = 500;

/** events.jsonl of a Copilot session. */
export function copilotTranscript(sessionId: string): string {
  return path.join(copilotHome(), "session-state", sessionId, "events.jsonl");
}

async function readTail(file: string): Promise<string | null> {
  try {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await handle.read(buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * The last non-empty `assistant.message` of a Copilot events.jsonl; null when unreadable. With
 * `stoppedAt` (the Stop hook's time), waits until the file has that turn's end.
 */
export async function lastAssistantMessage(file: string, stoppedAt?: number): Promise<string | null> {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  for (;;) {
    const found = await readLastMessage(file);
    const complete = stoppedAt === undefined || (found?.turnEndedAt ?? 0) >= stoppedAt - TURN_END_SLACK_MS;
    if (!found || complete || Date.now() >= deadline) return found?.message ?? null;
    await new Promise((r) => setTimeout(r, TRANSCRIPT_POLL_MS));
  }
}

async function readLastMessage(file: string): Promise<{ message: string | null; turnEndedAt: number } | null> {
  const text = await readTail(file);
  if (text === null) return null;
  const lines = text.split("\n");
  let turnEndedAt = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant.')) continue;
    let event: { type?: unknown; timestamp?: unknown; data?: { content?: unknown } };
    try {
      event = JSON.parse(lines[i]) as typeof event;
    } catch {
      // The first line of the tail may be cut in half.
      continue;
    }
    if (event.type === "assistant.turn_end" && !turnEndedAt && typeof event.timestamp === "string") {
      turnEndedAt = Date.parse(event.timestamp) || 0;
    } else if (event.type === "assistant.message" && typeof event.data?.content === "string" && event.data.content.trim()) {
      return { message: event.data.content, turnEndedAt };
    }
  }
  return { message: null, turnEndedAt };
}

/**
 * When the turn begun after `since` ended, as the transcript shows it: the last assistant/tool/user
 * line is an `assistant.turn_end` written after `since`, and nothing at all was written for
 * `idleMs` (a turn_end also ends each round of tool calls, but those rounds go on within seconds).
 * Null while the turn is still going or the transcript is unreadable.
 */
export async function transcriptTurnEnd(file: string, since: number, idleMs: number, now = Date.now()): Promise<number | null> {
  const text = await readTail(file);
  if (text === null) return null;
  let last: { type: string; at: number } | null = null;
  let lastWork: { type: string; at: number } | null = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: { type?: unknown; timestamp?: unknown };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (typeof event.type !== "string" || typeof event.timestamp !== "string") continue;
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) continue;
    last = { type: event.type, at };
    if (/^(assistant|tool)\.|^user\.message$/.test(event.type)) lastWork = last;
  }
  if (!last || lastWork?.type !== "assistant.turn_end" || lastWork.at < since || now - last.at < idleMs) return null;
  return lastWork.at;
}
